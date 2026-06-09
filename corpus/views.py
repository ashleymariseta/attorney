from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from workflows.models import LLMProviderConfig
from workflows.providers import ProviderError, get_provider

from .models import CorpusCollection, ResearchCitation, ResearchQuery
from .serializers import (
    AskSerializer,
    CorpusCollectionSerializer,
    ResearchQuerySerializer,
)
from .services import build_research_prompt, retrieve


class CorpusCollectionViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only listing of available corpora (cases / rules / statutes …).
    Drives the scope chips in the Co-researcher UI."""

    serializer_class = CorpusCollectionSerializer
    permission_classes = [IsAuthenticated]
    queryset = CorpusCollection.objects.filter(is_active=True).order_by('kind', 'name')


def _is_lawyer(user):
    return getattr(user, 'role', None) == 'lawyer'


def _pick_provider_config(user):
    """Co-researcher uses the user's default provider config — any
    provider, ordered Anthropic → OpenAI → Local — so the lawyer doesn't
    have to pick a model on every ask."""
    qs = LLMProviderConfig.objects.filter(owner=user)
    return (
        qs.filter(is_default=True).first()
        or qs.order_by('provider').first()
    )


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

        retrieved = retrieve(data['question'], scopes=data.get('scope'))
        config = _pick_provider_config(request.user)
        if config is None:
            return Response(
                {'detail': 'Add an LLM provider in AI Workflows → Providers first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not retrieved:
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

        system, user_prompt = build_research_prompt(data['question'], retrieved)
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
            for rank, r in enumerate(retrieved):
                ResearchCitation.objects.create(query=q, chunk=r.chunk, rank=rank, score=r.score)

        try:
            completion = adapter.complete(system=system, user=user_prompt, model=model or None)
        except ProviderError as e:
            q.error = str(e)
            q.save(update_fields=['error'])
            return Response(
                {'detail': str(e), 'query': ResearchQuerySerializer(q).data},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        q.answer_text = completion.text
        q.model = completion.model or q.model
        q.tokens_in = completion.tokens_in
        q.tokens_out = completion.tokens_out
        q.save(update_fields=['answer_text', 'model', 'tokens_in', 'tokens_out'])
        return Response(ResearchQuerySerializer(q).data)


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
