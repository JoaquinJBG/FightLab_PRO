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

    class Source(models.TextChoices):
        APP = "app", "app"
        # Una revisión del coach (`data/reviews/FIN.md`) importada en la fase 10: solo trae el
        # TDEE, el objetivo aceptado y el texto; el resto de campos queda vacío.
        IMPORT = "import", "import"

    profile = models.ForeignKey(
        "profiles.UserProfile", on_delete=models.CASCADE, related_name="weekly_reviews"
    )
    week_end = models.DateField()
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PENDING)
    source = models.CharField(max_length=6, choices=Source.choices, default=Source.APP)
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


class Tastes(models.Model):
    """Los gustos del atleta para los menús (spec §6.6, Task 8.2): `coach.tastes.Tastes` en BD.

    Como en el coach, un campo nulo es "sin preguntar" y una lista vacía es "preguntado, sin
    respuesta". Las alergias e intolerancias bloquean un plato y lo demás solo avisa
    (`mealplan.taste_flags`). No se guarda el código postal: en el coach solo sirve para buscar
    supermercados en la web, y FightLab no lo hace. Las valoraciones de platos van en `Recipe`.
    """

    profile = models.OneToOneField("profiles.UserProfile", on_delete=models.CASCADE, related_name="tastes")
    loved_foods = models.JSONField(null=True, blank=True)
    disliked_foods = models.JSONField(null=True, blank=True)
    allergies = models.JSONField(null=True, blank=True)
    intolerances = models.JSONField(null=True, blank=True)
    cuisines = models.JSONField(null=True, blank=True)
    flavours = models.JSONField(null=True, blank=True)
    cooking_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    cooking_skill = models.CharField(max_length=12, null=True, blank=True)
    equipment = models.JSONField(null=True, blank=True)
    budget = models.CharField(max_length=6, null=True, blank=True)
    chains = models.JSONField(null=True, blank=True)
    pantry = models.JSONField(null=True, blank=True)
    untried = models.JSONField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Tastes<{self.profile_id}>"


class Recipe(models.Model):
    """Un plato valorado (spec §6.6): el recetario del coach (`coach.recipes`) y sus valoraciones
    (`tastes.ratings`) en una tabla. `source_url` es la atribución de la receta de origen; sin
    ella el plato es de FightLab. Los `items` van como en un borrador (`NAME=GRAMOS`) y no guardan
    kcal: cada vez que el plato entra en un menú, el motor lo vuelve a comprobar."""

    class Rating(models.TextChoices):
        LOVED = "loved", "loved"
        LIKED = "liked", "liked"
        DISLIKED = "disliked", "disliked"
        NEVER_AGAIN = "never_again", "never_again"

    profile = models.ForeignKey("profiles.UserProfile", on_delete=models.CASCADE, related_name="recipes")
    dish = models.CharField(max_length=160)
    dish_key = models.CharField(max_length=160)  # `coach.text.fold(dish)`: sin mayúsculas ni tildes
    source_url = models.URLField(max_length=500, blank=True, default="")
    meal = models.CharField(max_length=20, blank=True, default="")  # la comida del menú donde salió
    servings = models.PositiveSmallIntegerField(default=1)
    steps = models.JSONField(default=list, blank=True)
    seasoning = models.JSONField(default=list, blank=True)
    items = models.JSONField(default=list, blank=True)
    rating = models.CharField(max_length=11, choices=Rating.choices)
    rated_on = models.DateField()
    note = models.CharField(max_length=300, blank=True, default="")

    class Meta:
        ordering = ["dish"]
        constraints = [models.UniqueConstraint(fields=["profile", "dish_key"], name="uniq_recipe_per_dish")]

    def __str__(self) -> str:
        return f"Recipe<{self.profile_id} {self.dish} {self.rating}>"


class CatalogueProduct(models.Model):
    """Un producto del súper leído de Open Food Facts (`coach.catalogue.CatalogueProduct`).

    OFF es colaborativo: todo producto va `unverified` y con su URL de OFF (atribución ODbL). Un
    valor vacío es "sin dato", nunca cero. Por 100 g o por 100 ml, sin convertir uno en otro."""

    class Per(models.TextChoices):
        G100 = "100 g", "100 g"
        ML100 = "100 ml", "100 ml"

    profile = models.ForeignKey("profiles.UserProfile", on_delete=models.CASCADE, related_name="catalogue")
    barcode = models.CharField(max_length=14)
    product_name = models.CharField(max_length=200)
    brand = models.CharField(max_length=200, blank=True, default="")
    chain = models.CharField(max_length=80, blank=True, default="")
    per = models.CharField(max_length=6, choices=Per.choices)
    kcal = models.FloatField(null=True, blank=True)
    protein_g = models.FloatField(null=True, blank=True)
    carbs_g = models.FloatField(null=True, blank=True)
    fat_g = models.FloatField(null=True, blank=True)
    fibre_g = models.FloatField(null=True, blank=True)
    allergens = models.JSONField(default=list, blank=True)
    url = models.URLField(max_length=300)
    fetched_on = models.DateField()
    source = models.CharField(max_length=60, default="Open Food Facts (unverified)")
    unverified = models.BooleanField(default=True)

    class Meta:
        ordering = ["product_name"]
        constraints = [models.UniqueConstraint(fields=["profile", "barcode"], name="uniq_product_per_profile")]

    def __str__(self) -> str:
        return f"CatalogueProduct<{self.profile_id} {self.barcode}>"


