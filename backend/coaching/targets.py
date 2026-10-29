"""Objetivos de energía, macros y zonas (Tasks 4.1, 4.2, 4.6, 4.7).

Cada número sale del motor (`coach.energy`, `coach.macros`, `coach.zones`) y va con las
reglas de `knowledge/` que lo respaldan. El puente solo hace dos cosas propias, las dos
apuntadas en `docs/coach-upstream-sugerencias.md`:

- U04: el RMR de partida puede venir de ten Haaf o de Cunningham (`bridge/energy_athletes.py`).
  Se pasa al motor como `tdee_kcal` (RMR × PAL del motor), así los suelos y bloqueos de
  `energy.calorie_target` y `macros.macro_targets` se siguen aplicando.
- U06: con `no_training` el motor sigue usando el nivel de actividad del perfil. Aquí se
  calcula con el PAL de `desk`, etiquetado como convención de FightLab.
"""
from dataclasses import replace
from datetime import date

from coach import energy, macros, safety, zones
from coach.profile import ProfileIncomplete

from .bridge import energy_athletes, reason_texts
from .bridge.adapters import latest_body_fat, latest_resting_hr, latest_weight, to_coach_profile
from .bridge.reasons import Reason, parse_reason
from .keys import rule_key
from .models import KnowledgeRule, RuleTranslation
from .views import engine_info

# Reglas de `nutrition.md` que respaldan un número sin que el motor las cite en sus motivos
# (están en sus comentarios). Un test comprueba que existen en la base de evidencia.
DEFICIT_RULES = (
    'nutrition.md: "Deficit size for weight loss (overweight and obesity)"',
    'nutrition.md: "Deficit size when keeping or building muscle"',
)
SURPLUS_RULE = 'nutrition.md: "Surplus size for muscle gain"'
FAT_RULE = 'nutrition.md: "Minimum dietary fat"'
FIBRE_RULE = 'nutrition.md: "Dietary fibre"'
CITED_RULES = (
    energy.PAL_RULE, energy.FLOOR_RULE, energy.RECALIBRATE_RULE, energy_athletes.MSJ_RULE,
    energy_athletes.TRAINED_RULE, energy_athletes.BODY_FAT_RULE, *DEFICIT_RULES, SURPLUS_RULE, FAT_RULE,
    FIBRE_RULE, zones.BANDS_RULE, zones.HRMAX_RULE,
)

# convention (FightLab): sin entrenar (`no_training`) la estimación usa este nivel de actividad.
NO_TRAINING_ACTIVITY_LEVEL = "desk"
NO_TRAINING_NOTE = (
    "FightLab convention: no training until a clinician clears it, so the energy estimate uses "
    "the desk activity level"
)


def _key(literal: str) -> str:
    file, heading = literal.split(': "', 1)
    return rule_key(file, heading.rstrip('"'))


def _unique(items) -> list:
    return list(dict.fromkeys(items))


def _reasons(notes: list[str]) -> list[Reason]:
    return [parse_reason(text) for text in _unique(notes)]


def rule_refs(keys, lang: str) -> list[dict]:
    """`[{key, grade, title}]` de las reglas `keys` (con el título en `lang` si hay traducción)."""
    keys = [k for k in _unique(keys) if k]
    rules = {r.key: r for r in KnowledgeRule.objects.filter(key__in=keys)}
    titles = {}
    if lang != "en":
        titles = {
            t.rule.key: t.heading
            for t in RuleTranslation.objects.filter(rule__key__in=keys, lang=lang).exclude(heading="").select_related("rule")
        }
    return [
        {
            "key": key,
            "grade": rules[key].grade if key in rules else None,
            "title": titles.get(key) or (rules[key].heading if key in rules else key.split("/", 1)[-1]),
        }
        for key in keys
    ]


def reasons_data(reasons: list[Reason], lang: str) -> list[dict]:
    grades = dict(KnowledgeRule.objects.filter(key__in={r.rule_key for r in reasons if r.rule_key}).values_list("key", "grade"))
    return [
        {
            "code": r.code,
            "rule_key": r.rule_key,
            "grade": grades.get(r.rule_key),
            "params": r.params,
            **reason_texts.describe(r, lang),
        }
        for r in reasons
    ]


def weight_data(user, today: date) -> dict | None:
    found = latest_weight(user, today)
    if found is None:
        return None
    kg, day = found
    return {"kg": kg, "date": day.isoformat(), "stale_days": (today - day).days}


