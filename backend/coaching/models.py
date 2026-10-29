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
