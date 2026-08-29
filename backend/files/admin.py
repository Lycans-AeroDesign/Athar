from django.contrib import admin

from .models import StoredFile


@admin.register(StoredFile)
class StoredFileAdmin(admin.ModelAdmin):
    list_display = ["original_filename", "uploaded_by", "size", "required_permission", "created_at"]
    search_fields = ["original_filename"]
