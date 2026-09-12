"""The fixed permission/role catalogue - extracted from
management/commands/seed_rbac.py once rbac.services.seed_rbac_for_organization
needed to call it per-organization (at org-creation time), not just once as a
global bootstrap command. `PERMISSION_CATALOGUE` is still global/unscoped
(see Role's own docstring); `ROLE_CATALOGUE` is seeded fresh into every new
organization - every org gets an identical copy of these five named roles,
not a customizable set (see the multi-tenancy plan's explicit non-goal on
per-org custom roles).

Role names match this app's actual student-team structure: Guest (lowest
tier - kept as the self-registration default, see accounts.services.
register_user), Member (current members), Mentor (graduated members who
still review/moderate - formerly "Senior Member"), Subteam Head (formerly
"Team/Subteam Head"), Organization Admin (board). A prior "Applicant" tier
was removed - it was never assigned anywhere in the app (self-registration
has always landed new users in Guest, not Applicant), so dropping it has no
effect on the registration flow.
"""

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
    ("test.read", "View tests/experiments"),
    ("test.create", "Record tests/experiments"),
    ("test.update", "Update tests/experiments"),
    ("test.delete", "Delete tests/experiments"),
    ("document.read", "View documents/resources"),
    ("document.create", "Add documents/resources"),
    # No document.delete - services.update_document/delete_document both gate
    # on "you're created_by, or you hold document.update" (see their own
    # docstrings), same ownership-or-override shape as question.moderate,
    # not a tiered read/create/update/delete-only scheme.
    ("document.update", "Edit/delete any document, and view RESTRICTED ones that aren't yours"),
    ("user.manage", "Manage users"),
    ("role.manage", "Manage roles"),
    ("permission.manage", "Manage role-permission assignments"),
    ("organization.manage", "Manage organization configuration"),
    ("branding.manage", "Manage branding"),
    ("audit.read", "View audit logs"),
    ("file.upload", "Upload files"),
    ("file.read", "Download/view files"),
    ("file.delete", "Delete files"),
    ("training.read", "View published courses, enroll, view lessons, track own progress"),
    ("training.create", "Create courses; edit/submit own course drafts"),
    ("training.update", "Edit any course/module/lesson/resource/knowledge reference regardless of ownership"),
    ("training.review", "Reject an in-review course back to its author"),
    ("training.publish", "Publish a draft or in-review course"),
    ("training.archive", "Archive/unarchive a published course"),
    ("training.delete", "Delete any course (own-draft deletion needs no permission)"),
    ("training.manage", "Manage course categories; view training statistics/admin dashboard"),
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
    "test.read",
    "test.create",
    "document.read",
    "document.create",
    "training.read",
]
MENTOR_PERMISSIONS = MEMBER_PERMISSIONS + [
    "article.review",
    "article.update",
    "question.moderate",
    "failure.update",
    "component.update",
    # SOPs are safety-critical procedural docs and there's no review step
    # (see knowledge/models.py's Sop docstring) - gating creation/editing at
    # Mentor+ rather than Member, unlike Component.
    "sop.create",
    "sop.update",
    "test.update",
    "document.update",
    "training.create",
    "training.update",
    "training.review",
]
SUBTEAM_HEAD_PERMISSIONS = MENTOR_PERMISSIONS + [
    "article.publish",
    "article.archive",
    "project.create",
    "project.update",
    "project.delete",
    "component.delete",
    "sop.delete",
    "test.delete",
    "training.publish",
    "training.archive",
]

ROLE_CATALOGUE = {
    "Guest": ("Public knowledge only.", ["article.read"]),
    "Member": ("Standard team member.", MEMBER_PERMISSIONS),
    "Mentor": ("Graduated member who reviews and moderates content.", MENTOR_PERMISSIONS),
    "Subteam Head": ("Publishes content, manages subteam knowledge.", SUBTEAM_HEAD_PERMISSIONS),
    "Organization Admin": ("Full administrative access (board).", [codename for codename, _ in PERMISSION_CATALOGUE]),
}
