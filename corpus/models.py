"""Legal corpus + Co-researcher records.

The corpus is the grounded RAG backend for the Co-researcher feature and,
later, for the Research stage of an AI Workflow. Documents (judgements,
statutes, rules) are stored as plain text; chunks are sized for LLM context
windows. Retrieval is keyword-overlap on SQLite; swap to pgvector later by
replacing ``corpus.services.retrieve`` without touching the rest.
"""
from django.conf import settings
from django.db import models


class CorpusKind(models.TextChoices):
    CASE = 'case', 'Case'
    JUDGEMENT = 'judgement', 'Judgement'
    RULES = 'rules', 'High Court Rules'
    CONSTITUTION = 'constitution', 'Constitution'
    STATUTE = 'statute', 'Statute'


class CorpusCollection(models.Model):
    """A named grouping (e.g. ``Constitution of Zimbabwe 2013``). One
    collection can contain many documents."""

    slug = models.SlugField(unique=True, max_length=120)
    name = models.CharField(max_length=240)
    kind = models.CharField(max_length=16, choices=CorpusKind.choices)
    description = models.TextField(blank=True)
    source_url = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f'{self.get_kind_display()} · {self.name}'


class CorpusDocument(models.Model):
    """An individual judgement, statute section, or rule, etc."""

    collection = models.ForeignKey(CorpusCollection, on_delete=models.CASCADE, related_name='documents')
    title = models.CharField(max_length=400)
    citation = models.CharField(max_length=240, blank=True)
    jurisdiction = models.CharField(max_length=80, blank=True)
    year = models.PositiveSmallIntegerField(null=True, blank=True)
    body = models.TextField()
    source_url = models.URLField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-year', 'title']

    def __str__(self):
        return self.title


class CorpusChunk(models.Model):
    """Retrieval-sized slice of a document. Chunks are produced by
    :func:`corpus.services.chunk_text` (paragraph-split, ~1200 chars)."""

    document = models.ForeignKey(CorpusDocument, on_delete=models.CASCADE, related_name='chunks')
    ordinal = models.PositiveIntegerField(default=0)
    text = models.TextField()

    class Meta:
        ordering = ['document_id', 'ordinal']
        unique_together = ('document', 'ordinal')

    def __str__(self):
        return f'{self.document.title} #{self.ordinal}'


class ResearchQuery(models.Model):
    """One Co-researcher ask. Persisted as the audit anchor — every chunk
    retrieved, plus the provider/model used, is recorded against this row."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='research_queries')
    question = models.TextField()
    #: ISO list of CorpusKind values the user scoped the query to. Empty == all.
    scope = models.JSONField(default=list)
    answer_text = models.TextField(blank=True)
    provider = models.CharField(max_length=16, blank=True)
    model = models.CharField(max_length=80, blank=True)
    tokens_in = models.PositiveIntegerField(default=0)
    tokens_out = models.PositiveIntegerField(default=0)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.owner.email}: {self.question[:80]}'


class ResearchCitation(models.Model):
    """A retrieved chunk supplied to the model for a given ResearchQuery.
    Order matters — rank 0 is the highest-scored chunk."""

    query = models.ForeignKey(ResearchQuery, on_delete=models.CASCADE, related_name='citations')
    chunk = models.ForeignKey(CorpusChunk, on_delete=models.CASCADE, related_name='+')
    rank = models.PositiveIntegerField()
    score = models.FloatField(default=0.0)

    class Meta:
        ordering = ['query_id', 'rank']
