from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class KnowledgeRule(models.Model):
    """Una regla de `knowledge/*.md` (la base de evidencia del coach)."""

    class Origin(models.TextChoices):
        UPSTREAM = "upstream", "upstream"
        FIGHTLAB = "fightlab", "fightlab"

    class Grade(models.TextChoices):
        STRONG = "strong", "strong"
        MODERATE = "moderate", "moderate"
        EMERGING = "emerging", "emerging"

    key = models.CharField(max_length=200, unique=True)
    file = models.CharField(max_length=80)  # `nutrition` (sin .md)
    section = models.CharField(max_length=200, blank=True)
    heading = models.CharField(max_length=300)  # exacto: es el que citan los motivos del motor
    grade = models.CharField(max_length=10, choices=Grade.choices, blank=True)
    rule_text = models.TextField(blank=True)
    evidence = models.TextField(blank=True)
    applies_to = models.TextField(blank=True)
    conflicts = models.TextField(blank=True)
    source_ids = models.JSONField(default=list, blank=True)
    checked_on = models.DateField(null=True, blank=True)
    origin = models.CharField(max_length=10, choices=Origin.choices, default=Origin.UPSTREAM)
    engine_sha = models.CharField(max_length=40, blank=True)
    # Hash del texto traducible: si cambia, las traducciones pasan a `stale`.
    source_hash = models.CharField(max_length=64, blank=True)
    # Una regla que desaparece del origen no se borra (puede estar referenciada).
    retired = models.BooleanField(default=False)

    class Meta:
        ordering = ["file", "key"]

    def __str__(self) -> str:
        return self.key


class KnowledgeSource(models.Model):
    """Referencia bibliográfica. Nunca guarda la línea `Supports:` (citas de editoriales)."""

    sid = models.CharField(max_length=10, unique=True)  # S819; F001 en el anexo propio
    citation = models.TextField()
    type = models.CharField(max_length=60, blank=True)
    doi = models.CharField(max_length=200, blank=True)
    url = models.URLField(max_length=500, blank=True)
    origin = models.CharField(
        max_length=10, choices=KnowledgeRule.Origin.choices, default=KnowledgeRule.Origin.UPSTREAM
    )

    class Meta:
        ordering = ["sid"]

    def __str__(self) -> str:
        return self.sid


class RuleTranslation(models.Model):
    class Status(models.TextChoices):
        MACHINE = "machine", "machine"
        REVIEWED = "reviewed", "reviewed"
        STALE = "stale", "stale"

    rule = models.ForeignKey(KnowledgeRule, on_delete=models.CASCADE, related_name="translations")
    lang = models.CharField(max_length=5)
    heading = models.CharField(max_length=300, blank=True)
    rule_text = models.TextField(blank=True)
    evidence = models.TextField(blank=True)
    applies_to = models.TextField(blank=True)
    conflicts = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.MACHINE)
    source_hash = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["rule", "lang"], name="uniq_rule_lang")]

    def __str__(self) -> str:
        return f"{self.rule_id}:{self.lang}"


# --- Cribado y lesiones (spec §6.3) ---
# Los mismos resultados que `coach.profile.SCREENING_KEYS`, nulos por defecto: *sin contestar*
# no es *contestado con NO* (el coach trata la ausencia de `parq_any_yes` como PAR-Q+ sin
# contestar). Solo se guardan resultados, nunca el texto de las preguntas.


class Screening(models.Model):
    class Menstrual(models.TextChoices):
        NORMAL = "normal", "normal"
        IRREGULAR_NEW = "irregular_new", "irregular_new"
        ABSENT = "absent", "absent"
        NOT_APPLICABLE = "not_applicable", "not_applicable"

    profile = models.OneToOneField(
        "profiles.UserProfile", on_delete=models.CASCADE, related_name="screening"
    )
    scoff_yes_count = models.PositiveSmallIntegerField(null=True, blank=True)
    scoff_positive = models.BooleanField(null=True, blank=True)
    parq_any_yes = models.BooleanField(null=True, blank=True)
    parq_followup_yes = models.BooleanField(null=True, blank=True)
    vigorous_reviewed = models.BooleanField(null=True, blank=True)
    cardiac_symptoms = models.BooleanField(null=True, blank=True)
    menstrual = models.CharField(max_length=14, choices=Menstrual.choices, null=True, blank=True)
    bp_systolic = models.PositiveSmallIntegerField(null=True, blank=True)
    bp_diastolic = models.PositiveSmallIntegerField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Screening<{self.profile_id}>"


class ScreeningEvent(models.Model):
    """Traza de cada cambio del cribado (solo se añade). Gobernanza ligera, sin auditoría formal."""

    class Origin(models.TextChoices):
        ONBOARDING = "onboarding", "onboarding"
        CHECKIN = "checkin", "checkin"
        REVIEW = "review", "review"

    profile = models.ForeignKey(
        "profiles.UserProfile", on_delete=models.CASCADE, related_name="screening_events"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    key = models.CharField(max_length=40)
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    origin = models.CharField(max_length=10, choices=Origin.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        return f"{self.key}: {self.old_value!r} -> {self.new_value!r}"


class Injury(models.Model):
    """Una lesión por zona, como `coach.profile.INJURY_KEYS`. Mientras está activa, los
    ejercicios de `exercises` no progresan (`coach.safety`)."""

    class Status(models.TextChoices):
        ACTIVE = "active", "active"
        CLEARED = "cleared", "cleared"

    class Origin(models.TextChoices):
        ONBOARDING = "onboarding", "onboarding"
        CHECKIN = "checkin", "checkin"
        MMA_SESSION = "mma_session", "mma_session"

    profile = models.ForeignKey(
        "profiles.UserProfile", on_delete=models.CASCADE, related_name="injuries"
    )
    area = models.CharField(max_length=120)  # en palabras del usuario
    status = models.CharField(max_length=7, choices=Status.choices, default=Status.ACTIVE)
    since = models.DateField(null=True, blank=True)
    professional = models.CharField(max_length=120, null=True, blank=True)
    cleared_on = models.DateField(null=True, blank=True)
    exercises = models.JSONField(default=list, blank=True)  # nombres de ejercicio
    origin = models.CharField(max_length=11, choices=Origin.choices, default=Origin.ONBOARDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def clean(self) -> None:
        # Las mismas reglas que `coach.profile._validate_injury`.
        errors = {}
        if not (self.area or "").strip():
            errors["area"] = "each injury needs an area"
        if self.status == self.Status.CLEARED and self.cleared_on is None:
            errors["cleared_on"] = "a cleared injury needs cleared_on"
        if self.since and self.cleared_on and self.cleared_on < self.since:
            errors["cleared_on"] = "an injury's cleared_on cannot be before its since date"
        if not isinstance(self.exercises, list) or not all(isinstance(e, str) for e in self.exercises):
            errors["exercises"] = "injury exercises must be exercise names"
        if errors:
            raise ValidationError(errors)

    def __str__(self) -> str:
        return f"Injury<{self.area} {self.status}>"
