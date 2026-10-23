"""Cross-tenant isolation matrix.

Every API route that takes an object id is requested with an id belonging to ANOTHER organization,
by that organization's most privileged user (an Organization Admin, so permissions are never the
reason for a refusal). Each must answer 404, as if the object did not exist.

Two guards keep the matrix honest:
- a positive control: the owning organization's admin must NOT get 404 for the same requests, which
  proves each fixture id and URL is real, so a 404 above can only come from tenant scoping;
- a completeness check that fails when a new id-bearing route is added to the API but not to ROUTES
  (or deliberately listed in EXEMPT with a reason).
"""

from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.urls import get_resolver, reverse
from django.urls.resolvers import URLResolver
from rest_framework.test import APITestCase

from accounts.models import InvitationCode, User
from backups.models import BackupJob, RestoreJob
from core.testing import RoleLoginMixin, create_test_organization
from files.models import StoredFile
from knowledge.models import (
    Answer,
    Article,
    ArticleAttachment,
    Bookmark,
    Category,
    Collection,
    CollectionItem,
    Component,
    ComponentAttachment,
    ComponentCategory,
    Document,
    Failure,
    FailureAttachment,
    KnowledgeRelation,
    Project,
    ProjectAttachment,
    Question,
    QuestionAttachment,
    RestrictedAccessGrant,
    Sop,
    SopAttachment,
    StorageLocation,
    Tag,
    Test,
    TestAttachment,
)
from rbac.models import Permission, Role
from training.models import (
    Course,
    CourseCategory,
    CourseModule,
    CourseResource,
    LearningObjective,
    Lesson,
    LessonKnowledgeReference,
)

GET, POST, PATCH, DELETE = "get", "post", "patch", "delete"


def _entity(prefix, key, *, workflow=(), attachments=True, writable=True):
    """Routes shared by the engineering-domain entities (detail, relations, attachments)."""
    methods = [GET, PATCH, DELETE] if writable else [GET]
    routes = [(f"knowledge-{prefix}-detail", methods, {"pk": key}), (f"knowledge-{prefix}-relations", [GET], {"pk": key})]
    if attachments:
        routes += [
            (f"knowledge-{prefix}-attachment-list", [GET, POST], {"pk": key}),
            (f"knowledge-{prefix}-attachment-detail", [DELETE], {"pk": key, "attachment_pk": f"{key}_attachment"}),
        ]
    routes += [(f"knowledge-{prefix}-{step}", [POST], {"pk": key}) for step in workflow]
    return routes


ROUTES = [
    ("auth-invitation-revoke", [POST], {"pk": "invitation"}),
    ("auth-user-password-reset-link", [POST], {"pk": "member"}),
    ("rbac-role-detail", [GET, PATCH, DELETE], {"pk": "role"}),
    ("rbac-role-permissions", [GET, POST], {"pk": "role"}),
    ("rbac-role-permission-detail", [DELETE], {"pk": "role", "permission_id": "permission"}),
    ("rbac-user-active", [POST], {"pk": "member"}),
    ("rbac-user-roles", [POST], {"pk": "member"}),
    ("rbac-user-role-detail", [DELETE], {"pk": "member", "role_id": "role"}),
    ("audit-user-activity", [GET], {"pk": "member"}),
    ("files-download", [GET], {"pk": "file"}),
    ("files-delete", [DELETE], {"pk": "file"}),
    ("knowledge-user-profile", [GET], {"pk": "member"}),
    ("knowledge-user-contributions", [GET], {"pk": "member"}),
    ("knowledge-category-detail", [PATCH, DELETE], {"pk": "category"}),
    ("knowledge-tag-detail", [DELETE], {"pk": "tag"}),
    *_entity("article", "article", workflow=("submit", "publish", "reject", "archive", "unarchive")),
    ("knowledge-article-revisions", [GET], {"pk": "article"}),
    *_entity("question", "question", workflow=("accept", "close", "reopen", "promote")),
    ("knowledge-answer-list-create", [GET, POST], {"pk": "question"}),
    ("knowledge-answer-detail", [PATCH, DELETE], {"pk": "answer"}),
    ("knowledge-relation-detail", [PATCH, DELETE], {"pk": "relation"}),
    ("knowledge-access-grant-detail", [DELETE], {"pk": "access_grant"}),
    ("knowledge-bookmark-detail", [DELETE], {"pk": "bookmark"}),
    ("knowledge-collection-detail", [GET, PATCH, DELETE], {"pk": "collection"}),
    ("knowledge-collection-item-add", [POST], {"pk": "collection"}),
    ("knowledge-collection-item-detail", [PATCH, DELETE], {"pk": "collection", "item_pk": "collection_item"}),
    ("knowledge-collection-reorder", [POST], {"pk": "collection"}),
    *_entity("project", "project"),
    *_entity("component", "component"),
    *_entity("failure", "failure"),
    *_entity("sop", "sop"),
    *_entity("test", "test"),
    *_entity("document", "document", attachments=False),
    ("knowledge-component-category-detail", [PATCH, DELETE], {"pk": "component_category"}),
    ("knowledge-storage-location-detail", [PATCH, DELETE], {"pk": "storage_location"}),
    ("training-category-detail", [PATCH, DELETE], {"pk": "course_category"}),
    ("training-course-detail", [GET, PATCH, DELETE], {"pk": "course"}),
    *[(f"training-course-{step}", [POST], {"pk": "course"}) for step in ("submit", "publish", "reject", "archive", "unarchive", "enroll")],
    ("training-course-access-grant-list-create", [POST], {"pk": "course"}),
    ("training-course-access-grant-detail", [DELETE], {"pk": "course", "grant_pk": "course_grant"}),
    ("training-course-progress", [GET], {"pk": "course"}),
    ("training-course-stats", [GET], {"pk": "course"}),
    ("training-module-list-create", [POST], {"pk": "course"}),
    ("training-module-reorder", [POST], {"pk": "course"}),
    ("training-module-detail", [PATCH, DELETE], {"pk": "module"}),
    ("training-lesson-list-create", [POST], {"pk": "module"}),
    ("training-lesson-reorder", [POST], {"pk": "module"}),
    ("training-lesson-detail", [GET, PATCH, DELETE], {"pk": "lesson"}),
    ("training-lesson-complete", [POST], {"pk": "lesson"}),
    ("training-objective-list-create", [GET, POST], {"pk": "lesson"}),
    ("training-objective-reorder", [POST], {"pk": "lesson"}),
    ("training-objective-detail", [PATCH, DELETE], {"pk": "objective"}),
    ("training-resource-list-create", [GET, POST], {"pk": "lesson"}),
    ("training-resource-reorder", [POST], {"pk": "lesson"}),
    ("training-resource-detail", [PATCH, DELETE], {"pk": "resource"}),
    ("training-knowledge-reference-list-create", [GET, POST], {"pk": "lesson"}),
    ("training-knowledge-reference-detail", [DELETE], {"pk": "knowledge_reference"}),
    ("backups-detail", [GET], {"pk": "backup_job"}),
    ("backups-download", [POST], {"pk": "backup_job"}),
    ("backups-restore-detail", [GET], {"pk": "restore_job"}),
]

