"""Training's own search re-exports knowledge.search.search_filter rather
than duplicating its Postgres full-text + trigram implementation - the
"course" entry it needs in SEARCH_FIELDS is registered into that module's
shared registry by training/apps.py's ready() at startup (a one-time,
one-way reach from training into knowledge, never the reverse). See
views.TrainingSearchView for the actual endpoint - kept deliberately
separate from knowledge.views.SearchView per the Training Center plan's
§1.7: course-discovery intent and knowledge-lookup intent stay distinct."""

from knowledge.search import search_filter

__all__ = ["search_filter"]
