from audit.services import log_action

from .models import Permission, Role, RolePermission, UserRole


def create_role(*, name: str, description: str = "", actor, request=None) -> Role:
    role = Role.objects.create(name=name, description=description)
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
