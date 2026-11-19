"""Contrato del puente con el motor vendorizado (spec §4 y §6.8).

Falla si una actualización del subtree cambia la firma de una función que usa el puente,
los campos del perfil o del cribado, o si desaparece `coach.profile._validate` (privada:
sugerencia U01). Se ejecuta en cada `subtree pull`, junto con el resto de la suite.
"""
import dataclasses
import inspect

import pytest
from coach import energy, foods, knowledge, macros, profile, safety, strength, trend, zones

from coaching.models import Injury, Screening

# función del motor → nombres de sus parámetros, en orden
SIGNATURES = {
    safety.flags: ["profile", "today"],
    energy.rmr_mifflin: ["profile", "today"],
    energy.tdee: ["profile", "multiplier", "today"],
    energy.calorie_target: ["profile", "flags", "goal", "today", "tdee_kcal", "current_kcal", "recalibrated"],
    macros.macro_targets: ["profile", "kcal", "in_deficit", "today"],
    zones.hr_zones: ["profile", "flags", "hr_rest", "hr_max", "today"],
    trend.weight_trend: ["points", "flags"],
    trend.recalibrate_tdee: ["trend", "intake_kcal", "energy_density"],
    strength.e1rm: ["weight", "reps", "rir"],
    strength.weekly_hard_sets: ["sets", "muscle_map"],
    strength.progression: ["history", "today", "rep_range", "muscle_map", "flags", "stall_after"],
    strength.deload: ["signs"],
    knowledge.iter_rules: ["text"],
    knowledge.section: ["file", "heading", "knowledge_dir"],
    foods.load_foods: ["region", "root"],
}

# Campos de `coach.profile.Profile` que rellena el adaptador
PROFILE_FIELDS = {
    "sex", "birth_date", "height_cm", "weight_kg", "goal", "experience", "activity_level",
    "language", "region", "emergency_number", "medications", "conditions", "screening",
    "injuries", "research_reminder_months",
}

SAFETY_FLAGS = {
    "screened", "no_deficit", "no_weight_targets", "hold_deficit", "use_rpe_not_hr",
    "prescriber_owns_weight", "refer_gp", "no_training", "cap_moderate", "no_calorie_targets",
    "hold_progression", "review_before_vigorous", "no_all_out_sprints", "emergency_number",
    "paused_exercises", "reasons",
}


@pytest.mark.parametrize("func", list(SIGNATURES), ids=lambda f: f"{f.__module__}.{f.__name__}")
def test_engine_signatures(func):
    assert list(inspect.signature(func).parameters) == SIGNATURES[func]


def test_private_validate_still_exists():
    assert callable(profile._validate)
    assert list(inspect.signature(profile._validate).parameters) == ["data"]
    with pytest.raises(ValueError):
        profile._validate({"sex": "other"})


def test_profile_fields():
    assert {f.name for f in dataclasses.fields(profile.Profile)} == PROFILE_FIELDS


def test_safety_flags_fields():
    assert {f.name for f in dataclasses.fields(safety.SafetyFlags)} == SAFETY_FLAGS


def test_screening_keys_match_the_model():
    names = {f.name for f in Screening._meta.get_fields()} - {"id", "profile", "updated_at"}
    assert names == set(profile.SCREENING_KEYS)
    assert profile.PARQ_ANSWERS == ("parq_any_yes", "parq_followup_yes")
    assert set(Screening.Menstrual.values) == set(profile.MENSTRUAL_STATES)


def test_injury_keys_match_the_model():
    assert set(profile.INJURY_KEYS) == {"area", "status", "since", "professional", "cleared_on", "exercises"}
    assert set(Injury.Status.values) == set(profile.INJURY_STATUSES)


def test_tokens_and_enums():
    assert profile.MEDICATION_TOKENS == ("beta_blocker", "glp1")
    assert set(profile.CONDITION_TOKENS) == {
        "pregnant", "planning_pregnancy", "hypertension", "heart_disease", "weight_related_condition",
    }
    assert profile.SEXES == ("female", "male")
    assert profile.LANGUAGES == ("es", "en")
