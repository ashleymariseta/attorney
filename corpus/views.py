import json

from django.db import transaction
from django.http import StreamingHttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
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

from .models import CorpusCollection, ResearchCitation, ResearchQuery
from .serializers import (
    AskSerializer,
    CorpusCollectionSerializer,
    ResearchQuerySerializer,
)
from .services import build_research_prompt, keyword_authorities, retrieve
from .vector import vector_retrieve


class CorpusCollectionViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only listing of available corpora (cases / rules / statutes …).
    Drives the scope chips in the Co-researcher UI."""

    serializer_class = CorpusCollectionSerializer
    permission_classes = [IsAuthenticated]
    queryset = CorpusCollection.objects.filter(is_active=True).order_by('kind', 'name')


def _is_lawyer(user):
    return getattr(user, 'role', None) == 'lawyer'


class CoResearcherAskView(APIView):
    """``POST /co-researcher/ask/`` — main RAG entrypoint.

    Pipeline: retrieve → assemble prompt → call provider → persist
    ResearchQuery + ResearchCitation rows. The response includes the answer
    and the ranked citations the frontend renders as inline pills.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _is_lawyer(request.user):
            return Response(
                {'detail': 'Co-researcher is available to practitioners.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        ser = AskSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        # Semantic vector search first (grounded in the legal corpus); fall back
        # to keyword retrieval if the vector index is unavailable or empty.
        authorities = vector_retrieve(data['question'], scopes=data.get('scope'), k=5)
        if not authorities:
            authorities = keyword_authorities(
                retrieve(data['question'], scopes=data.get('scope'), k=8)
            )
        config = _pick_provider_config()
        if config is None:
            return Response(
                {'detail': 'No AI provider has been configured by the administrator yet.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not authorities:
            with transaction.atomic():
                q = ResearchQuery.objects.create(
                    owner=request.user,
                    question=data['question'],
                    scope=data.get('scope') or [],
                    provider=config.provider,
                    model=config.default_model,
                    answer_text='No matching authorities in the corpus for that question.',
                )
            return Response(ResearchQuerySerializer(q).data)

        system, user_prompt = build_research_prompt(data['question'], authorities)
        adapter = get_provider(config)
        model = data.get('model') or config.default_model

        with transaction.atomic():
            q = ResearchQuery.objects.create(
                owner=request.user,
                question=data['question'],
                scope=data.get('scope') or [],
                provider=config.provider,
                model=model or '',
            )
            for rank, a in enumerate(authorities):
                ResearchCitation.objects.create(
                    query=q, chunk=a.chunk, rank=rank, score=a.score,
                    source_title=a.title[:400], source_kind=a.kind_display[:80],
                    snippet=(a.text or '')[:1000],
                )

        # Credits hard gate: reserve up-front (atomic), then throttle, then call.
        # Reconcile the hold to actual usage on every exit path.
        try:
            hold = credits.begin_charge(request.user)
        except InsufficientCreditsError as c_err:
            q.error = str(c_err)
            q.save(update_fields=['error'])
            return Response({'detail': str(c_err)}, status=status.HTTP_402_PAYMENT_REQUIRED)
        try:
            _enforce_pool_limits(request.user)
        except QuotaError as q_err:
            credits.release_charge(request.user, hold, 0, note='quota throttle — no run')
            q.error = str(q_err)
            q.save(update_fields=['error'])
            return Response({'detail': str(q_err)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        try:
            completion = adapter.complete(
                system=system,
                user=user_prompt,
                model=model or None,
                user_id=_tenant_pseudo_id(request.user),
            )
        except ProviderError as e:
            credits.release_charge(request.user, hold, 0, note='provider error — refunded')
            _log_usage(request.user, config, error=str(e))
            q.error = str(e)
            q.save(update_fields=['error'])
            return Response(
                {'detail': str(e), 'query': ResearchQuerySerializer(q).data},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        usage = _log_usage(request.user, config, completion=completion)
        credits.release_charge(
            request.user, hold, completion.tokens_in + completion.tokens_out,
            usage_log=usage, note='AI-Researcher ask',
        )
        q.answer_text = completion.text
        q.model = completion.model or q.model
        q.tokens_in = completion.tokens_in
        q.tokens_out = completion.tokens_out
        q.save(update_fields=['answer_text', 'model', 'tokens_in', 'tokens_out'])
        return Response(ResearchQuerySerializer(q).data)


def _sse(payload: dict) -> str:
    return f'data: {json.dumps(payload)}\n\n'


class CoResearcherStreamView(APIView):
    """``POST /co-researcher/ask/stream/`` — same as the ask endpoint but streams
    the answer token-by-token over Server-Sent Events. Emits:

        {"type":"delta","text":"..."}              (many)
        {"type":"done","query":{...}}              (final, with citations)
        {"type":"error","detail":"..."}            (on any failure)

    Credits are reserved before streaming and reconciled to actual usage in a
    ``finally`` block, so a mid-stream disconnect still refunds the hold.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _is_lawyer(request.user):
            return Response({'detail': 'Co-researcher is available to practitioners.'},
                            status=status.HTTP_403_FORBIDDEN)
        ser = AskSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        user = request.user

        def stream():
            authorities = vector_retrieve(data['question'], scopes=data.get('scope'), k=5)
            if not authorities:
                authorities = keyword_authorities(retrieve(data['question'], scopes=data.get('scope'), k=8))
            config = _pick_provider_config()
            if config is None:
                yield _sse({'type': 'error', 'detail': 'No AI provider has been configured yet.'})
                return
            if not authorities:
                yield _sse({'type': 'error',
                            'detail': 'No matching authorities in the corpus for that question.'})
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

            with transaction.atomic():
                q = ResearchQuery.objects.create(
                    owner=user, question=data['question'], scope=data.get('scope') or [],
                    provider=config.provider, model=config.default_model or '',
                )
                for rank, a in enumerate(authorities):
                    ResearchCitation.objects.create(
                        query=q, chunk=a.chunk, rank=rank, score=a.score,
                        source_title=a.title[:400], source_kind=a.kind_display[:80],
                        snippet=(a.text or '')[:1000],
                    )

            system, user_prompt = build_research_prompt(data['question'], authorities)
            adapter = get_provider(config)
            full, tokens_in, tokens_out, model = '', 0, 0, config.default_model
            settled = False
            try:
                for evt in adapter.stream(system=system, user=user_prompt,
                                          model=config.default_model or None,
                                          user_id=_tenant_pseudo_id(user)):
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
                q.error = str(e)
                q.save(update_fields=['error'])
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
            yield _sse({'type': 'done', 'query': ResearchQuerySerializer(q).data})

        resp = StreamingHttpResponse(stream(), content_type='text/event-stream')
        resp['Cache-Control'] = 'no-cache'
        resp['X-Accel-Buffering'] = 'no'
        return resp


class ResearchQueryViewSet(viewsets.ReadOnlyModelViewSet):
    """History of the lawyer's Co-researcher queries."""

    serializer_class = ResearchQuerySerializer
    permission_classes = [IsAuthenticated]
    queryset = ResearchQuery.objects.none()

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return ResearchQuery.objects.none()
        return (
            ResearchQuery.objects.filter(owner=self.request.user)
            .prefetch_related('citations', 'citations__chunk', 'citations__chunk__document', 'citations__chunk__document__collection')
        )
