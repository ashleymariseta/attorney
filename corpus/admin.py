from django.contrib import admin

from .models import (
    CorpusChunk,
    CorpusCollection,
    CorpusDocument,
    ResearchCitation,
    ResearchQuery,
)


@admin.register(CorpusCollection)
class CorpusCollectionAdmin(admin.ModelAdmin):
    list_display = ('name', 'kind', 'is_active', 'created_at')
    list_filter = ('kind', 'is_active')
    search_fields = ('name', 'slug')


@admin.register(CorpusDocument)
class CorpusDocumentAdmin(admin.ModelAdmin):
    list_display = ('title', 'collection', 'citation', 'year', 'jurisdiction')
    list_filter = ('collection__kind', 'jurisdiction', 'year')
    search_fields = ('title', 'citation', 'body')
    raw_id_fields = ('collection',)


@admin.register(CorpusChunk)
class CorpusChunkAdmin(admin.ModelAdmin):
    list_display = ('document', 'ordinal')
    search_fields = ('document__title', 'text')
    raw_id_fields = ('document',)


@admin.register(ResearchQuery)
class ResearchQueryAdmin(admin.ModelAdmin):
    list_display = ('owner', 'provider', 'model', 'created_at')
    list_filter = ('provider',)
    search_fields = ('owner__email', 'question')


@admin.register(ResearchCitation)
class ResearchCitationAdmin(admin.ModelAdmin):
    list_display = ('query', 'rank', 'chunk', 'score')
    raw_id_fields = ('query', 'chunk')
