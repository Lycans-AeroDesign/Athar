from django.apps import AppConfig


class TrainingConfig(AppConfig):
    name = "training"

    def ready(self):
        # Registers course search fields into knowledge.search's shared registry (a one-way
        # reach from training into knowledge), reusing its full-text + trigram implementation.
        # See training/search.py.
        from knowledge.search import SEARCH_FIELDS

        from .models import COURSE_SEARCH_FIELDS

        SEARCH_FIELDS["course"] = COURSE_SEARCH_FIELDS
