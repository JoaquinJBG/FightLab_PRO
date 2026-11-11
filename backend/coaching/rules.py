"""Intensidad de cada modalidad y qué flags la excluyen (Task 6.3, spec §8.2, sugerencia U05).

En el coach, sacar del plan el trabajo vigoroso mientras `review_before_vigorous` (o
`cap_moderate`) y los sprints a tope mientras `no_all_out_sprints` es texto de la skill `plan`.
Aquí es una tabla con su regla por modalidad, y el generador del plan solo usa lo que
`allowed()` deja.

Cada modalidad lleva la regla que le da su clase (`rule`, literal `archivo.md: "Encabezado"`) o
está etiquetada como convención (`convention`): `"coach"` si la convención es del coach (está en
su `docs/conventions.md`) y `"fightlab"` si es de FightLab ("Convención de FightLab, sin
revisar"). Las del combate salen del anexo E (`knowledge_fightlab/combat-sports.md`).
"""
from dataclasses import dataclass

from coach import safety

LIGHT, MODERATE, VIGOROUS, MAXIMAL = "light", "moderate", "vigorous", "maximal"
INTENSITIES = (LIGHT, MODERATE, VIGOROUS, MAXIMAL)

# Reglas del coach.
WEEKLY_BASELINE = 'cardio-health.md: "Weekly baseline dose"'
ACSM_BANDS = 'cardio-health.md: "ACSM intensity bands"'
JUMP_ROPE = 'cardio-health.md: "Jump rope as conditioning"'
MIN_DOSE_SIT = 'cardio-health.md: "Minimum effective dose: REHIT and 3 x 20 s"'
PARQ_THRESHOLDS = safety.PARQ_THRESHOLDS  # recovery-habits.md: "PAR-Q+ specific thresholds"
# Reglas del anexo de combate de FightLab.
HARD_SPARRING = 'combat-sports.md: "Hard striking sparring is vigorous in small samples"'
PADS_BAG = 'combat-sports.md: "Class pad and bag work by pace"'
DRILLING = 'combat-sports.md: "Technical drilling runs below sparring"'
DRILL_STRUCTURE = 'combat-sports.md: "Class drills by structure, and judo randori sits below competition"'
ROLLING = 'combat-sports.md: "Grappling roll intensity class is a FightLab convention"'


@dataclass(frozen=True)
class Modality:
    intensity: str
    rule: str | None = None
    convention: str | None = None  # None (sale de la regla), "coach" o "fightlab"
    all_out_sprint: bool = False  # SIT y REHIT: fuera con `no_all_out_sprints`
    contact: bool = False  # fuera con `no_contact` (golpe en la cabeza, anexo E)
    combat: bool = False


MODALITY_INTENSITY: dict[str, Modality] = {
    # Cardio
    "walking_brisk": Modality(MODERATE, WEEKLY_BASELINE),  # "brisk walking counts"
    "continuous_moderate": Modality(MODERATE, ACSM_BANDS),  # la zona moderada de `coach zones`
    "hiit": Modality(VIGOROUS, PARQ_THRESHOLDS),
    "sprints": Modality(MAXIMAL, PARQ_THRESHOLDS),  # "all-out sprints"
    "sit": Modality(MAXIMAL, MIN_DOSE_SIT, all_out_sprint=True),
    "rehit": Modality(MAXIMAL, MIN_DOSE_SIT, all_out_sprint=True),
    "jump_rope": Modality(VIGOROUS, JUMP_ROPE),
    # Fuerza. "PAR-Q+ specific thresholds" nombra los tests de 1RM; los saltos pliométricos y las
    # cargas casi máximas son trabajo vigoroso por la misma cautela (convención del coach,
    # `docs/conventions.md`, /plan).
    "one_rm_test": Modality(MAXIMAL, PARQ_THRESHOLDS),
    "plyometrics": Modality(VIGOROUS, PARQ_THRESHOLDS, convention="coach"),
    "near_maximal_lift": Modality(MAXIMAL, PARQ_THRESHOLDS, convention="coach"),
    # Combate (anexo E). Sin pace conocido, el sparring es duro y el saco, lento: lo marca el RPE.
    "sparring_hard": Modality(VIGOROUS, HARD_SPARRING, contact=True, combat=True),
    # La regla dice que el sparring ligero o técnico "will sit lower", sin decir cuánto.
    "sparring_light": Modality(MODERATE, HARD_SPARRING, convention="fightlab", contact=True, combat=True),
    "competition": Modality(VIGOROUS, None, convention="fightlab", contact=True, combat=True),
    "pads_hard": Modality(VIGOROUS, PADS_BAG, combat=True),
    "bag_slow": Modality(MODERATE, PADS_BAG, combat=True),
    "technical_drilling": Modality(MODERATE, DRILLING, combat=True),  # "light to moderate"
    "drills_all_out": Modality(VIGOROUS, DRILL_STRUCTURE, convention="fightlab", combat=True),
    "rolling_hard": Modality(VIGOROUS, ROLLING, convention="fightlab", contact=True, combat=True),
    "rolling_flow": Modality(MODERATE, ROLLING, convention="fightlab", contact=True, combat=True),
}

# Trabajo de una sesión de MMA, de más a menos intenso, para cuando el plan tiene que ofrecer lo
# que se puede hacer ese día.
COMBAT_WORK = (
    "sparring_hard", "competition", "rolling_hard", "pads_hard", "drills_all_out",
    "sparring_light", "rolling_flow", "technical_drilling", "bag_slow",
)
CARDIO_OPTIONS = ("walking_brisk", "continuous_moderate", "jump_rope", "hiit", "sprints", "sit", "rehit")


def blocked_by(key: str, flags, no_contact: bool = False) -> list[str]:
    """Los flags que excluyen la modalidad `key` (vacío: está permitida)."""
    modality = MODALITY_INTENSITY[key]
    out = []
    if flags.no_training:
        out.append("no_training")
    if modality.intensity in (VIGOROUS, MAXIMAL):
        if flags.review_before_vigorous:
            out.append("review_before_vigorous")
        if flags.cap_moderate:
            out.append("cap_moderate")
    if modality.all_out_sprint and flags.no_all_out_sprints:
        out.append("no_all_out_sprints")
    if modality.contact and no_contact:
        out.append("no_contact")
    elif no_contact and modality.intensity in (VIGOROUS, MAXIMAL):
        # R3-3: tras un golpe en la cabeza con síntomas, la vuelta es por fases ("Return to contact
        # follows a graded clinician-supervised plan"): aeróbico ligero y después moderado, y el
        # trabajo exigente solo cuando un clínico lo autoriza. Hasta el alta, nada vigoroso.
        out.append("head_blow_return")
    return out


def allowed(key: str, flags, no_contact: bool = False) -> bool:
    return not blocked_by(key, flags, no_contact)


def rule_literals() -> set[str]:
    return {m.rule for m in MODALITY_INTENSITY.values() if m.rule}
