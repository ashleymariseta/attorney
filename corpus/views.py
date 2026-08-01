import json

from django.db import transaction
from django.http import StreamingHttpResponse
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from workflows import credits
from workflows.credits import InsufficientCreditsError
from workflows.providers import ProviderError, get_provider
from workflows.views import (
    QuotaError,
    _enforce_pool_limits,
    _log_usage,
    _pick_provider_config,
    _tenant_pseudo_id,
)

from .models import CorpusCollection, ResearchConversation, ResearchQuery
from .serializers import (
    AskSerializer,
    ConversationDetailSerializer,
    ConversationListSerializer,
    CorpusCollectionSerializer,
    ResearchQuerySerializer,
)

# AI-Researcher is Claude-powered (no local corpus index). The scope chips are
# passed to the model as a focus hint so it knows which sources to reason about.
LEGAL_SYSTEM_PROMPT = (
    "You are an expert legal research assistant for Zimbabwean legal practice. "
    "Answer the practitioner's question directly and substantively from your "
    "knowledge of Zimbabwean law — give the answer, don't tell them to go look "
    "it up. Use GitHub-flavoured Markdown (headings, **bold**, lists, tables) "
    "for structure. Cite Zimbabwean statutes with chapter numbers (e.g. "
    "[Chapter 5:07]), Statutory Instruments (e.g. SI 33 of 2019) and decided "
    "cases by name. When the web-search tool is available, use it to confirm the "
    "current position and cite the sources you relied on. If a specific citation "
    "or the current state of the law is genuinely uncertain, still give your best "
    "substantive answer and flag precisely what should be verified against the "
    "primary source — but do not refuse or ask for clarification on well-known "
    "matters. Never fabricate case names, citations, or section numbers."
)


def _web_search_tools(config):
    """Anthropic web-search server tool, when enabled — lets answers cite live
    sources. Returns None for non-Anthropic providers or when disabled."""
    from django.conf import settings as dj_settings

    if getattr(config, 'provider', '') != 'anthropic':
        return None
    if not getattr(dj_settings, 'CO_RESEARCHER_WEB_SEARCH', False):
        return None
    return [{
        'type': 'web_search_20250305',
        'name': 'web_search',
        'max_uses': getattr(dj_settings, 'CO_RESEARCHER_WEB_SEARCH_MAX_USES', 5),
    }]

_SCOPE_LABELS = {
    'case': 'Cases',
    'judgement': 'Judgements',
    'rules': 'High Court Rules',
    'constitution': 'the Constitution',
    'statute': 'Statutes',
}
_MAX_HISTORY = 20  # cap the turns we forward to the model


def _is_lawyer(user):
    return getattr(user, 'role', None) == 'lawyer'


def _system_prompt(scope, matters_context=None, clients_context=None):
    prompt = LEGAL_SYSTEM_PROMPT
    labels = [_SCOPE_LABELS[s] for s in (scope or []) if s in _SCOPE_LABELS]
    if labels:
        prompt += (
            f"\n\nFocus this answer on the following Zimbabwean sources where relevant: "
            f"{', '.join(labels)}."
        )
    if matters_context:
        prompt += (
            "\n\nThe practitioner may ask about their own caseload. Here are their "
            "current matters — use them only when relevant and never invent matter "
            f"details:\n\n{matters_context}"
        )
    if clients_context:
        prompt += (
            "\n\nThis is the practitioner's own client book, drawn live from their "
            "account — the same figures their Clients screen shows. It IS their "
            "practice data, so answer questions like 'who are my top clients' or "
            "'who owes me money' directly from this table instead of saying you "
            "have no access to their records. Rank on whichever column the "
            "question implies, say which measure you ranked on, and never invent "
            "a client, an amount or a total that is not in this table. If the "
            "table cannot answer the question, say precisely which figure is "
            f"missing:\n\n{clients_context}"
        )
    return prompt


