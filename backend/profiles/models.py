from coach import profile as coach_profile
from coach import regions as coach_regions
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models

# Los valores del perfil del coach, con la misma semántica (spec §6.1-6.2).
EQUATION_SEXES = [(s, s) for s in coach_profile.SEXES]
GOALS = [(g, g) for g in coach_profile.GOALS]
EXPERIENCE = [(e, e) for e in coach_profile.EXPERIENCE]
ACTIVITY_LEVELS = [(a, a) for a in coach_profile.ACTIVITY_LEVELS]
LANGUAGES = [(lang, lang) for lang in coach_profile.LANGUAGES]
DEFAULT_LANGUAGE = "es"
# Cómo se midió la grasa corporal (U04). Solo los cuatro primeros valen para una ecuación con
# masa magra (`coaching.bridge.energy_athletes.RELIABLE_BODY_FAT_METHODS`).
BODY_FAT_METHODS = [
    ("dxa", "DXA"),
    ("bodpod", "BodPod"),
    ("bia_lab", "BIA de laboratorio u octopolar"),
    ("skinfolds", "Pliegues cutáneos"),
    ("smart_scale", "Báscula doméstica"),
    ("other", "Otro método"),
]
# convention (FightLab): hasta 14 sesiones a la semana (dos al día), solo control de entrada.
MAX_TRAINING_FREQUENCY = 14


def validate_region(code: str) -> None:
    """Solo regiones con carpeta en el motor (`regions/<code>/region.yaml`)."""
    try:
        coach_regions.region_dir(code)
    except ValueError as exc:
        raise ValidationError(str(exc)) from None


def _validate_tokens(value, allowed: tuple[str, ...]) -> None:
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ValidationError("must be a list of strings")
    unknown = sorted(set(value) - set(allowed))
    if unknown:
        raise ValidationError(f"unknown tokens: {', '.join(unknown)}; allowed: {', '.join(allowed)}")


def validate_medications(value) -> None:
    _validate_tokens(value, coach_profile.MEDICATION_TOKENS)


def validate_conditions(value) -> None:
    _validate_tokens(value, coach_profile.CONDITION_TOKENS)


def validate_text_list(value) -> None:
    if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
        raise ValidationError("must be a list of non-empty strings")


# Campos editables del perfil ampliado (spec §6.2)
PROFILE_COACH_FIELDS = (
    "equation_sex", "goal", "experience", "activity_level", "language", "region",
    "emergency_number", "medications", "medications_other", "conditions", "conditions_other",
    "disciplines", "training_frequency", "goal_weight_kg", "goal_date", "weight_class",
    "weigh_in_at",
)


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

    # --- Perfil del coach (spec §6.2) ---
    # Se pregunta solo si `gender` es OTHER o nulo: las ecuaciones existen para female y male.
    equation_sex = models.CharField(max_length=6, choices=EQUATION_SEXES, null=True, blank=True)
    goal = models.CharField(max_length=13, choices=GOALS, null=True, blank=True)
    experience = models.CharField(max_length=12, choices=EXPERIENCE, null=True, blank=True)
    activity_level = models.CharField(max_length=13, choices=ACTIVITY_LEVELS, null=True, blank=True)
    # Idioma de la UI, la API y el chat. Al registrarse sale de `Accept-Language`.
    language = models.CharField(max_length=2, choices=LANGUAGES, default=DEFAULT_LANGUAGE)
    region = models.CharField(max_length=8, null=True, blank=True, validators=[validate_region])
    # El del usuario; si es nulo, el de su región (lo resuelve `coach.safety`).
    emergency_number = models.CharField(
        max_length=6,
        null=True,
        blank=True,
        validators=[RegexValidator(coach_profile.EMERGENCY_NUMBER, "2 to 6 digits")],
    )
    # Solo los tokens de `docs/safety.md` cambian algo; lo demás se guarda sin clasificar.
    medications = models.JSONField(default=list, blank=True, validators=[validate_medications])
    medications_other = models.JSONField(default=list, blank=True, validators=[validate_text_list])
    conditions = models.JSONField(default=list, blank=True, validators=[validate_conditions])
    conditions_other = models.JSONField(default=list, blank=True, validators=[validate_text_list])

    # --- Propios de FightLab (plan v1 §1; pesaje que hoy está en localStorage) ---
    disciplines = models.JSONField(default=list, blank=True, validators=[validate_text_list])
    training_frequency = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MaxValueValidator(MAX_TRAINING_FREQUENCY)]
    )
    goal_weight_kg = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    goal_date = models.DateField(null=True, blank=True)
    weight_class = models.CharField(max_length=60, null=True, blank=True)
    weigh_in_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Profile<{self.user.email}>"


class BiometricsLog(models.Model):
    class Source(models.TextChoices):
        MANUAL = "MANUAL", "Manual"
        GARMIN = "GARMIN", "Garmin"
        APPLE_HEALTH = "APPLE_HEALTH", "Apple Health"
        WHOOP = "WHOOP", "Whoop"
        XIAOMI = "XIAOMI", "Xiaomi"
        OTHER = "OTHER", "Other"

    profile = models.ForeignKey(
        UserProfile, on_delete=models.CASCADE, related_name="biometrics"
    )
    weight_kg = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    body_fat_pct = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    # Vacío: no se sabe cómo se midió. Sin método fiable, la grasa no entra en el RMR (U04).
    body_fat_method = models.CharField(max_length=12, choices=BODY_FAT_METHODS, blank=True, default="")
    resting_heart_rate = models.PositiveSmallIntegerField(null=True, blank=True)
    sleep_quality_score = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
    )
    hrv_ms = models.PositiveSmallIntegerField(null=True, blank=True)
    # Perímetros con cinta métrica (cm) — opcionales
    waist_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    hip_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    chest_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    arm_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    thigh_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    neck_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
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


class ProgressPhoto(models.Model):
    """Foto de progreso corporal. Más adelante la IA (visión) podrá analizarlas."""

    profile = models.ForeignKey(
        UserProfile, on_delete=models.CASCADE, related_name="photos"
    )
    image = models.ImageField(upload_to="progress/%Y/%m/")
    taken_at = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-taken_at", "-id")

    def save(self, *args, **kwargs):
        if self.taken_at is None:
            from django.utils import timezone
            self.taken_at = timezone.localdate()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Photo<{self.profile.user.email} @ {self.taken_at}>"
