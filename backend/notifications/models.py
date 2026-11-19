from django.db import models


class PushSubscription(models.Model):
    """Un navegador suscrito a los avisos (Web Push, F11): lo que devuelve
    `PushManager.subscribe()`. El `endpoint` es de un solo navegador, así que es único: si otra
    cuenta se suscribe desde el mismo, la suscripción pasa a esa cuenta."""

    profile = models.ForeignKey(
        "profiles.UserProfile", on_delete=models.CASCADE, related_name="push_subscriptions"
    )
    endpoint = models.URLField(max_length=1000, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    user_agent = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    last_ok_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"PushSubscription<{self.profile_id} {self.endpoint[:40]}>"


class ReminderPrefs(models.Model):
    """Qué avisos quiere cada persona, uno a uno (como los de ParteDiario: la víspera y la
    revisión encendidos; pesarse y la movilidad, apagados)."""

    profile = models.OneToOneField(
        "profiles.UserProfile", on_delete=models.CASCADE, related_name="reminder_prefs"
    )
    eve = models.BooleanField(default=True)
    review = models.BooleanField(default=True)
    weigh = models.BooleanField(default=False)
    mobility = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"ReminderPrefs<{self.profile_id}>"


class ReminderLog(models.Model):
    """Un aviso ya enviado, por persona, tipo y día local. Si el cron se repite (Vercel puede
    entregar dos veces, o el BFF reintenta tras un arranque en frío) no se avisa dos veces."""

    profile = models.ForeignKey("profiles.UserProfile", on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=12)
    local_date = models.DateField()
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["profile", "kind", "local_date"], name="uniq_reminder_per_day")
        ]

    def __str__(self) -> str:
        return f"ReminderLog<{self.profile_id} {self.kind} {self.local_date}>"
