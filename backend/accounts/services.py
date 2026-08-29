from audit.services import log_action
from rbac.models import Role

from .models import User


def register_user(*, email: str, password: str, first_name: str = "", last_name: str = "", request=None) -> User:
    """Create a user and assign the default self-registration role (Guest).

    Business logic for registration lives here (not the view) since it spans
    two apps (accounts + rbac) and writes an audit entry.
    """
    user = User.objects.create_user(
        email=email, password=password, first_name=first_name, last_name=last_name
    )

    guest_role = Role.objects.filter(name="Guest").first()
    if guest_role:
        guest_role.user_roles.create(user=user)

    log_action(actor=None, action="user.register", target=user, request=request)
    return user