def targets_data(user, today: date, lang: str) -> dict:
    """Los objetivos de energía y macros de `user`. Lanza `ProfileIncomplete` si falta un dato
    (la API lo convierte en 409 con el campo)."""
    profile = to_coach_profile(user, today)
    flags = safety.flags(profile, today)
    if not flags.screened:
        # Spec §8.1: sin el cribado de TCA contestado no hay objetivos. El motor solo lo exige al
        # calcular un déficit (`deficit_blockers`); aquí también con otro objetivo, porque un
        # superávit es un objetivo de peso y lo bloquean los mismos flags.
        raise ProfileIncomplete("screening.scoff_yes_count")
    base = {"engine": engine_info(), "weight": weight_data(user, today)}
    if flags.no_calorie_targets:
        block = parse_reason(safety.calorie_block_reason(flags))
        return {
            **base,
            "blocked": {"code": "no_calorie_targets", "reason_code": block.code},
            "goal": profile.goal, "kcal": None, "maintenance_kcal": None, "deficit_kcal": None, "in_deficit": False,
            "deficit_blocked": True, "clamped": False, "macros": None, "equation": None, "rules": {},
            "reasons": reasons_data([block], lang),
        }

    notes: list[str] = []
    calc = profile
    if flags.no_training:  # U06
        calc = replace(profile, activity_level=NO_TRAINING_ACTIVITY_LEVEL)
        notes.append(NO_TRAINING_NOTE)
    choice = energy_athletes.choose_rmr(calc, latest_body_fat(user, today), today)  # U04
    pal = energy.pal(calc)
    target = energy.calorie_target(calc, flags, today=today, tdee_kcal=choice.rmr_kcal * pal)
    in_deficit = target.deficit > 0
    # Lo que decide si la UI ofrece "Perder": los mismos bloqueos que usa el motor para el déficit.
    deficit_blocked = bool(energy.deficit_blockers(calc, flags, today)) or flags.hold_deficit
    m = macros.macro_targets(calc, target.kcal, in_deficit=in_deficit, today=today)

    reasons = _reasons(notes + choice.notes + target.notes + m.notes)
    protein_keys = [r.rule_key for r in reasons if r.code == "protein_per_kg"]
    kcal_keys = [
        choice.rule_key, _key(energy.PAL_RULE),
        *(_key(r) for r in DEFICIT_RULES if in_deficit),
        *([_key(SURPLUS_RULE)] if target.deficit < 0 else []),
        *(r.rule_key for r in reasons if r.rule_key and r.code not in ("protein_per_kg",)),
    ]
    rule_keys = {
        "kcal": kcal_keys,
        "protein_g": protein_keys,
        "fat_g": [_key(FAT_RULE)],
        "fibre_g": [_key(FIBRE_RULE)],
    }
    return {
        **base,
        "blocked": None,
        "goal": profile.goal,
        "kcal": target.kcal,
        "maintenance_kcal": round(target.maintenance),
        "deficit_kcal": target.deficit,
        "in_deficit": in_deficit,
        "deficit_blocked": deficit_blocked,
        "clamped": target.clamped,
        "macros": {
            "protein_g": round(m.protein_g, 2),
            "fat_g": round(m.fat_g, 2),
            "fat_min_g": round(m.fat_min_g, 2),
            "carbs_g": round(m.carbs_g, 2),
            "fibre_g": m.fibre_g,
            "protein_g_per_kg": m.protein_g_per_kg,
        },
        "equation": {
            "code": choice.equation,
            "rmr_kcal": round(choice.rmr_kcal, 2),
            "ffm_kg": round(choice.ffm_kg, 2) if choice.ffm_kg is not None else None,
            "pal": round(pal, 3),
            "activity_level": calc.activity_level,
            "rule_key": choice.rule_key,
        },
        "rules": {name: rule_refs(keys, lang) for name, keys in rule_keys.items()},
        "reasons": reasons_data(reasons, lang),
    }


def zones_data(user, today: date, lang: str) -> dict:
    """Las zonas de esfuerzo (FC y RPE) de `user`, con la FC en reposo de `BiometricsLog` si la hay."""
    profile = to_coach_profile(user, today)
    flags = safety.flags(profile, today)
    rest = latest_resting_hr(user, today)
    hr_rest = rest[0] if rest and zones.HR_REST_RANGE[0] <= rest[0] <= zones.HR_REST_RANGE[1] else None
    try:
        result = zones.hr_zones(profile, flags, hr_rest=hr_rest, today=today)
    except ValueError:  # FC en reposo por encima de la máxima estimada: se ignora
        hr_rest = None
        result = zones.hr_zones(profile, flags, today=today)
    reasons = _reasons(result.notes)
    keys = [*([_key(zones.BANDS_RULE)] if result.zones else []), *(r.rule_key for r in reasons if r.rule_key)]
    return {
        "engine": engine_info(),
        "method": result.method,
        "zones": [
            {
                "name": z.name,
                "rpe": list(z.rpe),
                "talk_test": z.talk_test,
                "bpm": list(z.bpm) if z.bpm else None,
            }
            for z in result.zones
        ],
        "hr_max": result.hr_max,
        "hr_max_source": result.hr_max_source,
        "hr_rest": result.hr_rest,
        "hr_rest_date": rest[1].isoformat() if rest and result.hr_rest is not None else None,
        "rules": rule_refs(keys, lang),
        "reasons": reasons_data(reasons, lang),
    }
