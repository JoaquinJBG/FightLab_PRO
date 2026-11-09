from django.db import models

from profiles.models import UserProfile


class CustomExercise(models.Model):
    """Ejercicio propio del usuario (F17), sin límite de número, como en Hevy Pro.

    Su clave es `custom:<id>` (`exercises.catalog.custom_key`). Los músculos y el material son
    listas de slugs de `exercises.vocab`: el serializer los valida. El catálogo de la biblioteca
    no vive en la base de datos (`data/exercise_catalog.json`).
    """

    profile = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="custom_exercises")
    name = models.CharField(max_length=120)
    primary_muscles = models.JSONField(default=list, blank=True)
    secondary_muscles = models.JSONField(default=list, blank=True)
    equipment = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name", "id")
        indexes = [models.Index(fields=["profile", "name"])]

    @property
    def key(self) -> str:
        return f"custom:{self.pk}"

    def __str__(self):
        return f"CustomExercise<{self.pk} {self.name}>"
