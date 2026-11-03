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


class HeadImpact(models.Model):
    """Un golpe en la cabeza (o un golpe fuerte que sacudió la cabeza) que avisa el atleta (E.5).

    Con síntomas o señales vistas por otros pone `no_contact` hasta que el atleta confirma el
    alta de un clínico (`cleared_on`); nunca se quita por tiempo (combat-sports "No sparring
    until symptom-free with exertion and cleared"). Solo se guardan respuestas de sí o no.
    """

    class Origin(models.TextChoices):
        MMA_SESSION = "mma_session", "mma_session"
        CHECKIN = "checkin", "checkin"
        OTHER = "other", "other"

    profile = models.ForeignKey(
        "profiles.UserProfile", on_delete=models.CASCADE, related_name="head_impacts"
    )
    occurred_on = models.DateField()
    symptoms = models.BooleanField(default=False)  # algún síntoma, o señales que vio otra persona
    red_flags = models.BooleanField(default=False)  # alguna señal de alarma del CRT6
    origin = models.CharField(max_length=11, choices=Origin.choices, default=Origin.OTHER)
    cleared_on = models.DateField(null=True, blank=True)  # alta de un clínico para el contacto
    cleared_by = models.CharField(max_length=120, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-occurred_on", "-id"]

    def clean(self) -> None:
        if self.cleared_on and self.occurred_on and self.cleared_on < self.occurred_on:
            raise ValidationError({"cleared_on": "clearance cannot be before the head blow"})

    @property
    def blocks_contact(self) -> bool:
        return (self.symptoms or self.red_flags) and self.cleared_on is None

    def __str__(self) -> str:
        return f"HeadImpact<{self.occurred_on} {'open' if self.blocks_contact else 'closed'}>"


# --- Check-in diario (spec §6.4) ---


class DailyCheckin(models.Model):
    """Un día, como una fila de `data/checkins.csv`. El peso y la cintura no se guardan aquí:
    van a `BiometricsLog` (una fila por día con `external_id="checkin:AAAA-MM-DD"`).

    El bienestar (plan v1 §8) son cinco puntuaciones de 1 a 5, **donde 5 es lo mejor** (dormí bien,
    con energía, sin agujetas, sin estrés, buen ánimo): así una bajada es siempre una puntuación
    menor, sin invertir escalas. Es la lista de "Simple readiness monitoring".
    Las respuestas a las señales de alarma no se guardan como texto: su efecto va a `Screening` o
    a `Injury` (con su `ScreeningEvent`) y aquí solo queda el código de lo que se marcó.
    """

    class Illness(models.TextChoices):
        SYSTEMIC = "systemic", "systemic"  # fiebre, dolor por todo el cuerpo, mal por debajo del cuello
        HEAD_COLD = "head_cold", "head_cold"

    profile = models.ForeignKey(
        "profiles.UserProfile", on_delete=models.CASCADE, related_name="checkins"
    )
    date = models.DateField()
    intake_kcal = models.PositiveIntegerField(null=True, blank=True)  # la de ayer
    sleep_hours = models.FloatField(null=True, blank=True)  # la de anoche
    sleep_quality = models.PositiveSmallIntegerField(null=True, blank=True)
    energy = models.PositiveSmallIntegerField(null=True, blank=True)
    soreness = models.PositiveSmallIntegerField(null=True, blank=True)
    stress = models.PositiveSmallIntegerField(null=True, blank=True)
    mood = models.PositiveSmallIntegerField(null=True, blank=True)
    soreness_zones = models.JSONField(default=list, blank=True)
    illness = models.CharField(max_length=9, choices=Illness.choices, blank=True, default="")
    red_flags = models.JSONField(default=list, blank=True)  # códigos de `coaching.redflags`
    # Preguntas semanales (5.3): hay "registro" de la semana si alguno no es nulo.
    period_status = models.CharField(
        max_length=14, choices=Screening.Menstrual.choices, null=True, blank=True
    )
    hormonal_contraception = models.BooleanField(null=True, blank=True)
    bp_systolic = models.PositiveSmallIntegerField(null=True, blank=True)
    bp_diastolic = models.PositiveSmallIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date"]
        constraints = [
            models.UniqueConstraint(fields=["profile", "date"], name="uniq_checkin_profile_date")
        ]

    def __str__(self) -> str:
        return f"Checkin<{self.profile_id} {self.date}>"


class WeeklyPlan(models.Model):
    """El plan de una semana (spec §6.6, Task 6.4), generado por reglas en `coaching.plan`.

    Cada número sale del motor (cargas de `strength.progression`, kcal y macros de `targets`,
    minutos de "Weekly baseline dose") y cada línea lleva su regla o su etiqueta de convención.
    Los motivos se guardan sin texto (`{code, rule_key, params}`) y se traducen al leerlos.
    `narrative` es lo único que escribe el LLM, y nunca cambia los números.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "draft"
        ACTIVE = "active", "active"
        SUPERSEDED = "superseded", "superseded"

    profile = models.ForeignKey(
        "profiles.UserProfile", on_delete=models.CASCADE, related_name="weekly_plans"
    )
    week_start = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    target_kcal = models.PositiveIntegerField(null=True, blank=True)
    in_deficit = models.BooleanField(default=False)
    training_schedule = models.JSONField(default=list)  # por día: gym/mma/cardio con su hora
    sessions = models.JSONField(default=list)  # sesiones de gimnasio con sus ejercicios
    cardio = models.JSONField(default=dict)
    nutrition = models.JSONField(null=True, blank=True)  # copia de objetivos y macros
    safety_reasons = models.JSONField(default=list)
    rules_used = models.JSONField(default=list)  # claves de regla
    engine_sha = models.CharField(max_length=40, blank=True, default="")
    narrative = models.TextField(blank=True, default="")
    # Semana de descarga aceptada en la revisión semanal (F7): `volume_cut`, `stop_rir`,
    # `extra_rest_days` de `coach.strength.deload`, con su regla. Nulo en una semana normal.
    deload = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    applied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-week_start", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["profile"], condition=models.Q(status="active"), name="uniq_active_plan_per_profile"
            )
        ]

    def __str__(self) -> str:
        return f"WeeklyPlan<{self.profile_id} {self.week_start} {self.status}>"


class WeeklyReview(models.Model):
    """La revisión de una semana (spec §6.6, Task 7.1), siguiendo `review/SKILL.md` del coach.

    Copia lo que el motor dijo ese día: adherencia (plan de F6 frente a lo registrado), tendencia
    de peso, TDEE recalibrado, series y progresión, y las señales de descarga. `proposals` son los
    cambios propuestos (calorías, descarga); al aceptarlos se guardan `accepted`, `target_kcal` e
    `in_deficit` y se genera un `WeeklyPlan` nuevo (`plan`). El `recalibrated_tdee` de una revisión
    aceptada es el que usa `coach/targets` (fase 4). `narrative` es lo único que escribe el LLM.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "pending"
        ACCEPTED = "accepted", "accepted"

    profile = models.ForeignKey(
        "profiles.UserProfile", on_delete=models.CASCADE, related_name="weekly_reviews"
    )
    week_end = models.DateField()
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PENDING)
    goal = models.CharField(max_length=13, blank=True, default="")
    adherence = models.JSONField(default=dict)
    trend = models.JSONField(default=dict)
    recalibrated_tdee = models.FloatField(null=True, blank=True)
    current_kcal = models.PositiveIntegerField(null=True, blank=True)  # el objetivo en vigor
    calories = models.JSONField(default=dict)  # ritmo frente al rango del objetivo y su regla
    training = models.JSONField(null=True, blank=True)  # series por músculo y progresión
    signs = models.JSONField(default=list)  # señales de descarga marcadas (y las deducidas)
    deload = models.JSONField(null=True, blank=True)
    proposals = models.JSONField(default=list)
    safety_reasons = models.JSONField(default=list)
    rules_used = models.JSONField(default=list)
    engine_sha = models.CharField(max_length=40, blank=True, default="")
    narrative = models.TextField(blank=True, default="")
    accepted = models.JSONField(default=list)  # tipos de propuesta aceptados
    accepted_at = models.DateTimeField(null=True, blank=True)
    target_kcal = models.PositiveIntegerField(null=True, blank=True)  # el aceptado
    in_deficit = models.BooleanField(null=True, blank=True)
    plan_week_start = models.DateField(null=True, blank=True)
    plan = models.ForeignKey(
        WeeklyPlan, on_delete=models.SET_NULL, null=True, blank=True, related_name="reviews"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-week_end", "-created_at"]

    def __str__(self) -> str:
        return f"WeeklyReview<{self.profile_id} {self.week_end} {self.status}>"


class KnowledgeSync(models.Model):
    """Huella del contenido de cada conjunto de evidencia ya cargado (`manage.py sync_knowledge`).

    Al arrancar, si la huella de los archivos coincide con la guardada, no se vuelve a cargar.
    """

    name = models.CharField(max_length=40, primary_key=True)  # "upstream", "fightlab"...
    content_hash = models.CharField(max_length=64)
    loaded_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"KnowledgeSync<{self.name} {self.content_hash[:12]}>"
