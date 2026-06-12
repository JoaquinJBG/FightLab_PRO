from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from profiles.models import UserProfile


class Activity(models.Model):
    """Sesión de entrenamiento unificada (deportes, MMA y gimnasio).

    `started_at` es el INICIO real de la sesión (el cliente lo calcula como
    fin − duración). El motor de carga bucketiza por el día local de inicio.
    `external_id` lleva el client_id generado en el dispositivo: la constraint
    única lo hace idempotente frente a reintentos y migraciones repetidas.
    """

    class Kind(models.TextChoices):
        SPORT = "SPORT", "Deporte"
        MMA = "MMA", "MMA"
        GYM = "GYM", "Gimnasio"

    class Source(models.TextChoices):
        MANUAL = "MANUAL", "Manual"
        XIAOMI = "XIAOMI", "Xiaomi"
        OTHER = "OTHER", "Other"

    profile = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="activities")
    kind = models.CharField(max_length=8, choices=Kind.choices)
    title = models.CharField(max_length=80, blank=True, default="")
    started_at = models.DateTimeField(db_index=True)
    duration_sec = models.PositiveIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(86_400)]
    )
    rpe = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(10)]
    )
    kcal = models.PositiveIntegerField(
        null=True, blank=True, validators=[MaxValueValidator(20_000)]
    )
    note = models.TextField(blank=True, default="")
    detail = models.JSONField(null=True, blank=True)
    source = models.CharField(max_length=12, choices=Source.choices, default=Source.MANUAL)
    external_id = models.CharField(max_length=128, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-started_at", "-id")
        indexes = [models.Index(fields=["profile", "started_at"])]
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "source", "external_id"],
                condition=models.Q(external_id__isnull=False),
                name="unique_activity_external_id_per_source",
            )
        ]

    @property
    def load_au(self) -> int | None:
        """Carga sRPE: round(min × RPE) — misma fórmula que el motor frontend.
        int(x + 0.5) = Math.round de JS (half-up); el round() de Python es
        half-even y divergiría en los .5 exactos."""
        if self.rpe is None:
            return None
        return int(self.duration_sec / 60 * self.rpe + 0.5)

    def __str__(self):
        return f"Activity<{self.profile.user.email} {self.kind} @ {self.started_at:%Y-%m-%d}>"
