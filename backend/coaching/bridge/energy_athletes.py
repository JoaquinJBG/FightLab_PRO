"""Ecuaciones de RMR para atletas: ten Haaf y Cunningham (sugerencia U04, fase 4).

El motor (`coach.energy`) solo calcula Mifflin-St Jeor, aunque `nutrition.md` tiene la regla
"Trained clients: Cunningham or ten Haaf". Aquí se aplica esa regla sin tocar el motor:

- con masa magra fiable (grasa corporal medida con DXA, BodPod, BIA de laboratorio o
  pliegues, y reciente), Cunningham;
- sin datos de composición corporal, ten Haaf por peso (la fórmula está en la propia regla);
- con una grasa corporal que no es fiable (báscula doméstica o método desconocido), Mifflin-
  St Jeor, como manda "Body-fat measurement error carries into RMR";
- fuera de la población de la regla (no entrena con regularidad, IMC de obesidad, mayores),
  Mifflin-St Jeor.

El RMR elegido se pasa al motor como `tdee_kcal` (RMR × PAL del motor), así que los suelos y
bloqueos de `energy.calorie_target` siguen aplicándose.
"""
from dataclasses import dataclass, field
from datetime import date

from coach import energy
from coach.profile import Profile

from coaching.keys import rule_key

KJ_PER_KCAL = 4.184
# nutrition.md: "Trained clients: Cunningham or ten Haaf": REE (kJ/d) = 49.940 × kg +
# 2459.053 × m - 34.014 × age + 799.257 × (male = 1) + 122.502.
TEN_HAAF_KG, TEN_HAAF_M, TEN_HAAF_AGE, TEN_HAAF_MALE, TEN_HAAF_CONSTANT = 49.940, 2459.053, -34.014, 799.257, 122.502
# Cunningham (1980): RMR = 500 + 22 × FFM. La regla del coach nombra la ecuación pero no da los
# coeficientes; son los de la publicación original.
CUNNINGHAM_INTERCEPT, CUNNINGHAM_PER_KG_FFM = 500, 22

# nutrition.md: "Body-fat measurement error carries into RMR": solo DXA, BodPod, BIA de
# investigación u octopolar, o pliegues bien hechos; una báscula doméstica no vale.
RELIABLE_BODY_FAT_METHODS = ("dxa", "bodpod", "bia_lab", "skinfolds")
BODY_FAT_METHODS = (*RELIABLE_BODY_FAT_METHODS, "smart_scale", "other")
# convention (FightLab): la regla no dice cuánto dura una medida. Una de hace más de 90 días no
# cuenta como "actual" (el cuerpo cambia durante un corte o una fase de volumen).
BODY_FAT_MAX_AGE_DAYS = 90
# Población de la regla: "Applies to: adult athletes and recreational exercisers ... Do not
# generalise to older or sedentary adults or to obesity". "Mayor" y "obesidad" son los umbrales
# del motor (`energy.OLDER_ADULT_AGE`, `energy.OBESITY_BMI`); entrenar con regularidad es
# convention (FightLab): cualquier nivel de actividad salvo `desk`.
TRAINED_LEVELS = ("desk_training", "active")

TRAINED_RULE = 'nutrition.md: "Trained clients: Cunningham or ten Haaf"'
BODY_FAT_RULE = 'nutrition.md: "Body-fat measurement error carries into RMR"'
MSJ_RULE = 'nutrition.md: "Default RMR equation: Mifflin-St Jeor"'

MIFFLIN, CUNNINGHAM, TEN_HAAF = "mifflin_st_jeor", "cunningham", "ten_haaf"
_RULES = {MIFFLIN: MSJ_RULE, CUNNINGHAM: TRAINED_RULE, TEN_HAAF: TRAINED_RULE}


@dataclass(frozen=True)
class BodyFat:
    """Una medida de grasa corporal de `BiometricsLog`."""

    pct: float
    method: str | None
    date: date
    weight_kg: float | None = None  # el peso de esa misma medida, si lo tiene


@dataclass
class RmrChoice:
    equation: str
    rmr_kcal: float
    ffm_kg: float | None = None
    notes: list[str] = field(default_factory=list)

    @property
    def rule(self) -> str:
        return _RULES[self.equation]

    @property
    def rule_key(self) -> str:
        file, heading = self.rule.split(': "', 1)
        return rule_key(file, heading.rstrip('"'))


def ten_haaf_rmr(profile: Profile, today: date | None = None) -> float:
    kj = (
        TEN_HAAF_KG * profile.require("weight_kg")
        + TEN_HAAF_M * profile.require("height_cm") / 100
        + TEN_HAAF_AGE * profile.age(today)
        + (TEN_HAAF_MALE if profile.require("sex") == "male" else 0.0)
        + TEN_HAAF_CONSTANT
    )
    return kj / KJ_PER_KCAL


def cunningham_rmr(ffm_kg: float) -> float:
    return CUNNINGHAM_INTERCEPT + CUNNINGHAM_PER_KG_FFM * ffm_kg


def in_rule_population(profile: Profile, today: date | None = None) -> bool:
    return (
        profile.activity_level in TRAINED_LEVELS
        and profile.age(today) < energy.OLDER_ADULT_AGE
        and profile.bmi() < energy.OBESITY_BMI
    )


def choose_rmr(profile: Profile, body_fat: BodyFat | None, today: date | None = None) -> RmrChoice:
    """El RMR de partida de `profile` y de dónde sale. `body_fat` es la última medida (o None)."""
    msj = RmrChoice(MIFFLIN, energy.rmr_mifflin(profile, today))
    if not in_rule_population(profile, today):
        return msj
    today = today or date.today()
    recent = body_fat if body_fat and (today - body_fat.date).days <= BODY_FAT_MAX_AGE_DAYS else None
    if recent is None:
        return RmrChoice(
            TEN_HAAF,
            ten_haaf_rmr(profile, today),
            notes=[f"{TRAINED_RULE}: ten Haaf weight-based equation, as there is no recent body composition"],
        )
    if recent.method not in RELIABLE_BODY_FAT_METHODS:
        how = recent.method if recent.method in BODY_FAT_METHODS else "unknown"
        msj.notes.append(
            f"{BODY_FAT_RULE}: body fat from {how} is not accurate enough for an FFM equation, "
            "so Mifflin-St Jeor is used"
        )
        return msj
    weight = recent.weight_kg or profile.require("weight_kg")
    ffm = weight * (1 - recent.pct / 100)
    return RmrChoice(
        CUNNINGHAM,
        cunningham_rmr(ffm),
        ffm_kg=ffm,
        notes=[
            f"{TRAINED_RULE}: Cunningham equation from {ffm:.1f} kg of fat-free mass "
            f"({recent.pct:g}% body fat by {recent.method})",
            f"{BODY_FAT_RULE}: the body-fat measurement error carries into the RMR; use the same "
            "method each time",
        ],
    )
