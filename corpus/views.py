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
    "Answer the practitioner's questions clearly and practically, using GitHub-"
    "flavoured Markdown (headings, **bold**, lists, tables) for structure. "
    "Reference Zimbabwean statutes (with chapter numbers, e.g. [Chapter 5:07]) "
    "and decided cases by name where you are confident. Where you are uncertain "
    "about a citation or the current state of the law, say so explicitly and "
    "advise the practitioner to verify against the primary source. Never "
    "fabricate case names, citations, or section numbers."
)

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


def _system_prompt(scope):
    labels = [_SCOPE_LABELS[s] for s in (scope or []) if s in _SCOPE_LABELS]
    if not labels:
        return LEGAL_SYSTEM_PROMPT
    return LEGAL_SYSTEM_PROMPT + (
        f"\n\nFocus this answer on the following Zimbabwean sources where relevant: "
        f"{', '.join(labels)}."
    )


def _build_messages(question, history):
    """Sanitise the optional prior turns and append the new question."""
    msgs = []
    for m in (history or [])[-_MAX_HISTORY:]:
        role = m.get('role')
        content = (m.get('content') or '').strip()
        if role in ('user', 'assistant') and content:
            msgs.append({'role': role, 'content': content[:8000]})
    msgs.append({'role': 'user', 'content': question})
    return msgs


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
        try:
            completion = get_provider(config).complete(
                system=_system_prompt(data.get('scope')), messages=messages,
                model=config.default_model or None, user_id=_tenant_pseudo_id(request.user),
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
        user = request.user

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
            messages = _build_messages(data['question'], prior)
            adapter = get_provider(config)
            full, tokens_in, tokens_out, model = '', 0, 0, config.default_model
            settled = False
            try:
                for evt in adapter.stream(
                    system=_system_prompt(data.get('scope')), messages=messages,
                    model=config.default_model or None, user_id=_tenant_pseudo_id(user),
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

            # Persist the chat thread for the history sidebar.
            nonlocal conv
            thread = prior + [
                {'role': 'user', 'content': data['question']},
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
