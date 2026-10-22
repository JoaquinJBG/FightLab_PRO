from django.contrib import admin

from .models import AIUsage


@admin.register(AIUsage)
class AIUsageAdmin(admin.ModelAdmin):
    """Gasto por usuario y día: filtra por fecha para ver el consumo de un día."""

    list_display = ("date", "user", "kind", "count", "input_tokens", "output_tokens")
    list_filter = ("date", "kind")
    search_fields = ("user__email",)
    date_hierarchy = "date"
    readonly_fields = ("user", "kind", "date", "count", "input_tokens", "output_tokens")
