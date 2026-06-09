from rest_framework import serializers

from .models import (
    CorpusChunk,
    CorpusDocument,
    CorpusCollection,
    CorpusKind,
    ResearchCitation,
    ResearchQuery,
)


class CorpusCollectionSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source='get_kind_display', read_only=True)
    document_count = serializers.SerializerMethodField()

    class Meta:
        model = CorpusCollection
        fields = ['id', 'slug', 'name', 'kind', 'kind_display', 'description', 'source_url', 'document_count']

    def get_document_count(self, obj):
        return obj.documents.count()


class CorpusDocumentMiniSerializer(serializers.ModelSerializer):
    kind = serializers.CharField(source='collection.kind', read_only=True)
    kind_display = serializers.CharField(source='collection.get_kind_display', read_only=True)
    collection_name = serializers.CharField(source='collection.name', read_only=True)

    class Meta:
        model = CorpusDocument
        fields = ['id', 'title', 'citation', 'jurisdiction', 'year', 'source_url', 'kind', 'kind_display', 'collection_name']


class CitationOutSerializer(serializers.ModelSerializer):
    document = CorpusDocumentMiniSerializer(source='chunk.document', read_only=True)
    excerpt = serializers.SerializerMethodField()

    class Meta:
        model = ResearchCitation
        fields = ['id', 'rank', 'score', 'document', 'excerpt']

    def get_excerpt(self, obj):
        text = obj.chunk.text or ''
        return text[:600] + ('…' if len(text) > 600 else '')


class ResearchQuerySerializer(serializers.ModelSerializer):
    citations = CitationOutSerializer(many=True, read_only=True)

    class Meta:
        model = ResearchQuery
        fields = [
            'id', 'question', 'scope', 'answer_text', 'provider', 'model',
            'tokens_in', 'tokens_out', 'error', 'created_at', 'citations',
        ]
        read_only_fields = fields


class AskSerializer(serializers.Serializer):
    """Input validator for ``POST /co-researcher/ask/``."""

    question = serializers.CharField(min_length=4, max_length=2000)
    scope = serializers.ListField(
        child=serializers.ChoiceField(choices=CorpusKind.choices),
        required=False,
        allow_empty=True,
    )
    provider_config_id = serializers.IntegerField(required=False)
    model = serializers.CharField(required=False, allow_blank=True)
