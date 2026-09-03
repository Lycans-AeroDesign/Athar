from django.core.exceptions import PermissionDenied

from audit.services import log_action

from .catalogue import PERMISSION_CATALOGUE, ROLE_CATALOGUE
from .models import Permission, Role, RolePermission, UserRole


def seed_permissions() -> dict[str, Permission]:
    """Idempotently ensures the global Permission catalogue exists - this is
    the one piece of rbac.catalogue that is NOT per-organization (see Role's
    own docstring). Called once at app bootstrap (management command) and
    again defensively from seed_rbac_for_organization, so a fresh org can be
    created even before the management command has ever run."""
    permissions_by_codename = {}
    for codename, description in PERMISSION_CATALOGUE:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"description": description}
        )
        permissions_by_codename[codename] = permission
    return permissions_by_codename


def seed_rbac_for_organization(organization) -> int:
    """Idempotently seeds ROLE_CATALOGUE's fixed six roles into `organization`
    - called from organization.services.create_organization for every newly
    self-service-created org, and from the seed_rbac management command for
    every existing org (so the command stays the dev/self-hosted bootstrap
    path it always was). Returns the number of newly created Role rows.
    Every organization gets an identical copy of the same named roles/
    permission sets - see the multi-tenancy plan's explicit non-goal on
    per-org custom roles; this is not a customization point."""
    permissions_by_codename = seed_permissions()
    created_roles = 0
    for name, (description, codenames) in ROLE_CATALOGUE.items():
        role, created = Role.objects.get_or_create(
            organization=organization, name=name, defaults={"description": description, "is_system": True}
        )
        created_roles += created
        for codename in codenames:
            role.permissions.add(permissions_by_codename[codename])
    return created_roles


def create_role(*, organization, name: str, description: str = "", actor, request=None) -> Role:
    role = Role.objects.create(organization=organization, name=name, description=description)
    log_action(actor=actor, action="role.create", target=role, request=request)
    return role


def update_role(*, role: Role, actor, request=None, **fields) -> Role:
    for field, value in fields.items():
        setattr(role, field, value)
    role.save(update_fields=[*fields.keys(), "updated_at"])
    log_action(actor=actor, action="role.update", target=role, request=request)
    return role


def delete_role(*, role: Role, actor, request=None) -> None:
    log_action(
        actor=actor,
        action="role.delete",
        metadata={"role_id": str(role.pk), "role_name": role.name},
        request=request,
    )
    role.delete()


def grant_permission(*, role: Role, permission: Permission, actor, request=None) -> bool:
    """Returns True if a new grant was created (idempotent otherwise)."""
    _, created = RolePermission.objects.get_or_create(
        role=role, permission=permission, defaults={"granted_by": actor}
    )
    if created:
        log_action(
            actor=actor,
            action="permission.grant",
            target=role,
            metadata={"permission": permission.codename},
            request=request,
        )
    return created


def revoke_permission(*, role: Role, permission: Permission, actor, request=None) -> bool:
    deleted, _ = RolePermission.objects.filter(role=role, permission=permission).delete()
    if deleted:
        log_action(
            actor=actor,
            action="permission.revoke",
            target=role,
            metadata={"permission": permission.codename},
            request=request,
        )
    return bool(deleted)


def assign_role(*, user, role: Role, actor, request=None) -> bool:
    _, created = UserRole.objects.get_or_create(user=user, role=role, defaults={"granted_by": actor})
    if created:
        log_action(
            actor=actor, action="role.assign", target=user, metadata={"role": role.name}, request=request
        )
    return created


def unassign_role(*, user, role: Role, actor, request=None) -> bool:
    deleted, _ = UserRole.objects.filter(user=user, role=role).delete()
    if deleted:
        log_action(
            actor=actor,
            action="role.unassign",
            target=user,
            metadata={"role": role.name},
            request=request,
        )
    return bool(deleted)


def set_user_active(*, user, is_active: bool, actor, request=None):
    """Blocks/unblocks a user within the actor's own org (view enforces the
    org scoping - see UserActiveView). `is_active=False` already locks the
    user out on their very next request (rest_framework_simplejwt's default
    CHECK_USER_IS_ACTIVE=True rejects both login and every subsequent
    authenticated call once it's False) - no separate session/token
    invalidation needed here. An admin can't block their own account: with
    only one org and no "remove" action, that would risk locking everyone
    out with nobody left able to unblock anyone."""
    if user.id == actor.id:
        raise PermissionDenied("You can't block or unblock your own account.")
    user.is_active = is_active
    user.save(update_fields=["is_active"])
    log_action(
        actor=actor,
        action="user.block" if not is_active else "user.unblock",
        target=user,
        request=request,
    )
    return user
