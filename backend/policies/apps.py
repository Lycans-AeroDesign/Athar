from django.apps import AppConfig


class PoliciesConfig(AppConfig):
    name = "policies"

    def ready(self):
        from . import schema  # noqa: F401 - registers the OpenAPI auth extension
