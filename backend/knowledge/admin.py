from django.contrib import admin

from .models import (
    Answer,
    Article,
    ArticleRevision,
    Bookmark,
    Category,
    Component,
    Document,
    Failure,
    Project,
    Question,
    RestrictedAccessGrant,
    Sop,
    Tag,
    Test,
)


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "slug"]
    prepopulated_fields = {"slug": ["name"]}


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ["name"]


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ["title", "status", "visibility", "category", "author", "updated_at"]
    list_filter = ["status", "visibility", "category"]
    prepopulated_fields = {"slug": ["title"]}


@admin.register(ArticleRevision)
class ArticleRevisionAdmin(admin.ModelAdmin):
    list_display = ["article", "edited_by", "created_at"]


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ["title", "visibility", "author", "created_at"]
    list_filter = ["visibility"]


@admin.register(Answer)
class AnswerAdmin(admin.ModelAdmin):
    list_display = ["question", "author", "created_at"]


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ["name", "status", "visibility", "created_by", "updated_at"]
    list_filter = ["status", "visibility"]


@admin.register(Component)
class ComponentAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "status", "visibility", "manufacturer", "updated_at"]
    list_filter = ["status", "visibility", "category"]


@admin.register(Failure)
class FailureAdmin(admin.ModelAdmin):
    list_display = ["title", "severity", "status", "visibility", "component", "project", "date"]
    list_filter = ["severity", "status", "visibility"]


@admin.register(Sop)
class SopAdmin(admin.ModelAdmin):
    list_display = ["title", "category", "mandatory", "visibility", "updated_at"]
    list_filter = ["mandatory", "visibility", "category"]


@admin.register(Test)
class TestAdmin(admin.ModelAdmin):
    list_display = ["title", "test_type", "status", "pass_fail", "visibility", "project", "date"]
    list_filter = ["test_type", "status", "pass_fail", "visibility"]


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ["title", "doc_type", "source", "visibility", "category", "publication_date"]
    list_filter = ["doc_type", "source", "visibility", "category"]


@admin.register(RestrictedAccessGrant)
class RestrictedAccessGrantAdmin(admin.ModelAdmin):
    list_display = ["content_type", "object_id", "granted_user", "granted_by", "created_at"]
    list_filter = ["content_type"]


@admin.register(Bookmark)
class BookmarkAdmin(admin.ModelAdmin):
    list_display = ["content_type", "object_id", "user", "created_at"]
    list_filter = ["content_type"]
