from django.contrib import admin

from .models import Permission, Role, RolePermission, UserRole


@admin.register(Permission)
class PermissionAdmin(admin.ModelAdmin):
    list_display = ["codename", "description"]
    search_fields = ["codename"]


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ["name", "is_system", "created_at"]
    search_fields = ["name"]


admin.site.register(RolePermission)
admin.site.register(UserRole)
