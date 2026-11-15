import logging
from datetime import timedelta
from unittest import mock

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from core.testing import RoleLoginMixin, create_test_organization

from .models import ErrorEvent
from .tasks import purge_old_error_events


class ErrorLogTests(RoleLoginMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization("Operator Org")

    def _operator(self):
        user, token = self._login_with_role("op@a.example", "Organization Admin")
        user.is_superuser = True
        user.save(update_fields=["is_superuser"])
        return user, {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def _log_failure(self, message="boom 42"):
        try:
            raise RuntimeError(message)
        except RuntimeError:
            logging.getLogger("athar.test").exception("Task failed")

    def test_backend_error_is_recorded_with_traceback_and_grouped(self):
        self._log_failure("boom 1")
        self._log_failure("boom 2")  # same place, different values -> same group

        event = ErrorEvent.objects.get()
        self.assertEqual(event.source, "backend")
        self.assertEqual(event.exception_type, "RuntimeError")
        self.assertEqual(event.logger, "athar.test")
        self.assertEqual(event.count, 2)
        self.assertIn("Traceback (most recent call last)", event.traceback)
        self.assertIn("RuntimeError: boom 2", event.traceback)  # latest occurrence kept

    def test_unhandled_request_exception_is_recorded_with_request_context(self):
        user, headers = self._operator()
        self.client.raise_request_exception = False
        with mock.patch("platform_admin.services.instance_summary", side_effect=ValueError("bad state")):
            response = self.client.get(reverse("platform-summary") + "?q=secret", **headers)
        self.assertEqual(response.status_code, 500)

        event = ErrorEvent.objects.get(exception_type="ValueError")
        self.assertEqual(event.logger, "django.request")
        self.assertEqual(event.method, "GET")
        self.assertEqual(event.path, reverse("platform-summary"))  # no query string
        self.assertEqual(event.user, user)
        self.assertEqual(event.organization, user.organization)
        self.assertIn("ValueError: bad state", event.traceback)

    def test_recurrence_reopens_a_resolved_error(self):
        self._log_failure()
        ErrorEvent.objects.update(resolved_at=timezone.now())
        self._log_failure()
        self.assertIsNone(ErrorEvent.objects.get().resolved_at)

    def test_disallowed_host_noise_is_ignored(self):
        logging.getLogger("django.security.DisallowedHost").error("Invalid HTTP_HOST header")
        self.assertFalse(ErrorEvent.objects.exists())

    def test_browser_report_from_signed_out_visitor(self):
        response = self.client.post(
            reverse("platform-error-report"),
            {
                "name": "TypeError",
                "message": "x is undefined",
                "stack": "TypeError: x is undefined\n    at render (app.js:10:5)",
                "component_stack": "\n    at Dashboard",
                "url": "https://athar.example/en/knowledge?search=private#top",
            },
            format="json",
            HTTP_USER_AGENT="TestBrowser/1.0",
        )
        self.assertEqual(response.status_code, 204)
        event = ErrorEvent.objects.get()
        self.assertEqual(event.source, "frontend")
        self.assertEqual(event.path, "/en/knowledge")
        self.assertEqual(event.user_agent, "TestBrowser/1.0")
        self.assertIsNone(event.user)
        self.assertIn("at render", event.traceback)
        self.assertIn("React component stack", event.traceback)

    def test_browser_report_requires_a_message(self):
        response = self.client.post(reverse("platform-error-report"), {"name": "Error"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_error_log_is_platform_admin_only(self):
        self._log_failure()
        event = ErrorEvent.objects.get()
        _, token = self._login_with_role("admin@a.example", "Organization Admin")
        headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
        self.assertEqual(self.client.get(reverse("platform-error-list"), **headers).status_code, 403)
        detail = reverse("platform-error-detail", kwargs={"pk": event.pk})
        self.assertEqual(self.client.get(detail, **headers).status_code, 403)
        self.assertEqual(self.client.delete(detail, **headers).status_code, 403)
        resolved = reverse("platform-error-resolved", kwargs={"pk": event.pk})
        response = self.client.post(resolved, {"is_resolved": True}, format="json", **headers)
        self.assertEqual(response.status_code, 403)
        self.assertTrue(ErrorEvent.objects.filter(pk=event.pk, resolved_at__isnull=True).exists())

    def test_operator_lists_filters_resolves_and_deletes(self):
        _, headers = self._operator()
        self._log_failure()
        self.client.post(reverse("platform-error-report"), {"message": "chunk failed"}, format="json")
        backend = ErrorEvent.objects.get(source="backend")
        list_url = reverse("platform-error-list")

        listing = self.client.get(list_url, **headers).json()
        self.assertEqual(listing["count"], 2)
        self.assertNotIn("traceback", listing["results"][0])
        only_frontend = self.client.get(list_url + "?source=frontend", **headers).json()
        self.assertEqual([row["message"] for row in only_frontend["results"]], ["chunk failed"])
        self.assertEqual(self.client.get(list_url + "?search=RuntimeError", **headers).json()["count"], 1)

        detail = self.client.get(reverse("platform-error-detail", kwargs={"pk": backend.pk}), **headers).json()
        self.assertIn("RuntimeError", detail["traceback"])

        resolved_url = reverse("platform-error-resolved", kwargs={"pk": backend.pk})
        bad = self.client.post(resolved_url, {"is_resolved": "yes"}, format="json", **headers)
        self.assertEqual(bad.status_code, 400)
        response = self.client.post(resolved_url, {"is_resolved": True}, format="json", **headers)
        self.assertIsNotNone(response.json()["resolved_at"])
        self.assertEqual(self.client.get(list_url, **headers).json()["count"], 1)
        self.assertEqual(self.client.get(list_url + "?status=resolved", **headers).json()["count"], 1)
        self.assertEqual(self.client.get(list_url + "?status=all", **headers).json()["count"], 2)
        self.assertEqual(self.client.get(reverse("platform-summary"), **headers).json()["open_error_count"], 1)

        delete = self.client.delete(reverse("platform-error-detail", kwargs={"pk": backend.pk}), **headers)
        self.assertEqual(delete.status_code, 204)
        self.assertFalse(ErrorEvent.objects.filter(pk=backend.pk).exists())

    def test_old_errors_are_purged(self):
        self._log_failure()
        ErrorEvent.objects.update(last_seen=timezone.now() - timedelta(days=31))
        self.client.post(reverse("platform-error-report"), {"message": "recent"}, format="json")
        self.assertEqual(purge_old_error_events(), 1)
        self.assertEqual(list(ErrorEvent.objects.values_list("message", flat=True)), ["recent"])
