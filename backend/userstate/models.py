from django.db import models

from profiles.models import UserProfile


class UserState(models.Model):
    """Copia de seguridad en el servidor de un valor que vive principalmente en el
    localStorage del móvil (offline-first). `key` está restringida por una allowlist
    (ver `userstate.services.ALLOWED_KEY_PATTERNS`); `value` es JSON arbitrario, hasta
    `services.MAX_VALUE_BYTES`. `updated_at` es el reloj lógico para last-write-wins:
    lo manda el cliente (o el servidor si no lo manda) y decide quién gana un PUT.
    """

    profile = models.ForeignKey(
        UserProfile, on_delete=models.CASCADE, related_name="state_entries"
    )
    key = models.CharField(max_length=64)
    value = models.JSONField()
    updated_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["profile", "key"], name="unique_profile_key"),
        ]
        indexes = [
            models.Index(fields=["profile", "key"]),
        ]

    def __str__(self):
        return f"UserState<{self.profile.user.email}:{self.key}>"
