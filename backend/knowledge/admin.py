from django.contrib import admin

from .models import (
    Answer,
    Article,
    ArticleRevision,
    Category,
    Component,
    Failure,
    Project,
    Question,
    Sop,
    Tag,
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
    list_display = ["title", "status", "category", "author", "updated_at"]
    list_filter = ["status", "category"]
    prepopulated_fields = {"slug": ["title"]}


@admin.register(ArticleRevision)
class ArticleRevisionAdmin(admin.ModelAdmin):
    list_display = ["article", "edited_by", "created_at"]


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ["title", "author", "created_at"]


@admin.register(Answer)
class AnswerAdmin(admin.ModelAdmin):
    list_display = ["question", "author", "created_at"]


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ["name", "status", "created_by", "updated_at"]
    list_filter = ["status"]


@admin.register(Component)
class ComponentAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "status", "manufacturer", "updated_at"]
    list_filter = ["status", "category"]


@admin.register(Failure)
class FailureAdmin(admin.ModelAdmin):
    list_display = ["title", "severity", "status", "component", "project", "date"]
    list_filter = ["severity", "status"]


@admin.register(Sop)
class SopAdmin(admin.ModelAdmin):
    list_display = ["title", "category", "mandatory", "updated_at"]
    list_filter = ["mandatory", "category"]
