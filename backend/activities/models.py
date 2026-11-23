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
        # Series importadas de un CSV (Hevy o genérico, Task 9.1). `external_id` es el
        # `session_id` del coach (`hevy_csv:2025-07-24T11:25:00`).
        IMPORT = "IMPORT", "Import"

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
    # Sesión de gimnasio cuyo desglose de series no llegó (el cliente lo quitó de `detail` porque
    # no cabía): no tiene `SetLog` y no se inventan.
    sets_truncated = models.BooleanField(default=False)
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


SET_TYPES = ("warmup", "normal", "drop", "failure")


class SetLog(models.Model):
    """Una serie de una sesión de gimnasio (spec §6.5): lo mismo que guarda `ExerciseSet` del
    coach, para que `coach.strength` lea las series sin pasar por `Activity.detail`.

    `weight_kg` es nulo en los ejercicios con el peso corporal (como en el coach).

    F17: `exercise_key` es la clave del contrato (`cat:<slug>` o `custom:<id>`; nula en lo antiguo).
    Lo que es del ejercicio y no de la serie (`superset`, `notes` y `rest_s`) va en cada fila, como
    en el CSV de Hevy: así una serie sola lleva todo lo que hace falta para rehacer el bloque.
    """

    activity = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name="sets")
    exercise = models.CharField(max_length=120)
    exercise_key = models.CharField(max_length=160, null=True, blank=True, db_index=True)
    exercise_index = models.PositiveSmallIntegerField()
    set_index = models.PositiveSmallIntegerField()
    set_type = models.CharField(max_length=16, default="normal")
    weight_kg = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    reps = models.PositiveSmallIntegerField(null=True, blank=True)
    rir = models.DecimalField(
        max_digits=3, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(10)],
    )
    rpe = models.DecimalField(
        max_digits=3, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
    )
    distance_km = models.DecimalField(max_digits=7, decimal_places=3, null=True, blank=True)
    duration_s = models.PositiveIntegerField(null=True, blank=True)
    # Grupo de superserie dentro de la sesión (los bloques con el mismo número van juntos).
    superset = models.PositiveSmallIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    rest_s = models.PositiveIntegerField(null=True, blank=True, validators=[MaxValueValidator(3600)])

    class Meta:
        ordering = ("activity", "exercise_index", "set_index")
        constraints = [
            models.UniqueConstraint(
                fields=["activity", "exercise_index", "set_index"], name="unique_set_per_activity"
            )
        ]

    def __str__(self):
        return f"SetLog<{self.exercise} {self.weight_kg}x{self.reps}>"


class ImportedRoutine(models.Model):
    """Rutina creada al importar un historial (una por título de entreno): reimportar no la
    vuelve a crear. `routine_id` es el id que devolvió la API de rutinas (nulo si no se pudo)."""

    profile = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="imported_routines")
    source = models.CharField(max_length=32)
    title = models.CharField(max_length=120)
    routine_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["profile", "source", "title"], name="unique_imported_routine_title")
        ]
