"""Postgres full-text search with relevance ranking - replaces the plain
`icontains` OR-chains that used to be hand-maintained separately in
SearchView and each engineering ListCreateView's own `?q=` filter. See
core/migrations/0001_enable_pg_trgm.py for the extension this depends on.
"""

import re

from django.contrib.postgres.search import SearchQuery, SearchRank, SearchVector, TrigramWordSimilarity
from django.db.models import Q, QuerySet, TextField, Value
from django.db.models.functions import Concat

# 'simple' tokenizes on whitespace/punctuation with no language-specific
# stemming or stopword removal. This app's content is bilingual (English/
# Arabic technical writing) - Postgres' 'english' config would silently
# mangle Arabic text, and its English-specific stemming/stopword removal
# isn't obviously right for short technical titles or part numbers either.
# Revisit with real per-locale configs only if plain tokenizing proves not
# good enough.
SEARCH_CONFIG = "simple"

# model_name -> (primary title/name field, other fields folded into the
# vector at a lower weight). Exactly the field lists SearchView and each
# ListCreateView's own ?q= filter used to hand-maintain as icontains chains -
# kept here once so the two can't drift out of sync with each other.
SEARCH_FIELDS: dict[str, tuple[str, tuple[str, ...]]] = {
    "article": ("title", ("excerpt", "content")),
    "question": ("title", ("body",)),
    "project": ("name", ("description",)),
    "component": ("name", ("summary", "manufacturer", "part_number", "inventory_notes")),
    "failure": ("title", ("summary", "root_cause")),
    "sop": ("title", ("content",)),
    "test": ("title", ("objective", "results", "conclusion")),
    "document": ("title", ("description",)),
}

# word_similarity() (unlike plain similarity()) scores the *best-matching
# substring* of the target text against the query, rather than diluting the
# score over the whole concatenated field length - that's what makes it a
# faithful stand-in for `icontains`'s "matches anywhere, in any field"
# behavior even when other_fields includes long body text alongside a short
# title. Its natural scores run higher than plain similarity()'s, hence the
# higher cutoff than a bare trigram-similarity threshold would use.
TRIGRAM_THRESHOLD = 0.4


def _concat_fields(fields: tuple[str, ...]):
    """A single text expression covering every searched field, for the
    trigram fallback below - `icontains` used to match a substring in *any*
    field, and TrigramWordSimilarity needs one expression to search within,
    not a per-field OR (word_similarity doesn't compose across an OR of
    separate scores the way a boolean match would)."""
    if len(fields) == 1:
        return fields[0]
    parts = []
    for index, field in enumerate(fields):
        if index:
            parts.append(Value(" "))
        parts.append(field)
    # Fields mix CharField (name/manufacturer/part_number) and TextField
    # (summary/content/body/...) across models - Concat can't infer a single
    # output_field from a mix of the two on its own.
    return Concat(*parts, output_field=TextField())


def search_filter(queryset: QuerySet, query: str, model_name: str) -> QuerySet:
    """Filters `queryset` to rows matching `query`, annotating `rank`
    (full-text relevance) and `similarity` (trigram word-similarity against
    every searched field) so callers can order by relevance, or ignore both
    and sort by `updated_at` instead.

    Matches on either signal, not full-text alone: plain word-based
    full-text search wouldn't catch a mid-word/typo query like "ocessing"
    for "Processing" the way `icontains` implicitly did, so trigram
    word-similarity across the same fields is kept as a fallback for
    exactly that case.
    """
    primary_field, other_fields = SEARCH_FIELDS[model_name]
    all_fields = (primary_field, *other_fields)

    vector = SearchVector(primary_field, weight="A", config=SEARCH_CONFIG)
    for field in other_fields:
        vector += SearchVector(field, weight="B", config=SEARCH_CONFIG)
    ts_query = SearchQuery(query, config=SEARCH_CONFIG, search_type="websearch")

    return queryset.annotate(
        rank=SearchRank(vector, ts_query),
        similarity=TrigramWordSimilarity(query, _concat_fields(all_fields)),
    ).filter(Q(rank__gt=0) | Q(similarity__gt=TRIGRAM_THRESHOLD))


# Ordered: fenced code first (its contents aren't prose), then images before
# links (an image is a link with a leading "!"), then inline syntax.
_MARKDOWN_TO_TEXT = [
    (re.compile(r"```.*?(```|$)", re.DOTALL), " "),
    (re.compile(r"!\[([^\]]*)\]\([^)]*\)"), r"\1"),
    (re.compile(r"\[([^\]]*)\]\([^)]*\)"), r"\1"),
    (re.compile(r"^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+(\[[ xX]\]\s+)?", re.MULTILINE), ""),
    (re.compile(r"^\s*\|?\s*:?-{3,}.*$", re.MULTILINE), " "),
    (re.compile(r"[*`~]+"), ""),
    (re.compile(r"\|"), " "),
    (re.compile(r"\s+"), " "),
]


def plain_text_excerpt(markdown: str, limit: int = 200) -> str:
    """Readable plain text for a search-result snippet. Most searchable
    fields are markdown (article excerpts/content, question bodies, SOPs,
    ...), and a raw slice of the source showed link syntax like
    "[Battery thermal runaway](/failures/6a31...)" in the results list."""
    text = markdown or ""
    for pattern, replacement in _MARKDOWN_TO_TEXT:
        text = pattern.sub(replacement, text)
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0] + "…"
