from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from rbac.models import Role

# email local-part -> Role name, one login per seeded role so every
# permission tier in the app can be clicked through manually. Not run as
# part of any startup path (unlike seed_rbac/bootstrap_admin) - dev/test
# convenience only, invoke by hand: `manage.py seed_test_users`.
TEST_USERS = {
    "guest": "Guest",
    "applicant": "Applicant",
    "member": "Member",
    "senior": "Senior Member",
    "head": "Team/Subteam Head",
    "admin": "Organization Admin",
}

DEFAULT_PASSWORD = "testpass123"


class Command(BaseCommand):
    help = (
        "Create one login per seeded role (guest@test.local ... admin@test.local, "
        f"all with password '{DEFAULT_PASSWORD}') so every permission tier can be "
        "tested by logging in as a different account. Run seed_rbac first."
    )

    def add_arguments(self, parser):
        parser.add_argument("--password", default=DEFAULT_PASSWORD)
        parser.add_argument("--domain", default="test.local")

    def handle(self, *args, **options):
        password = options["password"]
        domain = options["domain"]

        created_count = 0
        for local_part, role_name in TEST_USERS.items():
            try:
                role = Role.objects.get(name=role_name)
            except Role.DoesNotExist as exc:
                raise CommandError(f"Role '{role_name}' doesn't exist yet - run `manage.py seed_rbac` first.") from exc

            email = f"{local_part}@{domain}"
            user, created = User.objects.get_or_create(
                email=email, defaults={"first_name": role_name, "last_name": "(test)"}
            )
            if created:
                user.set_password(password)
                user.save(update_fields=["password"])
                created_count += 1
            role.user_roles.get_or_create(user=user)
            self.stdout.write(f"  {email:<24} -> {role_name}")

        self.stdout.write(
            self.style.SUCCESS(f"\n{created_count} new test user(s) created. Password for all: {password}")
        )
