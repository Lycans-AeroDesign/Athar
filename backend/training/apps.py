from django.apps import AppConfig


class TrainingConfig(AppConfig):
    name = "training"

    def ready(self):
        # Registers this app's course search fields into knowledge.search's
        # shared registry at startup - a one-way reach from training into
        # knowledge (never the reverse), so Training's own SearchView can
        # reuse knowledge.search.search_filter's Postgres full-text +
        # trigram implementation without duplicating it. See training/search.py.
        from knowledge.search import SEARCH_FIELDS

        SEARCH_FIELDS["course"] = ("title", ("short_description", "description"))
