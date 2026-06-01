from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class UserProfile(models.Model):
    class Gender(models.TextChoices):
        MALE = "MALE", "Male"
        FEMALE = "FEMALE", "Female"
        OTHER = "OTHER", "Other"

    class Stance(models.TextChoices):
        ORTHODOX = "ORTHODOX", "Orthodox"
        SOUTHPAW = "SOUTHPAW", "Southpaw"
        SWITCH = "SWITCH", "Switch"

    class Units(models.TextChoices):
        METRIC = "METRIC", "Metric"
        IMPERIAL = "IMPERIAL", "Imperial"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile"
    )
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=6, choices=Gender.choices, null=True, blank=True)
    height_cm = models.PositiveSmallIntegerField(null=True, blank=True)
    dominant_stance = models.CharField(
        max_length=8, choices=Stance.choices, null=True, blank=True
    )
    preferred_units = models.CharField(
        max_length=8, choices=Units.choices, default=Units.METRIC
    )
    timezone = models.CharField(max_length=64, default="UTC")

    def __str__(self):
        return f"Profile<{self.user.email}>"


class BiometricsLog(models.Model):
    class Source(models.TextChoices):
        MANUAL = "MANUAL", "Manual"
        GARMIN = "GARMIN", "Garmin"
        APPLE_HEALTH = "APPLE_HEALTH", "Apple Health"
        WHOOP = "WHOOP", "Whoop"
        OTHER = "OTHER", "Other"

    profile = models.ForeignKey(
        UserProfile, on_delete=models.CASCADE, related_name="biometrics"
    )
    weight_kg = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    body_fat_pct = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    resting_heart_rate = models.PositiveSmallIntegerField(null=True, blank=True)
    sleep_quality_score = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
    )
    hrv_ms = models.PositiveSmallIntegerField(null=True, blank=True)
    timestamp = models.DateTimeField(db_index=True, default=None)
    source = models.CharField(max_length=12, choices=Source.choices, default=Source.MANUAL)
    external_id = models.CharField(max_length=128, null=True, blank=True)
    raw_payload = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ("-timestamp",)
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "source", "external_id"],
                condition=models.Q(external_id__isnull=False),
                name="unique_external_id_per_source",
            )
        ]

    def save(self, *args, **kwargs):
        if self.timestamp is None:
            from django.utils import timezone
            self.timestamp = timezone.now()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Biometrics<{self.profile.user.email} @ {self.timestamp:%Y-%m-%d}>"
