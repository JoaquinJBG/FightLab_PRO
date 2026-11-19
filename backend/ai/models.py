from django.conf import settings
from django.db import models


class AIUsage(models.Model):
    """Uso diario de la IA por usuario y tipo: cuota (``count``) y gasto en tokens.

    La cuota vive aquí y no en la caché: la DatabaseCache poda filas al llenarse
    y un contador podado devolvería cupo que ya se había gastado.
    """

    class Kind(models.TextChoices):
        CHAT = "chat", "Coach"
        FOOD = "food", "Foto de comida"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ai_usage")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    date = models.DateField()
    count = models.PositiveIntegerField(default=0)
    input_tokens = models.PositiveBigIntegerField(default=0)
    output_tokens = models.PositiveBigIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "kind", "date"], name="ai_usage_unique_user_kind_date"),
        ]
        indexes = [models.Index(fields=["date"], name="ai_usage_date_idx")]
        ordering = ["-date", "user_id", "kind"]

    def __str__(self) -> str:
        return f"{self.user_id} {self.kind} {self.date}: {self.count}"
