from django.contrib import admin

from .models import (
    Course,
    CourseCategory,
    CourseEnrollment,
    CourseModule,
    CourseResource,
    LearningObjective,
    Lesson,
    LessonKnowledgeReference,
    LessonProgress,
)

admin.site.register(CourseCategory)
admin.site.register(Course)
admin.site.register(CourseModule)
admin.site.register(Lesson)
admin.site.register(LearningObjective)
admin.site.register(CourseResource)
admin.site.register(LessonKnowledgeReference)
admin.site.register(CourseEnrollment)
admin.site.register(LessonProgress)
