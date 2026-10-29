"""Motivos del motor (`archivo.md: "Encabezado": texto`) → motivos estructurados.

El motor devuelve los motivos como cadenas en inglés con la regla como prefijo. Aquí se
separa la referencia (de ahí sale `rule_key`) del texto y se deduce un `code` y los
`params` (lectura de tensión, zona de la lesión, kcal...). Las plantillas por idioma
(`reason_texts.py`, fase 3) se indexan por `code`. Es la parte de FightLab de la
sugerencia U03 (`docs/coach-upstream-sugerencias.md`).

Un motivo que no encaja en ningún patrón da `code="unknown"`: se muestra el texto original
con su regla y se registra en el log.
"""
import logging
import re
from dataclasses import dataclass, field

from coach import energy, mealplan, safety, zones

from coaching.bridge import energy_athletes
from coaching.keys import rule_key

logger = logging.getLogger(__name__)

UNKNOWN = "unknown"

REFERENCE_RE = re.compile(r'(?P<file>[\w-]+)\.md: "(?P<heading>[^"]+)"')
PREFIX_RE = re.compile(r'^' + REFERENCE_RE.pattern + r"(?:: (?P<text>.*))?$", re.S)


@dataclass(frozen=True)
class Reason:
    code: str
    rule_key: str | None
    params: dict = field(default_factory=dict)
    original_text: str = ""


def heading_of(rule_literal: str) -> str:
    """Encabezado de un literal `archivo.md: "Encabezado"` del motor."""
    return REFERENCE_RE.search(rule_literal).group("heading")


# (literal de la regla en el motor, patrón del texto tras la referencia, code).
# El primero que encaja gana. Los grupos con nombre pasan a `params`.
RULE_PATTERNS: list[tuple[str, str, str]] = [
    (safety.UNDER_18, r"^under 18, out of scope", "under_18"),
    (safety.SCOFF, r"^positive screen", "eating_disorder_screen"),
    (safety.GLP1_RULE, r"^the prescriber owns", "glp1_prescriber"),
    (safety.GLP1_RULE, r"^below (?P<kcal>[\d,]+) kcal", "glp1_low_intake"),
    (safety.PREGNANCY_NUTRITION, r"^GLP-1 user pregnant", "pregnancy_glp1"),
    (safety.PREGNANCY_NUTRITION, r"^no deficit; weight targets", "pregnancy_no_deficit"),
    (safety.PREGNANCY_ACTIVITY, r"^clear the plan", "pregnancy_activity"),
    (safety.PREGNANCY_INTENSITY, r"^gauge intensity by talk test and RPE$", "pregnancy_intensity"),
    (safety.PREGNANCY_INTENSITY, r"^moderate is RPE 13-14", "pregnancy_intensity_rpe"),
    (zones.PREGNANCY_VIGOROUS_RULE, r"^vigorous only if already", "pregnancy_vigorous"),
    (safety.BETA_BLOCKER_RULE, r"^prescribe by RPE", "beta_blocker_rpe"),
    (zones.BETA_RULE, r"^no sustained vigorous work", "beta_blocker_no_vigorous"),
    (safety.MENSTRUAL, r"^new irregular periods", "menstrual_irregular"),
    (safety.MENSTRUAL, r"^periods absent", "menstrual_absent"),
    (safety.PARQ, r"^follow-up YES", "parq_followup"),
    (
        safety.PARQ_THRESHOLDS,
        r"^(?P<why>a PAR-Q\+ YES|PAR-Q\+ not answered), so no all-out sprint",
        "parq_no_sprints",
    ),
    (safety.PARQ_THRESHOLDS, r"^PAR-Q\+ not answered, so light-to-moderate", "parq_unanswered_light"),
    (
        safety.PARQ_THRESHOLDS,
        r"^(?P<why>a PAR-Q\+ YES|aged (?P<age>\d+) or more), so a qualified",
        "parq_review_vigorous",
    ),
    (
        safety.INJURY,
        r"^(?P<area>.+?) injury, managed by (?P<professional>.+?): no progression",
        "injury_managed",
    ),
    (safety.INJURY, r"^(?P<area>.+?) injury not yet assessed", "injury_unassessed"),
    (safety.BP, r"^BP unknown with known hypertension", "bp_unknown_hypertension"),
    (safety.BP, r"^(?P<systolic>[\d?]+)/(?P<diastolic>[\d?]+), no exercise", "bp_no_exercise"),
    (safety.BP, r"^(?P<systolic>[\d?]+)/(?P<diastolic>[\d?]+), no training until", "bp_no_training"),
    (safety.BP, r"^(?P<systolic>[\d?]+)/(?P<diastolic>[\d?]+), GP review", "bp_gp_review"),
    (safety.BP, r"^(?P<systolic>[\d?]+)/(?P<diastolic>[\d?]+), moderate intensity", "bp_moderate"),
    (safety.CARDIAC, r"^stop exercising", "cardiac_symptoms"),
    (energy.OLDER_RULE, r"^no deficit for adults about (?P<age>\d+)\+", "older_no_deficit"),
    (energy.RECALIBRATE_RULE, r"^maintenance from the weight trend", "recalibrate_from_trend"),
    (energy.RECALIBRATE_RULE, r"^starting estimate from an equation", "recalibrate_equation"),
    (energy.RECALIBRATE_RULE, r"^starting estimate, recalibrate after", "recalibrate_start"),
    (
        energy.RECALIBRATE_RULE,
        r"^one step of (?P<step_kcal>[\d,]+) kcal down from the current (?P<current_kcal>[\d,]+) kcal; "
        r"the full target is (?P<target_kcal>[\d,]+) kcal",
        "recalibrate_step",
    ),
    (energy.FLOOR_RULE, r"^raised to the (?P<floor_kcal>[\d,]+) kcal floor", "floor_raised"),
    (zones.BANDS_RULE, r"^zones are approximate", "bands_approx"),
    (zones.BANDS_RULE, r"^with known heart disease", "bands_cardiac_team"),
    (zones.HRMAX_RULE, r"^HRmax from Tanaka", "hrmax_tanaka"),
    (mealplan.FREE_MEAL_RULE, r"^no free meal", "free_meal_blocked"),
]

