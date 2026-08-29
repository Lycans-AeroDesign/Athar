import getpass

from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from rbac.models import Role


class Command(BaseCommand):
    help = (
        "Create (or reuse) a superuser and assign the Organization Admin role, "
        "so the system is usable end-to-end without touching manage.py shell. "
        "Run seed_rbac first so the Organization Admin role exists."
    )

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--password", required=False)

    def handle(self, *args, **options):
        email = options["email"]
        password = options["password"] or getpass.getpass("Password: ")

        user, created = User.objects.get_or_create(
            email=email, defaults={"is_staff": True, "is_superuser": True}
        )
        if created:
            user.set_password(password)
            user.save(update_fields=["password"])
            self.stdout.write(self.style.SUCCESS(f"Created superuser {email}."))
        else:
            self.stdout.write(f"User {email} already exists - reusing it.")
            if not (user.is_staff and user.is_superuser):
                user.is_staff = True
                user.is_superuser = True
                user.save(update_fields=["is_staff", "is_superuser"])

        try:
            admin_role = Role.objects.get(name="Organization Admin")
        except Role.DoesNotExist as exc:
            raise CommandError(
                "Organization Admin role does not exist yet - run `manage.py seed_rbac` first."
            ) from exc

        admin_role.user_roles.get_or_create(user=user)
        self.stdout.write(self.style.SUCCESS(f"{email} now has the Organization Admin role."))