# Id-bearing routes that are deliberately not object lookups in another tenant's data.
EXEMPT = {
    # Instance-operator (is_superuser) routes: cross-org by design, covered by platform_admin.tests.
    "platform-organization-detail": "platform admin",
    "platform-organization-users": "platform admin",
    "platform-organization-active": "platform admin",
    "platform-user-active": "platform admin",
    "platform-user-password-reset-link": "platform admin",
}

# Request bodies for routes that look up a second object named in the body (else they 404 on it).
BODIES = {
    ("rbac-role-permissions", POST): lambda ids: {"permission_id": str(ids["permission"].pk)},
    ("rbac-user-roles", POST): lambda ids: {"role_id": str(ids["role"].pk)},
}

# Requests that 404 even for the owning organization's admin, for reasons unrelated to tenancy.
CONTROL_404_EXPECTED = {
    ("knowledge-bookmark-detail", DELETE): "a bookmark is private to the user who created it",
}


def _uuid_route_names():
    """Names of every /api/ route that takes a uuid path parameter."""
    names = set()

    def walk(patterns, prefix=""):
        for pattern in patterns:
            if isinstance(pattern, URLResolver):
                walk(pattern.url_patterns, prefix + str(pattern.pattern))
                continue
            route = prefix + str(pattern.pattern)
            if route.startswith("api/") and "<uuid:" in route and pattern.name:
                names.add(pattern.name)

    walk(get_resolver().url_patterns)
    return names


