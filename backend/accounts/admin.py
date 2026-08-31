from django.contrib import admin

from .models import InvitationCode, User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ["email", "first_name", "last_name", "is_active", "is_staff", "date_joined"]
    search_fields = ["email", "first_name", "last_name"]
    readonly_fields = ["id", "date_joined"]


@admin.register(InvitationCode)
class InvitationCodeAdmin(admin.ModelAdmin):
    list_display = ["code", "created_by", "max_uses", "uses_count", "expires_at", "revoked_at", "created_at"]
    search_fields = ["code"]
    readonly_fields = ["id", "code", "created_at"]
