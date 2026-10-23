"""A user's personal-data export (the "download my data" feature).

Covers what Athar holds about the user: their profile, the content they authored (including its
text), their personal records (bookmarks, course progress, policy acceptances), their uploads'
metadata and their audit trail. Never the password hash or other people's data.
"""

import json

from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone

# Columns that are internal indexes or file handles rather than the user's data.
_SKIPPED_COLUMNS = {"search_vector", "search_text", "file"}


def _rows(queryset) -> list[dict]:
    columns = [field.attname for field in queryset.model._meta.concrete_fields if field.name not in _SKIPPED_COLUMNS]
    return list(queryset.values(*columns))


def build_user_export(user) -> dict:
    # Imported here: these apps import accounts, so module-level imports would be circular.
    from audit.models import AuditLog
    from files.models import StoredFile
    from knowledge.models import (
        Answer,
        Article,
        Bookmark,
        Component,
        Document,
        Failure,
        Project,
        Question,
        Sop,
        Test,
    )
    from policies.models import PolicyAcceptance
    from training.models import Course, CourseEnrollment, LessonProgress

    from .models import InvitationCode

    authored = {
        "articles": Article.objects.filter(author=user),
        "questions": Question.objects.filter(author=user),
        "answers": Answer.objects.filter(author=user),
        "projects": Project.objects.filter(created_by=user),
        "components": Component.objects.filter(created_by=user),
        "failures": Failure.objects.filter(created_by=user),
        "sops": Sop.objects.filter(created_by=user),
        "tests": Test.objects.filter(created_by=user),
        "documents": Document.objects.filter(created_by=user),
        "courses": Course.objects.filter(author=user),
    }
    personal = {
        "bookmarks": Bookmark.objects.filter(user=user),
        "course_enrollments": CourseEnrollment.objects.filter(user=user),
        "completed_lessons": LessonProgress.objects.filter(enrollment__user=user),
        "policy_acceptances": PolicyAcceptance.objects.filter(user=user),
        "uploaded_files": StoredFile.objects.filter(uploaded_by=user),
        "invitation_codes_created": InvitationCode.objects.filter(created_by=user),
    }
    activity = AuditLog.objects.filter(actor=user).order_by("created_at")

    export = {
        "exported_at": timezone.now(),
        "profile": {
            "id": user.pk,
            "email": user.email,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "title": user.title,
            "preferences": user.preferences,
            "email_visible": user.email_visible,
            "date_joined": user.date_joined,
            "last_login": user.last_login,
            "organization": user.organization.name,
            "roles": list(user.user_roles.values_list("role__name", flat=True)),
        },
        "authored_content": {name: _rows(queryset) for name, queryset in authored.items()},
        "coauthored": {
            "articles": [str(pk) for pk in Article.objects.filter(co_authors=user).values_list("pk", flat=True)],
            "questions": [str(pk) for pk in Question.objects.filter(co_authors=user).values_list("pk", flat=True)],
            "sops": [str(pk) for pk in Sop.objects.filter(co_authors=user).values_list("pk", flat=True)],
        },
        "personal_records": {name: _rows(queryset) for name, queryset in personal.items()},
        "activity_log": list(
            activity.values("action", "target_repr", "created_at", "ip_address", "user_agent")
        ),
    }
    # Round-trip through the JSON encoder so UUIDs, datetimes and decimals are plain JSON values.
    return json.loads(json.dumps(export, cls=DjangoJSONEncoder))
