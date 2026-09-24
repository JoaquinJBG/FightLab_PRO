from django.contrib import admin

from .models import BiometricsLog, ProgressPhoto, UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "gender", "height_cm", "preferred_units", "timezone")
    search_fields = ("user__email",)


@admin.register(BiometricsLog)
class BiometricsLogAdmin(admin.ModelAdmin):
    list_display = ("profile", "timestamp", "weight_kg", "source")
    list_filter = ("source",)
    search_fields = ("profile__user__email",)
    date_hierarchy = "timestamp"


@admin.register(ProgressPhoto)
class ProgressPhotoAdmin(admin.ModelAdmin):
    # `data` es el binario de la foto: fuera de list_display y del formulario
    # para no reventar el admin intentando pintar megabytes en una tabla o un
    # textarea.
    list_display = ("profile", "taken_at", "content_type", "width", "height", "created_at")
    list_filter = ("content_type",)
    exclude = ("data",)
    readonly_fields = ("content_type", "width", "height", "created_at")
    search_fields = ("profile__user__email",)
    date_hierarchy = "taken_at"