# Motivos que añade el puente de FightLab (no los produce el motor): la ecuación de RMR para
# atletas (U04). Llevan la regla del coach que los respalda.
BRIDGE_PATTERNS: list[tuple[str, str, str]] = [
    (energy_athletes.TRAINED_RULE, r"^ten Haaf weight-based equation", "rmr_ten_haaf"),
    (
        energy_athletes.TRAINED_RULE,
        r"^Cunningham equation from (?P<ffm_kg>[\d.]+) kg of fat-free mass "
        r"\((?P<body_fat_pct>[\d.]+)% body fat by (?P<method>\w+)\)",
        "rmr_cunningham",
    ),
    (energy_athletes.BODY_FAT_RULE, r"^body fat from (?P<method>\w+) is not accurate", "body_fat_unreliable"),
    (energy_athletes.BODY_FAT_RULE, r"^the body-fat measurement error carries", "body_fat_error_carries"),
]
# Motivos propios sin regla: una convención de FightLab (U06).
BRIDGE_FREE_PATTERNS: list[tuple[str, str]] = [
    (r"^FightLab convention: no training", "no_training_desk_pal"),
]
BRIDGE_CODES = {code for _, _, code in BRIDGE_PATTERNS} | {code for _, code in BRIDGE_FREE_PATTERNS}

# Motivos sin regla (el motor los marca como convención o los deja sin prefijo).
# `^PAL ... ` va aquí porque el motor cita la regla entre paréntesis, no al principio.
FREE_PATTERNS: list[tuple[str, str]] = [
    (r"^PAL (?P<pal>[\d.]+) is too low", "pal_too_low"),
    (r"^PAL (?P<pal>[\d.]+) is too high", "pal_too_high"),
    (r"^no weigh-ins$", "no_weigh_ins"),
    (r"^need at least (?P<min_points>\d+) weigh-ins covering (?P<min_days>\d+) days", "trend_insufficient"),
    (r"^current intake unknown: holding at maintenance", "intake_unknown_holding"),
    (r"^convention: protein from (?P<weight_kg>[\d.]+) kg", "protein_reference_weight"),
    (r"^protein and fat minimums already exceed", "carbs_zero"),
]

# Reglas que el motor cita entre paréntesis (no como prefijo): sus motivos están en FREE_PATTERNS.
INLINE_RULE_HEADINGS = {heading_of(energy.PAL_RULE)}

PROTEIN_RE = re.compile(r"^(?P<per_kg>[\d.]+) g/kg/day$")

_COMPILED = [(heading_of(rule), re.compile(pat), code) for rule, pat, code in RULE_PATTERNS + BRIDGE_PATTERNS]
_FREE = [(re.compile(pat), code) for pat, code in FREE_PATTERNS + BRIDGE_FREE_PATTERNS]


def _convert(params: dict) -> dict:
    out = {}
    for name, value in params.items():
        if value is None:
            continue
        if name == "why":
            out[name] = "age" if value.startswith("aged") else "yes" if value.endswith("YES") else "unanswered"
        elif name in ("pal", "per_kg", "weight_kg", "ffm_kg", "body_fat_pct"):
            out[name] = float(value)
        elif name in ("systolic", "diastolic"):
            out[name] = None if value == "?" else int(value)
        elif name in ("area", "professional", "method"):
            out[name] = value
        else:
            out[name] = int(value.replace(",", ""))
    return out


def parse_reason(text: str) -> Reason:
    """`nutrition.md: "Heading": texto` → `Reason(code, rule_key, params, original_text)`."""
    prefix = PREFIX_RE.match(text)
    if prefix:
        heading, body = prefix.group("heading"), prefix.group("text") or ""
        key = rule_key(prefix.group("file"), heading)
        for rule_heading, pattern, code in _COMPILED:
            if rule_heading != heading:
                continue
            if m := pattern.search(body):
                return Reason(code, key, _convert(m.groupdict()), text)
        if m := PROTEIN_RE.match(body):
            return Reason("protein_per_kg", key, _convert(m.groupdict()), text)
        logger.warning("motivo del motor sin plantilla: %s", text)
        return Reason(UNKNOWN, key, {}, text)

    # La regla puede ir entre paréntesis al final (`... (nutrition.md: "...")`).
    inline = REFERENCE_RE.search(text)
    key = rule_key(inline.group("file"), inline.group("heading")) if inline else None
    for pattern, code in _FREE:
        if m := pattern.search(text):
            return Reason(code, key, _convert(m.groupdict()), text)
    logger.warning("motivo del motor sin plantilla: %s", text)
    return Reason(UNKNOWN, key, {}, text)