class MealPlan(models.Model):
    """Un menú guardado (spec §6.6, Task 8.4): lo que el coach guarda en `data/menus/`.

    `days` va en el formato de borrador de `coach.mealplan` (fechas ISO); solo entran los días que
    el motor ha dado por buenos (`checks`: totales y estado de cada objetivo). `rejected` dice qué
    días rechazó y por qué, sin sus platos. `targets` es la copia de los objetivos con los que se
    comprobó. La lista de la compra se calcula al leerlo (`mealplan.shopping`), en el idioma de
    quien lo lee.
    """

    class Source(models.TextChoices):
        GENERATED = "generated", "generated"  # el generador de F8 (LLM simulado + motor)
        JSON = "json", "json"  # JSON `schema: 1` de la app (fase 12)
        YAML = "yaml", "yaml"  # `menus/<fecha>.yaml` del coach (fase 12)
        PARTEDIARIO = "partediario", "partediario"  # los `menus` de la copia de ParteDiario

    profile = models.ForeignKey("profiles.UserProfile", on_delete=models.CASCADE, related_name="meal_plans")
    start_date = models.DateField()
    # Fase 12: un menú importado lleva su `id` (si se reimporta el mismo, sustituye al anterior
    # en la misma fila, así lo tachado de la lista de la compra se queda), su fin y su título.
    menu_id = models.CharField(max_length=100, blank=True, default="")
    end_date = models.DateField(null=True, blank=True)
    title = models.CharField(max_length=200, blank=True, default="")
    source = models.CharField(max_length=12, choices=Source.choices, default=Source.GENERATED)
    notes = models.JSONField(default=list, blank=True)
    # Los platos por su id (`steps_batch`, `steps_day`, `storage`, `batch_servings`, `source`...),
    # las sesiones de batch con su cronograma y la lista de la compra tal como venía (sección,
    # formato, semana). Ver `coaching.menu_import`.
    dishes = models.JSONField(default=dict, blank=True)
    batch_sessions = models.JSONField(default=list, blank=True)
    shopping = models.JSONField(default=dict, blank=True)
    imported_at = models.DateTimeField(null=True, blank=True)
    days = models.JSONField(default=list)
    checks = models.JSONField(default=list)
    rejected = models.JSONField(default=list)
    targets = models.JSONField(default=dict)
    taste_flags = models.JSONField(default=list)
    provider = models.CharField(max_length=20, default="fake")
    engine_sha = models.CharField(max_length=40, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-start_date", "-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["profile", "start_date"], name="uniq_meal_plan_per_start"),
            models.UniqueConstraint(
                fields=["profile", "menu_id"], condition=~models.Q(menu_id=""), name="uniq_meal_plan_menu_id"
            ),
        ]

    def __str__(self) -> str:
        return f"MealPlan<{self.profile_id} {self.start_date}>"


class ShoppingCheck(models.Model):
    """Una línea tachada de la lista de la compra de un menú (fase 12). `item_key` es el nombre del
    alimento sin mayúsculas ni tildes (`coach.text.fold`): al reimportar el menú, lo tachado sigue
    tachado aunque cambien las cantidades."""

    plan = models.ForeignKey(MealPlan, on_delete=models.CASCADE, related_name="shopping_checks")
    item_key = models.CharField(max_length=200)
    checked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["plan", "item_key"], name="uniq_shopping_check")]

    def __str__(self) -> str:
        return f"ShoppingCheck<{self.plan_id} {self.item_key}>"


class KitchenProfile(models.Model):
    """El menaje del usuario (fase 12): lo rellena él en un formulario y nada de esto va en el
    código. `equipment` va con las claves de `coaching.kitchen.EQUIPMENT`. Vacío = sin rellenar:
    el cronograma no se comprueba contra él y la app lo pide."""

    profile = models.OneToOneField("profiles.UserProfile", on_delete=models.CASCADE, related_name="kitchen")
    equipment = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"KitchenProfile<{self.profile_id}>"


