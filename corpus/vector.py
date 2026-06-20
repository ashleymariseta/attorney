"""Semantic retrieval over the Zimbabwe legal corpus (Chroma vector store).

Optional semantic backend for the Co-researcher. When ``chromadb`` and the
prebuilt index are available, :func:`vector_retrieve` returns the most relevant
chunks as :class:`corpus.services.Authority` objects; otherwise it returns
``None`` and the caller falls back to keyword search in
:func:`corpus.services.retrieve`.

The index is the one built under ``attorney/rag/chroma_db`` (285k Zimbabwean
judgments, statutes, gazettes and rules), embedded with a local MiniLM model —
so retrieval is free (no API tokens); only the retrieved chunks are sent to
Claude.
"""
from __future__ import annotations

import logging

from django.conf import settings

from .services import Authority

logger = logging.getLogger(__name__)

# UI scope (CorpusKind value) -> chroma metadata ``type`` values.
_SCOPE_TO_TYPES = {
    'case': ['judgment'],
    'judgement': ['judgment'],
    'rules': ['court_rule'],
    'statute': ['statute'],
    'constitution': ['statute'],  # the Constitution is stored among statutes
}
_TYPE_LABEL = {
    'judgment': 'Judgement',
    'statute': 'Statute',
    'court_rule': 'High Court Rule',
    'gazette': 'Gazette',
    'causelist': 'Cause list',
}

_collection = None
_unavailable = False


def _get_collection():
    """Lazily open the Chroma collection. Memoised; on any failure we flip a
    flag so we never retry (and the caller falls back to keyword search)."""
    global _collection, _unavailable
    if _unavailable:
        return None
    if _collection is not None:
        return _collection
    try:
        import chromadb

        client = chromadb.PersistentClient(path=settings.LEGAL_CHROMA_PATH)
        _collection = client.get_collection(settings.LEGAL_CHROMA_COLLECTION)
        return _collection
    except Exception as e:  # noqa: BLE001 — any failure → graceful fallback
        logger.warning('Legal vector index unavailable (%s); using keyword search.', e)
        _unavailable = True
        return None


def available() -> bool:
    return _get_collection() is not None


def vector_retrieve(question: str, scopes=None, k: int = 5):
    """Return up to ``k`` :class:`Authority` hits for ``question``, optionally
    restricted to the given UI scopes. Returns ``None`` when the index isn't
    available so the caller can fall back to keyword search."""
    col = _get_collection()
    if col is None or not (question or '').strip():
        return None

    types = sorted({t for s in (scopes or []) for t in _SCOPE_TO_TYPES.get(s, [])})
    where = None
    if len(types) == 1:
        where = {'type': types[0]}
    elif len(types) > 1:
        where = {'type': {'$in': types}}

    try:
        res = col.query(query_texts=[question], n_results=k, where=where)
    except Exception as e:  # noqa: BLE001
        logger.warning('Vector query failed (%s); using keyword search.', e)
        return None

    docs = (res.get('documents') or [[]])[0]
    metas = (res.get('metadatas') or [[]])[0]
    dists = (res.get('distances') or [[]])[0]

    hits: list[Authority] = []
    for doc, meta, dist in zip(docs, metas, dists):
        meta = meta or {}
        t = meta.get('type', '')
        hits.append(
            Authority(
                title=str(meta.get('title') or 'Legal document'),
                kind_display=_TYPE_LABEL.get(t, (t or 'Authority').title()),
                citation=str(meta.get('citation') or ''),
                text=doc or '',
                score=(1.0 - float(dist)) if dist is not None else 0.0,
            )
        )
    return hits
