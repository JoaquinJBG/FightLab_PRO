from django.contrib import admin

from .models import UserState


@admin.register(UserState)
class UserStateAdmin(admin.ModelAdmin):
    list_display = ("profile", "key", "updated_at")
    list_filter = ("key",)
    search_fields = ("profile__user__email", "key")
    readonly_fields = ("updated_at",)
