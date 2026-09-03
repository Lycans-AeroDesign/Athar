import getpass

from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from organization.models import Organization
from rbac.models import Role


class Command(BaseCommand):
    help = (
        "Create (or reuse) a superuser and assign the Organization Admin role, "
        "so the system is usable end-to-end without touching manage.py shell. "
        "Run seed_rbac first so the Organization Admin role exists. "
        "Multi-tenancy retrofit: pass --organization <slug> if more than one "
        "organization exists - defaults to the bootstrap/only one."
    )

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--password", required=False)
        parser.add_argument(
            "--organization", default=None, help="Organization slug - required if more than one organization exists."
        )

    def _resolve_organization(self, slug: str | None) -> Organization:
        if slug:
            try:
                return Organization.objects.get(slug=slug)
            except Organization.DoesNotExist as exc:
                raise CommandError(f"No organization with slug '{slug}'.") from exc
        count = Organization.objects.count()
        if count == 0:
            raise CommandError("No organizations exist yet - create one first (see organization.services.create_organization).")
        if count > 1:
            slugs = ", ".join(Organization.objects.order_by("slug").values_list("slug", flat=True))
            raise CommandError(f"Multiple organizations exist - pass --organization <slug>. Options: {slugs}")
        return Organization.objects.get()

    def handle(self, *args, **options):
        email = options["email"]
        password = options["password"] or getpass.getpass("Password: ")
        organization = self._resolve_organization(options["organization"])

        user, created = User.objects.get_or_create(
            email=email, defaults={"organization": organization, "is_staff": True, "is_superuser": True}
        )
        if created:
            user.set_password(password)
            user.save(update_fields=["password"])
            self.stdout.write(self.style.SUCCESS(f"Created superuser {email} in '{organization.slug}'."))
        else:
            self.stdout.write(f"User {email} already exists - reusing it.")
            if user.organization_id != organization.id:
                raise CommandError(
                    f"{email} already belongs to organization '{user.organization.slug}', "
                    f"not '{organization.slug}' - a user can't be moved between organizations."
                )
            if not (user.is_staff and user.is_superuser):
                user.is_staff = True
                user.is_superuser = True
                user.save(update_fields=["is_staff", "is_superuser"])

        try:
            admin_role = Role.objects.get(organization=organization, name="Organization Admin")
        except Role.DoesNotExist as exc:
            raise CommandError(
                f"Organization Admin role does not exist yet for '{organization.slug}' - run `manage.py seed_rbac` first."
            ) from exc

        admin_role.user_roles.get_or_create(user=user)
        self.stdout.write(self.style.SUCCESS(f"{email} now has the Organization Admin role in '{organization.slug}'."))
