from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["created_at", "actor", "action", "target_repr"]
    list_filter = ["action"]
    search_fields = ["actor__email", "action", "target_repr"]
    readonly_fields = [f.name for f in AuditLog._meta.fields]
