from django.core.management.base import BaseCommand
from django.db import transaction

from rbac.models import Permission, Role

# Catalogue from docs/VISION.md section 27, plus file.* added for the
# authenticated file-serving feature. Re-running this command only adds
# missing rows - it never removes permissions/roles an admin has since edited.
PERMISSION_CATALOGUE = [
    ("article.read", "View articles"),
    ("article.create", "Create articles/drafts"),
    ("article.update", "Edit article content"),
    ("article.review", "Review submitted articles"),
    ("article.publish", "Publish articles"),
    ("article.delete", "Delete articles"),
    ("article.archive", "Archive published articles"),
    ("category.manage", "Add and delete knowledge categories"),
    ("tag.manage", "Delete knowledge tags"),
    ("failure.read", "View failure reports"),
    ("failure.create", "Report failures"),
    ("failure.update", "Update failure reports"),
    ("failure.delete", "Delete failure reports"),
    ("question.create", "Ask questions"),
    ("question.answer", "Answer questions"),
    ("question.moderate", "Moderate questions"),
    ("project.read", "View projects"),
    ("project.create", "Create projects"),
    ("project.update", "Update projects"),
    ("project.delete", "Delete projects"),
    ("component.read", "View components"),
    ("component.create", "Create components"),
    ("component.update", "Update components"),
    ("component.delete", "Delete components"),
    ("sop.read", "View SOPs"),
    ("sop.create", "Create SOPs"),
    ("sop.update", "Update SOPs"),
    ("sop.delete", "Delete SOPs"),
    ("user.manage", "Manage users"),
    ("role.manage", "Manage roles"),
    ("permission.manage", "Manage role-permission assignments"),
    ("organization.manage", "Manage organization configuration"),
    ("branding.manage", "Manage branding"),
    ("audit.read", "View audit logs"),
    ("file.upload", "Upload files"),
    ("file.read", "Download/view files"),
    ("file.delete", "Delete files"),
]

# name -> (description, is_system, [codenames])
MEMBER_PERMISSIONS = [
    "article.read",
    "article.create",
    "question.create",
    "question.answer",
    "failure.create",
    "failure.read",
    "file.upload",
    "file.read",
    "project.read",
    "component.read",
    "component.create",
    "sop.read",
]
SENIOR_MEMBER_PERMISSIONS = MEMBER_PERMISSIONS + [
    "article.review",
    "article.update",
    "question.moderate",
    "failure.update",
    "component.update",
    # SOPs are safety-critical procedural docs and there's no review step
    # (see knowledge/models.py's Sop docstring) - gating creation/editing at
    # Senior Member+ rather than Member, unlike Component.
    "sop.create",
    "sop.update",
]
TEAM_HEAD_PERMISSIONS = SENIOR_MEMBER_PERMISSIONS + [
    "article.publish",
    "article.archive",
    "project.create",
    "project.update",
    "project.delete",
    "component.delete",
    "sop.delete",
]

ROLE_CATALOGUE = {
    "Guest": ("Public knowledge only.", ["article.read"]),
    "Applicant": ("Public/team handbook and permitted training.", ["article.read", "file.read"]),
    "Member": ("Standard team member.", MEMBER_PERMISSIONS),
    "Senior Member": ("Reviews and moderates content.", SENIOR_MEMBER_PERMISSIONS),
    "Team/Subteam Head": ("Publishes content, manages subteam knowledge.", TEAM_HEAD_PERMISSIONS),
    "Organization Admin": ("Full administrative access.", [codename for codename, _ in PERMISSION_CATALOGUE]),
}


class Command(BaseCommand):
    help = "Idempotently seed the default permission catalogue and role catalogue from docs/VISION.md."

    @transaction.atomic
    def handle(self, *args, **options):
        permissions_by_codename = {}
        created_permissions = 0
        for codename, description in PERMISSION_CATALOGUE:
            permission, created = Permission.objects.get_or_create(
                codename=codename, defaults={"description": description}
            )
            permissions_by_codename[codename] = permission
            created_permissions += created

        created_roles = 0
        for name, (description, codenames) in ROLE_CATALOGUE.items():
            role, created = Role.objects.get_or_create(
                name=name, defaults={"description": description, "is_system": True}
            )
            created_roles += created
            for codename in codenames:
                role.permissions.add(permissions_by_codename[codename])

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded RBAC catalogue: {created_permissions} new permissions, {created_roles} new roles."
            )
        )