class Diner(models.Model):
    """Un comensal de la casa con sus restricciones por comida (fase 12), p. ej. "cena sin pescado
    salvo gambas": `restrictions` = `[{"meals": ["dinner"], "exclude": ["pescado"], "allow":
    ["gambas"]}]` (`meals` vacío: todas las comidas). Ver `coaching.kitchen`."""

    profile = models.ForeignKey("profiles.UserProfile", on_delete=models.CASCADE, related_name="diners")
    name = models.CharField(max_length=60)
    restrictions = models.JSONField(default=list, blank=True)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self) -> str:
        return f"Diner<{self.profile_id} {self.name}>"


class OffLookup(models.Model):
    """Caché del proxy de Open Food Facts (Task 8.3), compartida por todos los usuarios: OFF pide
    no repetir lecturas y limita las peticiones por IP, y la IP es la del servidor. Cada lectura
    real deja aquí su `fetched_at`, que es lo que cuenta el límite por minuto."""

    class Kind(models.TextChoices):
        PRODUCT = "product", "product"
        SEARCH = "search", "search"

    kind = models.CharField(max_length=7, choices=Kind.choices)
    key = models.CharField(max_length=300)
    payload = models.JSONField(null=True, blank=True)  # nulo: OFF no tiene el producto
    fetched_at = models.DateTimeField(db_index=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["kind", "key"], name="uniq_off_lookup")]

    def __str__(self) -> str:
        return f"OffLookup<{self.kind} {self.key}>"



class KnowledgeSync(models.Model):
    """Huella del contenido de cada conjunto de evidencia ya cargado (`manage.py sync_knowledge`).

    Al arrancar, si la huella de los archivos coincide con la guardada, no se vuelve a cargar.
    """

    name = models.CharField(max_length=40, primary_key=True)  # "upstream", "fightlab"...
    content_hash = models.CharField(max_length=64)
    loaded_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"KnowledgeSync<{self.name} {self.content_hash[:12]}>"


class DayLog(models.Model):
    """Lo que el parte diario de ParteDiario apuntaba de un día y no es del check-in (fase 10):
    qué tocaba (gimnasio, cardio o descanso), si se hizo el entrenamiento y la movilidad, y las
    pulsaciones del reloj. Una fila por día; todo es opcional (nulo = no apuntado).

    `heart` guarda la FC media y máxima de los entrenamientos y los minutos por zona
    (`fc_media`, `fc_max`, `min_z1`..`min_z3`) tal como venían, sin mostrarse aún: la fase 15
    decide cómo leerlos de Health Connect. La FC en reposo va a `BiometricsLog`, como en el
    check-in.
    """

    class DayType(models.TextChoices):
        GYM = "gimnasio", "gimnasio"
        CARDIO = "cardio", "cardio"
        REST = "descanso", "descanso"

    profile = models.ForeignKey(
        "profiles.UserProfile", on_delete=models.CASCADE, related_name="day_logs"
    )
    date = models.DateField()
    day_type = models.CharField(max_length=8, choices=DayType.choices, blank=True, default="")
    trained = models.BooleanField(null=True, blank=True)
    mobility = models.BooleanField(null=True, blank=True)
    heart = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date"]
        constraints = [
            models.UniqueConstraint(fields=["profile", "date"], name="uniq_daylog_profile_date")
        ]

    def __str__(self) -> str:
        return f"DayLog<{self.profile_id} {self.date}>"


class MealCheck(models.Model):
    """Cómo fue cada comida del menú un día (fase 10, la usa la pantalla Hoy de la fase 11): hecha,
    no hecha o cambiada, y qué se comió en su lugar. `dish` es lo que ponía el menú, si se sabe."""

    class Meal(models.TextChoices):
        BREAKFAST = "desayuno", "desayuno"
        LUNCH = "comida", "comida"
        SNACK = "merienda", "merienda"
        DINNER = "cena", "cena"

    class State(models.TextChoices):
        DONE = "hecho", "hecho"
        NOT_DONE = "no_hecho", "no_hecho"
        CHANGED = "cambiada", "cambiada"

    profile = models.ForeignKey(
        "profiles.UserProfile", on_delete=models.CASCADE, related_name="meal_checks"
    )
    date = models.DateField()
    meal = models.CharField(max_length=8, choices=Meal.choices)
    state = models.CharField(max_length=8, choices=State.choices)
    change = models.CharField(max_length=300, blank=True, default="")
    dish = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "meal"]
        constraints = [
            models.UniqueConstraint(fields=["profile", "date", "meal"], name="uniq_mealcheck_profile_date_meal")
        ]

    def __str__(self) -> str:
        return f"MealCheck<{self.profile_id} {self.date} {self.meal} {self.state}>"
