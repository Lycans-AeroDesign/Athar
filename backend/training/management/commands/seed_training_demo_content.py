from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from knowledge.models import Article
from organization.models import Organization
from rbac.models import Role

from training import services
from training.models import Course, CourseEnrollment, CourseModule, CourseResource, Lesson, LessonKnowledgeReference

# Same three demo users/emails as knowledge.management.commands.seed_demo_content's
# DEMO_USERS - reusing them (rather than a separate set) means running both
# commands against the same organization produces one coherent demo login
# set, not two disjoint casts of characters. Deliberately not imported from
# that module though - app-local command, no cross-app import for a plain
# constant dict.
DEMO_USERS = {
    "member1@demo.local": ("Casey", "Nguyen", "Member"),
    "mentor1@demo.local": ("Priya", "Sharma", "Mentor"),
    "head1@demo.local": ("Jordan", "Lee", "Subteam Head"),
}
DEMO_PASSWORD = "demopass123"

# Leaves-first, mirrors knowledge.management.commands.seed_demo_content's
# own _RESET_SPECS shape - --reset only ever removes rows owned by
# DEMO_USERS, never real user data.
_RESET_SPECS = [
    (LessonKnowledgeReference, "created_by", "lesson__module__course__organization"),
    (CourseResource, "created_by", "lesson__module__course__organization"),
    (CourseEnrollment, "user", "organization"),
    (Course, "author", "organization"),
]


