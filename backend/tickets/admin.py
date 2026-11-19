from django.contrib import admin

from . import services
from .models import TicketPhoto


@admin.register(TicketPhoto)
class TicketPhotoAdmin(admin.ModelAdmin):
    """Solo la referencia y el tamaño: la foto no se ve desde el admin."""

    list_display = ("id", "profile", "taken_on", "size", "created_at")
    readonly_fields = ("profile", "plan", "taken_on", "key", "size", "content_type", "width", "height", "created_at")

    def changelist_view(self, request, extra_context=None):
        used = services.used_bytes()
        share = used / services.FREE_TIER_BYTES
        extra_context = {**(extra_context or {}), "title": f"Fotos de tickets: {used / 1000**3:.2f} GB de 10 GB ({share:.0%})"}
        return super().changelist_view(request, extra_context)