def _matters_context(user, limit=25):
    """A compact Markdown summary of the matters this lawyer can see (their own
    plus firm-shared), for grounding 'about my matters' questions."""
    from django.db.models import Q

    from core.models import Matter

    scope = Q(client=user) | Q(lawyers=user)
    firm_id = getattr(getattr(user, 'lawyer_profile', None), 'firm_id', None)
    if firm_id:
        scope |= Q(lawyers__lawyer_profile__firm_id=firm_id)
    qs = (
        Matter.objects.filter(scope).select_related('client')
        .prefetch_related('lawyers').distinct().order_by('-created_at')[:limit]
    )
    lines = []
    for m in qs:
        client = (m.client.get_full_name() if m.client_id else '') or getattr(m.client, 'email', '')
        lines.append(
            f"- **{m.title}** — status: {m.get_status_display()}; "
            f"area: {m.practice_area or 'n/a'}; client: {client or 'n/a'}"
            + (f". {m.description[:300]}" if m.description else '')
        )
    if not lines:
        return 'The practitioner has no matters on file.'
    return '\n'.join(lines)


def _clients_context(user, request, limit=25):
    """Per-client roll-up for a practitioner: matter counts, money and the last
    7 days of activity.

    The matter summary alone can't answer "who are my top clients this week" —
    it carries no amounts, hours or dates, so the model can only decline. This
    reuses the same aggregation as the Clients screen, so the numbers the model
    quotes are the numbers the practitioner sees there.
    """
    from datetime import timedelta
    from decimal import Decimal

    from django.db.models import Count, Sum
    from django.utils import timezone

    from core.models import Consultation, TimeEntry
    from core.views import _lawyer_client_summaries
    from payments.models import Payment, PaymentStatus

    summaries = _lawyer_client_summaries(user, request)['results']
    if not summaries:
        return 'The practitioner has no clients on file.'

    since = timezone.now() - timedelta(days=7)
    week_minutes = dict(
        TimeEntry.objects.filter(lawyer=user, started_at__gte=since)
        .values_list('matter__client_id').annotate(s=Sum('minutes'))
        .values_list('matter__client_id', 's')
    )
    week_billed = {
        cid: (val or Decimal('0'))
        for cid, val in TimeEntry.objects.filter(lawyer=user, started_at__gte=since)
        .values_list('matter__client_id').annotate(s=Sum('amount'))
        .values_list('matter__client_id', 's')
    }
    week_paid = {
        cid: (val or Decimal('0'))
        for cid, val in Payment.objects.filter(
            matter__lawyers=user, status=PaymentStatus.VERIFIED, created_at__gte=since
        ).values_list('payer_id').annotate(s=Sum('amount')).values_list('payer_id', 's')
    }
    week_consults = dict(
        Consultation.objects.filter(matter__lawyers=user, scheduled_time__gte=since)
        .values_list('matter__client_id').annotate(c=Count('id'))
        .values_list('matter__client_id', 'c')
    )

    # Rank by the last 7 days first, then lifetime paid — so "this week" and
    # "overall" questions both read off a sensible order.
    def sort_key(s):
        cid = s['id']
        return (
            float(week_billed.get(cid, 0) or 0),
            week_minutes.get(cid, 0),
            float(s.get('paid_total') or 0),
        )

    rows = sorted(summaries, key=sort_key, reverse=True)[:limit]
    header = (
        '| Client | Relationship | Matters (active) | Invoiced | Paid | Outstanding '
        '| Last 7d hours | Last 7d billed | Last 7d payments | Consults last 7d | Last consultation |\n'
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
    )
    lines = [header]
    for s in rows:
        cid = s['id']
        mins = week_minutes.get(cid, 0) or 0
        last_c = s.get('last_consultation_at') or '—'
        lines.append(
            f"| {s['full_name']} | {s['relationship']} | {s['matters_count']} "
            f"({s['active_matters_count']}) | {s['invoiced_total']} | {s['paid_total']} "
            f"| {s['outstanding_total']} | {mins / 60:.1f} | {week_billed.get(cid, Decimal('0'))} "
            f"| {week_paid.get(cid, Decimal('0'))} | {week_consults.get(cid, 0)} | {last_c} |"
        )
    lines.append(
        '\nAmounts are in USD. "Last 7d" columns cover the seven days up to now; '
        'invoiced/paid/outstanding are lifetime totals for this practitioner.'
    )
    return '\n'.join(lines)