class TenantIsolationTests(RoleLoginMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization("Tenant A")  # owns every fixture below
        cls.other_organization = create_test_organization("Tenant B")

        org = cls.organization
        cls.member = User.objects.create_user(email="member@a.example", password="password123", organization=org)

        def stored_file(name):
            return StoredFile.objects.create(
                organization=org, file=SimpleUploadedFile(name, b"data"), original_filename=name
            )

        cls.ids = ids = {}
        ids["member"] = cls.member
        ids["invitation"] = InvitationCode.objects.create(organization=org)
        ids["role"] = Role.objects.get(organization=org, name="Member")
        ids["permission"] = Permission.objects.first()
        ids["file"] = stored_file("a.txt")
        ids["category"] = Category.objects.create(organization=org, name="Cat", slug="cat")
        ids["tag"] = Tag.objects.create(organization=org, name="tag")
        ids["article"] = Article.objects.create(organization=org, title="A", slug="a", author=cls.member)
        ids["question"] = Question.objects.create(organization=org, title="Q", author=cls.member)
        ids["answer"] = Answer.objects.create(question=ids["question"], body="x", author=cls.member)
        ids["relation"] = KnowledgeRelation.objects.create(
            organization=org,
            source_content_type=ContentType.objects.get_for_model(Article),
            source_object_id=ids["article"].pk,
            target_content_type=ContentType.objects.get_for_model(Question),
            target_object_id=ids["question"].pk,
        )
        ids["access_grant"] = RestrictedAccessGrant.objects.create(
            organization=org,
            content_type=ContentType.objects.get_for_model(Article),
            object_id=ids["article"].pk,
            granted_user=cls.member,
        )
        ids["bookmark"] = Bookmark.objects.create(
            organization=org,
            content_type=ContentType.objects.get_for_model(Article),
            object_id=ids["article"].pk,
            user=cls.member,
        )
        ids["project"] = Project.objects.create(organization=org, name="P")
        ids["component"] = Component.objects.create(organization=org, name="C")
        ids["failure"] = Failure.objects.create(organization=org, title="F")
        ids["sop"] = Sop.objects.create(organization=org, title="S")
        ids["test"] = Test.objects.create(organization=org, title="T")
        ids["document"] = Document.objects.create(organization=org, title="D")
        ids["collection"] = Collection.objects.create(organization=org, title="Col", slug="col")
        ids["collection_item"] = CollectionItem.objects.create(
            collection=ids["collection"],
            content_type=ContentType.objects.get_for_model(ids["sop"]),
            object_id=ids["sop"].pk,
            order=0,
        )
        ids["component_category"] = ComponentCategory.objects.create(organization=org, name="CC", slug="cc")
        ids["storage_location"] = StorageLocation.objects.create(organization=org, name="Shelf")
        for key, model, field in (
            ("article", ArticleAttachment, "article"),
            ("question", QuestionAttachment, "question"),
            ("project", ProjectAttachment, "project"),
            ("component", ComponentAttachment, "component"),
            ("failure", FailureAttachment, "failure"),
            ("sop", SopAttachment, "sop"),
            ("test", TestAttachment, "test"),
        ):
            ids[f"{key}_attachment"] = model.objects.create(**{field: ids[key], "file": stored_file(f"{key}.txt")})
        ids["course_category"] = CourseCategory.objects.create(organization=org, name="TC", slug="tc")
        ids["course"] = Course.objects.create(organization=org, title="Course", slug="course", author=cls.member)
        ids["course_grant"] = RestrictedAccessGrant.objects.create(
            organization=org,
            content_type=ContentType.objects.get_for_model(Course),
            object_id=ids["course"].pk,
            granted_user=cls.member,
        )
        ids["module"] = CourseModule.objects.create(course=ids["course"], title="M", order=0)
        ids["lesson"] = Lesson.objects.create(module=ids["module"], title="L", order=0)
        ids["objective"] = LearningObjective.objects.create(lesson=ids["lesson"], text="O")
        ids["resource"] = CourseResource.objects.create(
            lesson=ids["lesson"], title="R", resource_type=CourseResource.ResourceType.EXTERNAL_LINK
        )
        ids["knowledge_reference"] = LessonKnowledgeReference.objects.create(
            lesson=ids["lesson"],
            content_type=ContentType.objects.get_for_model(Article),
            object_id=ids["article"].pk,
        )
        ids["backup_job"] = BackupJob.objects.create(organization=org)
        ids["restore_job"] = RestoreJob.objects.create(organization=org)

    def _admin_headers(self, organization, email):
        _, access = self._login_with_role(email, "Organization Admin", organization)
        return {"HTTP_AUTHORIZATION": f"Bearer {access}"}

    def _requests(self):
        for name, methods, kwarg_keys in ROUTES:
            url = reverse(name, kwargs={param: self.ids[key].pk for param, key in kwarg_keys.items()})
            for method in methods:
                yield name, method, url, BODIES.get((name, method), lambda ids: {})(self.ids)

    def _statuses(self, headers):
        """{(route name, method): status}, each request rolled back so one cannot affect the next."""
        self.client.raise_request_exception = False  # an empty body may 500; only 404-ness matters here
        statuses = {}
        for name, method, url, body in self._requests():
            with transaction.atomic():
                response = getattr(self.client, method)(url, body, format="json", **headers)
                transaction.set_rollback(True)
            statuses[(name, method)] = response.status_code
        return statuses

    def test_other_organizations_admin_gets_404_everywhere(self):
        headers = self._admin_headers(self.other_organization, "admin@b.example")

        leaks = {key: code for key, code in self._statuses(headers).items() if code != 404}

        self.assertEqual(leaks, {}, "Routes that did not answer 404 to another organization's admin")

    def test_control_owning_organizations_admin_never_gets_404(self):
        headers = self._admin_headers(self.organization, "admin@a.example")

        missing = {
            key: code
            for key, code in self._statuses(headers).items()
            if code == 404 and key not in CONTROL_404_EXPECTED
        }

        self.assertEqual(missing, {}, "Fixture or URL is wrong: the owner's own admin got 404")

    def test_every_uuid_route_is_in_the_matrix_or_exempt(self):
        covered = {name for name, _, _ in ROUTES} | set(EXEMPT)

        self.assertEqual(sorted(_uuid_route_names() - covered), [], "Add these routes to ROUTES or EXEMPT")
