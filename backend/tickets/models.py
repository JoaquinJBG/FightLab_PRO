from django.db import models


class TicketPhoto(models.Model):
    """La foto de un ticket de la compra (fase 12), guardada en Cloudflare R2.

    Aquí solo va la referencia: la clave del objeto en el bucket privado y su tamaño (para el
    contador de uso del plan gratis). La foto se ve con una URL firmada que caduca y que solo pide
    su dueño (`tickets.views`). Al borrar la fila, sea a mano o en cascada al borrar la cuenta,
    se borra el objeto (`tickets.signals`)."""

    profile = models.ForeignKey("profiles.UserProfile", on_delete=models.CASCADE, related_name="tickets")
    plan = models.ForeignKey(
        "coaching.MealPlan", on_delete=models.SET_NULL, null=True, blank=True, related_name="tickets"
    )
    taken_on = models.DateField()
    key = models.CharField(max_length=200, unique=True)
    size = models.PositiveIntegerField()
    content_type = models.CharField(max_length=32, default="image/jpeg")
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    note = models.CharField(max_length=120, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-taken_on", "-id"]

    def __str__(self) -> str:
        return f"TicketPhoto<{self.profile_id} {self.taken_on}>"