def _build_messages(question, history, content=None):
    """Sanitise the optional prior turns and append the new user message. When
    ``content`` is given (e.g. text + attachment blocks) it's used verbatim for
    the new turn; otherwise the plain question string is used."""
    msgs = []
    for m in (history or [])[-_MAX_HISTORY:]:
        role = m.get('role')
        c = (m.get('content') or '').strip()
        if role in ('user', 'assistant') and c:
            msgs.append({'role': role, 'content': c[:8000]})
    msgs.append({'role': 'user', 'content': content if content is not None else question})
    return msgs


# Attachment limits (base64 inflates ~33%, so these are the on-the-wire caps).
_MAX_ATTACHMENTS = 5
_MAX_ATTACHMENT_B64 = 14_000_000  # ~10 MB raw per file
_TEXT_MEDIA_PREFIXES = ('text/',)
_TEXT_MEDIA_EXACT = {'application/json', 'application/xml'}


class AttachmentError(Exception):
    pass


def _content_blocks(question, attachments):
    """Build a Claude message content value from the question + attachments.

    Returns a plain string when there are no attachments, otherwise a list of
    content blocks (document for PDFs, image for images, text for text files),
    with the question text last. Raises :class:`AttachmentError` on bad input."""
    import base64

    atts = attachments or []
    if not atts:
        return question
    if len(atts) > _MAX_ATTACHMENTS:
        raise AttachmentError(f'Too many files (max {_MAX_ATTACHMENTS}).')

    blocks = []
    for a in atts:
        media = (a.get('media_type') or '').lower()
        data = a.get('data') or ''
        name = (a.get('name') or 'file')[:200]
        if not data:
            continue
        if len(data) > _MAX_ATTACHMENT_B64:
            raise AttachmentError(f'“{name}” is too large (max ~10 MB).')
        if media == 'application/pdf':
            blocks.append({'type': 'document', 'source': {
                'type': 'base64', 'media_type': 'application/pdf', 'data': data}})
        elif media.startswith('image/'):
            blocks.append({'type': 'image', 'source': {
                'type': 'base64', 'media_type': media, 'data': data}})
        elif media.startswith(_TEXT_MEDIA_PREFIXES) or media in _TEXT_MEDIA_EXACT:
            try:
                text = base64.b64decode(data).decode('utf-8', 'replace')[:50_000]
            except Exception:
                raise AttachmentError(f'Could not read “{name}”.')
            blocks.append({'type': 'text', 'text': f'Attached file "{name}":\n\n{text}'})
        else:
            raise AttachmentError(f'Unsupported file type for “{name}” ({media or "unknown"}).')

    blocks.append({'type': 'text', 'text': question})
    return blocks


class CorpusCollectionViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only listing of the source categories — drives the scope chips."""

    serializer_class = CorpusCollectionSerializer
    permission_classes = [IsAuthenticated]
    queryset = CorpusCollection.objects.filter(is_active=True).order_by('kind', 'name')


class CoResearcherAskView(APIView):
    """``POST /co-researcher/ask/`` — non-streaming Claude answer (kept for
    clients that don't stream). Body: ``{question, scope?, history?}``."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _is_lawyer(request.user):
            return Response({'detail': 'Co-researcher is available to practitioners.'},
                            status=status.HTTP_403_FORBIDDEN)
        ser = AskSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        config = _pick_provider_config()
        if config is None:
            return Response({'detail': 'No AI provider has been configured by the administrator yet.'},
                            status=status.HTTP_400_BAD_REQUEST)

        q = ResearchQuery.objects.create(
            owner=request.user, question=data['question'], scope=data.get('scope') or [],
            provider=config.provider, model=config.default_model or '',
        )
        try:
            hold = credits.begin_charge(request.user)
        except InsufficientCreditsError as c_err:
            q.error = str(c_err); q.save(update_fields=['error'])
            return Response({'detail': str(c_err)}, status=status.HTTP_402_PAYMENT_REQUIRED)
        try:
            _enforce_pool_limits(request.user)
        except QuotaError as q_err:
            credits.release_charge(request.user, hold, 0, note='quota throttle — no run')
            q.error = str(q_err); q.save(update_fields=['error'])
            return Response({'detail': str(q_err)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        messages = _build_messages(data['question'], request.data.get('history'))
        include_matters = bool(request.data.get('include_matters'))
        matters_ctx = _matters_context(request.user) if include_matters else None
        # The client book is the practitioner's own business data — lawyers only.
        clients_ctx = (
            _clients_context(request.user, request)
            if include_matters and _is_lawyer(request.user)
            else None
        )
        _tools = _web_search_tools(config)
        try:
            completion = get_provider(config).complete(
                system=_system_prompt(data.get('scope'), matters_ctx, clients_ctx), messages=messages,
                model=config.default_model or None, user_id=_tenant_pseudo_id(request.user),
                **({'tools': _tools} if _tools else {}),
            )
        except ProviderError as e:
            credits.release_charge(request.user, hold, 0, note='provider error — refunded')
            _log_usage(request.user, config, error=str(e))
            q.error = str(e); q.save(update_fields=['error'])
            return Response({'detail': str(e), 'query': ResearchQuerySerializer(q).data},
                            status=status.HTTP_502_BAD_GATEWAY)

        usage = _log_usage(request.user, config, completion=completion)
        credits.release_charge(request.user, hold, completion.tokens_in + completion.tokens_out,
                               usage_log=usage, note='AI-Researcher ask')
        q.answer_text = completion.text
        q.model = completion.model or q.model
        q.tokens_in = completion.tokens_in
        q.tokens_out = completion.tokens_out
        q.save(update_fields=['answer_text', 'model', 'tokens_in', 'tokens_out'])
        return Response(ResearchQuerySerializer(q).data)


def _sse(payload: dict) -> str:
    return f'data: {json.dumps(payload)}\n\n'


class CoResearcherStreamView(APIView):
    """``POST /co-researcher/ask/stream/`` — streams a Claude answer over SSE.

    Body: ``{question, scope?, history?}``. Emits ``delta`` events, then a
    ``done`` event with the persisted query, or an ``error`` event. Credits are
    reserved before streaming and reconciled (refunded on disconnect/error)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _is_lawyer(request.user):
            return Response({'detail': 'Co-researcher is available to practitioners.'},
                            status=status.HTTP_403_FORBIDDEN)
        ser = AskSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        conversation_id = request.data.get('conversation_id')
        attachments = request.data.get('attachments') or []
        user = request.user
        include_matters = bool(request.data.get('include_matters'))
        matters_ctx = _matters_context(user) if include_matters else None
        clients_ctx = (
            _clients_context(user, request) if include_matters and _is_lawyer(user) else None
        )

        # Build the user message content (text + any file blocks) up-front so a
        # bad attachment fails fast with a 400 rather than mid-stream.
        try:
            content = _content_blocks(data['question'], attachments)
        except AttachmentError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        att_names = [(a.get('name') or 'file')[:120] for a in attachments if a.get('data')]

        # Resume an existing conversation (owner-checked) or start a new one.
        conv = None
        if conversation_id:
            conv = ResearchConversation.objects.filter(owner=user, pk=conversation_id).first()
        prior = list(conv.messages) if conv else []

        def stream():
            config = _pick_provider_config()
            if config is None:
                yield _sse({'type': 'error', 'detail': 'No AI provider has been configured yet.'})
                return
            try:
                hold = credits.begin_charge(user)
            except InsufficientCreditsError as c_err:
                yield _sse({'type': 'error', 'detail': str(c_err), 'code': 402})
                return
            try:
                _enforce_pool_limits(user)
            except QuotaError as q_err:
                credits.release_charge(user, hold, 0, note='quota throttle — no run')
                yield _sse({'type': 'error', 'detail': str(q_err), 'code': 429})
                return

            q = ResearchQuery.objects.create(
                owner=user, question=data['question'], scope=data.get('scope') or [],
                provider=config.provider, model=config.default_model or '',
            )
            messages = _build_messages(data['question'], prior, content=content)
            adapter = get_provider(config)
            full, tokens_in, tokens_out, model = '', 0, 0, config.default_model
            settled = False
            _tools = _web_search_tools(config)
            try:
                for evt in adapter.stream(
                    system=_system_prompt(data.get('scope'), matters_ctx, clients_ctx), messages=messages,
                    model=config.default_model or None, user_id=_tenant_pseudo_id(user),
                    **({'tools': _tools} if _tools else {}),
                ):
                    if evt['type'] == 'delta':
                        yield _sse({'type': 'delta', 'text': evt['text']})
                    elif evt['type'] == 'done':
                        full = evt.get('text', full)
                        tokens_in = evt.get('tokens_in', 0)
                        tokens_out = evt.get('tokens_out', 0)
                        model = evt.get('model', model)
            except ProviderError as e:
                credits.release_charge(user, hold, 0, note='provider error — refunded')
                settled = True
                _log_usage(user, config, error=str(e))
                q.error = str(e); q.save(update_fields=['error'])
                yield _sse({'type': 'error', 'detail': str(e), 'code': 502})
                return
            finally:
                if not settled:
                    usage = _log_usage(user, config, completion=type('C', (), {
                        'model': model, 'tokens_in': tokens_in, 'tokens_out': tokens_out})())
                    credits.release_charge(user, hold, tokens_in + tokens_out,
                                           usage_log=usage, note='AI-Researcher ask (stream)')

            q.answer_text = full
            q.model = model or q.model
            q.tokens_in = tokens_in
            q.tokens_out = tokens_out
            q.save(update_fields=['answer_text', 'model', 'tokens_in', 'tokens_out'])

            # Persist the chat thread for the history sidebar. We store only the
            # question text plus a note of attachment names (not the file bytes).
            nonlocal conv
            user_note = data['question']
            if att_names:
                user_note += '\n\n_📎 ' + ', '.join(att_names) + '_'
            thread = prior + [
                {'role': 'user', 'content': user_note},
                {'role': 'assistant', 'content': full},
            ]
            if conv is None:
                conv = ResearchConversation.objects.create(
                    owner=user, title=data['question'][:120], messages=thread,
                )
            else:
                conv.messages = thread
                conv.save(update_fields=['messages', 'updated_at'])

            yield _sse({'type': 'done', 'query': ResearchQuerySerializer(q).data,
                        'conversation': ConversationDetailSerializer(conv).data})

        resp = StreamingHttpResponse(stream(), content_type='text/event-stream')
        resp['Cache-Control'] = 'no-cache'
        resp['X-Accel-Buffering'] = 'no'
        return resp


class ResearchConversationViewSet(viewsets.ModelViewSet):
    """Saved AI-Researcher chat threads (the history sidebar)."""

    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'delete', 'head', 'options']
    queryset = ResearchConversation.objects.none()

    def get_serializer_class(self):
        return ConversationDetailSerializer if self.action == 'retrieve' else ConversationListSerializer

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return ResearchConversation.objects.none()
        return ResearchConversation.objects.filter(owner=self.request.user)


class ResearchQueryViewSet(viewsets.ReadOnlyModelViewSet):
    """History of the lawyer's Co-researcher queries."""

    serializer_class = ResearchQuerySerializer
    permission_classes = [IsAuthenticated]
    queryset = ResearchQuery.objects.none()

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return ResearchQuery.objects.none()
        return ResearchQuery.objects.filter(owner=self.request.user).prefetch_related('citations')