class Command(BaseCommand):
    help = (
        "Seeds a demo 'Introduction to Git & GitHub' training course - four "
        "modules (Git Fundamentals, Branches, Pull Requests, Team Workflow) "
        "covering a text lesson, an external video lesson, a resource, a "
        "Knowledge reference (if a suitable published article already exists "
        "in the org), and a demo enrollment/progress example. Built entirely "
        "through training.services functions (never raw .objects.create()), "
        "same convention as knowledge.management.commands.seed_demo_content. "
        "Meant for manual exploration/demoing, not automated tests."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--organization", default=None, help="Organization slug - required if more than one organization exists."
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete this command's own previously-seeded content (anything owned by its demo users) before reseeding.",
        )

    def _resolve_organization(self, slug: str | None) -> Organization:
        if slug:
            try:
                return Organization.objects.get(slug=slug)
            except Organization.DoesNotExist as exc:
                raise CommandError(f"No organization with slug '{slug}'.") from exc
        count = Organization.objects.count()
        if count == 0:
            raise CommandError("No organizations exist yet - create one first.")
        if count > 1:
            slugs = ", ".join(Organization.objects.order_by("slug").values_list("slug", flat=True))
            raise CommandError(f"Multiple organizations exist - pass --organization <slug>. Options: {slugs}")
        return Organization.objects.get()

    def _reset(self, organization) -> None:
        demo_emails = list(DEMO_USERS.keys())
        for model, owner_field, org_lookup in _RESET_SPECS:
            model.objects.filter(**{org_lookup: organization, f"{owner_field}__email__in": demo_emails}).delete()
        self.stdout.write("Cleared previously-seeded training demo content.")

    def _seed_users(self, organization) -> dict[str, User]:
        users = {}
        for email, (first_name, last_name, role_name) in DEMO_USERS.items():
            try:
                role = Role.objects.get(organization=organization, name=role_name)
            except Role.DoesNotExist as exc:
                raise CommandError(
                    f"Role '{role_name}' doesn't exist yet for '{organization.slug}' - run `manage.py seed_rbac` first."
                ) from exc
            user, created = User.objects.get_or_create(
                email=email, defaults={"organization": organization, "first_name": first_name, "last_name": last_name}
            )
            if created:
                user.set_password(DEMO_PASSWORD)
                user.save(update_fields=["password"])
            role.user_roles.get_or_create(user=user)
            users[email] = user
        return users

    def handle(self, *args, **options):
        organization = self._resolve_organization(options["organization"])
        if options["reset"]:
            self._reset(organization)

        users = self._seed_users(organization)
        member = users["member1@demo.local"]
        head = users["head1@demo.local"]

        course = services.create_course(
            actor=head,
            title="Introduction to Git & GitHub",
            short_description="Learn the version-control workflow the whole team uses, from first commit to first pull request.",
            description=(
                "## About this course\n\n"
                "A practical introduction to Git and GitHub for new team members - no prior version-control "
                "experience assumed. By the end, you'll be comfortable committing, branching, and opening pull "
                "requests as part of the team's normal workflow.\n"
            ),
            difficulty=Course.Difficulty.BEGINNER,
        )

        fundamentals = services.create_module(
            actor=head, course=course, title="Git Fundamentals",
            description="What Git is, and the core commands you'll use every day.",
        )
        what_is_git = services.create_lesson(
            actor=head, module=fundamentals, title="What is Git?",
            short_description="Version control, in plain terms.",
            lesson_type=Lesson.LessonType.TEXT,
            content=(
                "Git is a distributed version control system - it tracks every change to the team's code and "
                "documents over time, and lets multiple people work on the same project without overwriting "
                "each other's work.\n\n"
                "Every change is recorded as a **commit**: a snapshot of the project at one point in time, with "
                "a message explaining why the change was made.\n"
            ),
            estimated_minutes=10,
        )
        services.create_objective(actor=head, lesson=what_is_git, text="Explain what a version control system does.")
        services.create_objective(actor=head, lesson=what_is_git, text="Explain what a commit represents.")

        first_commit_video = services.create_lesson(
            actor=head, module=fundamentals, title="Your First Commit",
            short_description="A walkthrough of cloning a repo and making your first commit.",
            lesson_type=Lesson.LessonType.VIDEO,
            content="Follow along in your own terminal - pause the video after each step.",
            estimated_minutes=18,
        )
        services.create_resource(
            actor=head, lesson=first_commit_video, title="Your First Commit - Recording",
            resource_type=CourseResource.ResourceType.EXTERNAL_LINK,
            provider=CourseResource.Provider.GOOGLE_DRIVE,
            url="https://drive.google.com/file/d/DEMO_PLACEHOLDER_FILE_ID/view",
            description="Screen recording of the full clone-commit-push workflow.",
            is_primary=True,
        )

        branches = services.create_module(
            actor=head, course=course, title="Branches",
            description="Working on changes in isolation before merging them in.",
        )
        branching_basics = services.create_lesson(
            actor=head, module=branches, title="Branching Basics",
            short_description="Why we branch, and how to create one.",
            lesson_type=Lesson.LessonType.TEXT,
            content=(
                "A branch is an independent line of development - creating one lets you work on a change "
                "without affecting the team's main codebase until it's ready.\n\n"
                "`git checkout -b my-feature` creates and switches to a new branch in one step.\n"
            ),
            estimated_minutes=12,
        )
        services.create_objective(actor=head, lesson=branching_basics, text="Create a new branch from the command line.")
        services.create_objective(actor=head, lesson=branching_basics, text="Explain why we avoid committing directly to main.")

        pull_requests = services.create_module(
            actor=head, course=course, title="Pull Requests",
            description="Getting your changes reviewed and merged.",
        )
        opening_a_pr = services.create_lesson(
            actor=head, module=pull_requests, title="Opening a Pull Request",
            short_description="Turning a branch into something the team can review.",
            lesson_type=Lesson.LessonType.TEXT,
            content=(
                "A pull request (PR) proposes merging your branch into main, and gives the team a place to "
                "review and discuss the change before it lands.\n\n"
                "A good PR description explains **why** the change was made, not just what changed.\n"
            ),
            estimated_minutes=10,
        )
        # Knowledge reference - only added if a suitable published article
        # already exists in this org (e.g. from knowledge.seed_demo_content).
        # Skipped gracefully otherwise, per the plan's LessonKnowledgeReference
        # allowlist/resolution needing a real target to point at.
        candidate_article = Article.objects.filter(organization=organization, status=Article.Status.PUBLISHED).first()
        if candidate_article is not None:
            services.create_knowledge_reference(
                actor=head, lesson=opening_a_pr, content_type="article", object_id=candidate_article.pk,
                note="Example of a well-documented change, for reference.",
            )

        practice_exercise = services.create_lesson(
            actor=head, module=pull_requests, title="Practice: Open Your First PR",
            short_description="Apply what you've learned on a real (practice) repository.",
            lesson_type=Lesson.LessonType.EXERCISE,
            content=(
                "**Instructions:** Clone the practice repository, create a branch named after yourself, add a "
                "line with your name to `CONTRIBUTORS.md`, and open a pull request.\n\n"
                "**Expected outcome:** A pull request appears in the practice repository's PR list, with a clear "
                "title and description.\n"
            ),
            estimated_minutes=20,
            is_required=False,
        )
        services.create_resource(
            actor=head, lesson=practice_exercise, title="Practice Repository",
            resource_type=CourseResource.ResourceType.EXTERNAL_LINK,
            provider=CourseResource.Provider.GITHUB,
            url="https://github.com/example-org/git-practice",
            description="A disposable repository for practicing the PR workflow.",
            is_primary=True,
        )

        team_workflow = services.create_module(
            actor=head, course=course, title="Team Workflow",
            description="How the pieces fit together day to day.",
        )
        putting_it_together = services.create_lesson(
            actor=head, module=team_workflow, title="Putting It All Together",
            short_description="A recap of the full commit-branch-PR-merge cycle.",
            lesson_type=Lesson.LessonType.TEXT,
            content=(
                "You now know the full cycle the team uses for every change: branch, commit, push, open a PR, "
                "get it reviewed, and merge. From here, the best way to get comfortable is to use it - open a "
                "small PR for your next real task.\n"
            ),
            estimated_minutes=8,
        )

        services.publish_course(actor=head, course=course)

        # Demo enrollment/progress example - member1 is partway through.
        enrollment = services.enroll_in_course(actor=member, course=course)
        services.mark_lesson_complete(actor=member, lesson=what_is_git)
        services.mark_lesson_complete(actor=member, lesson=first_commit_video)
        services.mark_lesson_complete(actor=member, lesson=branching_basics)

        total_lessons = Lesson.objects.filter(module__course=course).count()

        self.stdout.write(
            self.style.SUCCESS(
                f"\nSeeded training demo course 'Introduction to Git & GitHub' in '{organization.slug}' "
                f"({total_lessons} lessons across 4 modules). Demo logins (password '{DEMO_PASSWORD}'):\n"
                f"  member1@demo.local -> Member (partway through the course, {enrollment.lesson_progress.count()}/{total_lessons} lessons complete)\n"
                f"  mentor1@demo.local -> Mentor\n"
                f"  head1@demo.local   -> Subteam Head (course author)\n"
            )
        )
