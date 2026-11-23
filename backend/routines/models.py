"""Rutinas y carpetas del gimnasio (F17 R), como las de Hevy Pro: sin límite de número.

- `RoutineFolder`: carpeta del usuario. `kind` dice de dónde sale: del usuario, de un programa
  clásico cargado (`program`) o del plan por reglas del coach (`plan`, «Mi rutina»).
- `Routine`: título, notas, carpeta y orden dentro de la carpeta (o fuera de toda carpeta).
  `source` y `source_ref` dicen de dónde salió; `generated_hash` es la huella del contenido al
  generarla (plan), para saber si el usuario la ha cambiado antes de regenerar.
- `RoutineExercise`: el ejercicio (`exercise_key` del contrato de F17: `cat:<slug>`,
  `custom:<id>` o nulo para un nombre antiguo sin clave), el nombre guardado, el orden, la
  superserie (entero o nulo), notas, descanso y la lista de series planificadas
  (`[{set_type, reps, reps_max, weight_kg, rpe, rir}]`).
"""
from django.core.validators import MaxValueValidator
from django.db import models

from profiles.models import UserProfile

SET_TYPES = ("warmup", "normal", "drop", "failure")


class RoutineFolder(models.Model):
    class Kind(models.TextChoices):
        USER = "user", "User"
        PROGRAM = "program", "Program"
        PLAN = "plan", "Plan"

    profile = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="routine_folders")
    name = models.CharField(max_length=80)
    order = models.PositiveIntegerField(default=0)
    kind = models.CharField(max_length=8, choices=Kind.choices, default=Kind.USER)
    program_slug = models.CharField(max_length=60, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("order", "id")

    def __str__(self):
        return f"RoutineFolder<{self.name}>"


class Routine(models.Model):
    class Source(models.TextChoices):
        USER = "user", "User"
        PROGRAM = "program", "Program"
        PLAN = "plan", "Plan"
        IMPORT = "import", "Import"

    profile = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="routines")
    folder = models.ForeignKey(
        RoutineFolder, on_delete=models.SET_NULL, null=True, blank=True, related_name="routines"
    )
    title = models.CharField(max_length=120)
    notes = models.TextField(blank=True, default="")
    order = models.PositiveIntegerField(default=0)
    source = models.CharField(max_length=8, choices=Source.choices, default=Source.USER)
    # Programa: `<slug>:<día>`. Plan: `plan:<id>:<sesión>`. Importación: el título de Hevy.
    source_ref = models.CharField(max_length=160, blank=True, default="")
    generated_hash = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("order", "id")
        indexes = [models.Index(fields=["profile", "folder", "order"])]

    def __str__(self):
        return f"Routine<{self.title}>"


class RoutineExercise(models.Model):
    routine = models.ForeignKey(Routine, on_delete=models.CASCADE, related_name="exercises")
    exercise_key = models.CharField(max_length=80, null=True, blank=True)
    name = models.CharField(max_length=120)
    order = models.PositiveIntegerField(default=0)
    superset = models.PositiveSmallIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    rest_s = models.PositiveIntegerField(null=True, blank=True, validators=[MaxValueValidator(3600)])
    sets = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ("order", "id")

    def __str__(self):
        return f"RoutineExercise<{self.name}>"
