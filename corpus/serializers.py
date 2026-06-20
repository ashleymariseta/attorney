from rest_framework import serializers

from .models import (
    CorpusChunk,
    CorpusDocument,
    CorpusCollection,
    CorpusKind,
    ResearchCitation,
    ResearchConversation,
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
    document = serializers.SerializerMethodField()
    excerpt = serializers.SerializerMethodField()

    class Meta:
        model = ResearchCitation
        fields = ['id', 'rank', 'score', 'document', 'excerpt']

    def get_document(self, obj):
        # Keyword hits are backed by a CorpusChunk/Document; semantic (vector)
        # hits carry a snapshot instead. Present a uniform shape either way.
        if obj.chunk_id and obj.chunk and obj.chunk.document_id:
            return CorpusDocumentMiniSerializer(obj.chunk.document).data
        return {
            'id': None,
            'title': obj.source_title,
            'citation': '',
            'jurisdiction': '',
            'year': None,
            'source_url': '',
            'kind': '',
            'kind_display': obj.source_kind,
            'collection_name': obj.source_kind,
        }

    def get_excerpt(self, obj):
        text = (obj.chunk.text if (obj.chunk_id and obj.chunk) else obj.snippet) or ''
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


class ConversationListSerializer(serializers.ModelSerializer):
    message_count = serializers.SerializerMethodField()

    class Meta:
        model = ResearchConversation
        fields = ['id', 'title', 'message_count', 'created_at', 'updated_at']
        read_only_fields = fields

    def get_message_count(self, obj):
        return len(obj.messages or [])


class ConversationDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = ResearchConversation
        fields = ['id', 'title', 'messages', 'created_at', 'updated_at']
        read_only_fields = fields
