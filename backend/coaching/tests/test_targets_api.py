"""`GET /api/v1/coach/targets` (Tasks 4.1, 4.6, 4.7): kcal y macros del motor, con sus reglas."""
from datetime import date

import pytest
from coach import energy, macros, safety
from rest_framework.test import APIClient

from coaching.bridge.adapters import to_coach_profile
from coaching.models import KnowledgeRule

from .helpers import TODAY, client_for, fix_today, make_user

URL = "/api/v1/coach/targets"

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _today():
    with fix_today():
        yield


def get(user, lang=None, **extra):
    client = client_for(user)
    if lang:
        extra["HTTP_ACCEPT_LANGUAGE"] = lang
    return client.get(URL, **extra)


def engine_numbers(user, goal=None, tdee=None):
    """Lo que da el motor directamente para `user` (sin ecuación de atletas ni no_training)."""
    p = to_coach_profile(user, TODAY)
    flags = safety.flags(p, TODAY)
    target = energy.calorie_target(p, flags, goal=goal, today=TODAY, tdee_kcal=tdee)
    return p, flags, target, macros.macro_targets(p, target.kcal, in_deficit=target.deficit > 0, today=TODAY)


def test_requires_auth():
    assert APIClient().get(URL).status_code == 401


def test_maintenance_numbers_are_the_engines_and_carry_their_rules():
    user = make_user(profile={"activity_level": "desk"})
    resp = get(user)
    assert resp.status_code == 200, resp.data
    _, _, target, m = engine_numbers(user)
    body = resp.data
    assert body["blocked"] is None
    assert body["goal"] == "maintenance"
    assert body["kcal"] == target.kcal
    assert body["maintenance_kcal"] == round(target.maintenance)
    assert body["deficit_kcal"] == 0
    assert body["macros"]["protein_g"] == pytest.approx(m.protein_g, abs=0.01)
    assert body["macros"]["fat_g"] == pytest.approx(m.fat_g, abs=0.01)
    assert body["macros"]["carbs_g"] == pytest.approx(m.carbs_g, abs=0.01)
    assert body["macros"]["fibre_g"] == m.fibre_g
    assert body["macros"]["protein_g_per_kg"] == m.protein_g_per_kg
    assert body["equation"]["code"] == "mifflin_st_jeor"
    assert body["equation"]["rule_key"] == "nutrition/default-rmr-equation-mifflin-st-jeor"
    assert body["engine"]["sha"]
    # cada número lleva sus reglas
    rules = body["rules"]
    assert set(rules) == {"kcal", "protein_g", "fat_g", "fibre_g"}
    assert "nutrition/default-rmr-equation-mifflin-st-jeor" in {r["key"] for r in rules["kcal"]}
    assert "nutrition/activity-multipliers-pal" in {r["key"] for r in rules["kcal"]}
    assert {r["key"] for r in rules["fat_g"]} == {"nutrition/minimum-dietary-fat"}
    assert {r["key"] for r in rules["fibre_g"]} == {"nutrition/dietary-fibre"}
    assert {r["key"] for r in rules["protein_g"]} == {"nutrition/daily-protein-target-for-people-who-lift"}
    assert body["weight"] == {"kg": 70.0, "date": "2026-10-20", "stale_days": 9}


def test_rules_carry_grade_and_title_once_knowledge_is_loaded(real_knowledge):
    body = get(make_user()).data
    by_key = {r["key"]: r for r in body["rules"]["kcal"]}
    pal = by_key["nutrition/activity-multipliers-pal"]
    assert pal["grade"] == KnowledgeRule.objects.get(key=pal["key"]).grade
    assert pal["title"] == "Activity multipliers (PAL)"


def test_fat_loss_is_500_below_maintenance_and_macros_use_the_deficit_protein():
    user = make_user(profile={"goal": "fat_loss", "activity_level": "desk"})
    body = get(user).data
    _, _, target, m = engine_numbers(user)
    assert body["deficit_kcal"] == 500 == target.deficit
    assert body["kcal"] == round(target.maintenance) - 500
    assert body["macros"]["protein_g_per_kg"] == m.protein_g_per_kg == 2.0  # midpoint of 1.8-2.2
    assert {r["key"] for r in body["rules"]["protein_g"]} == {"nutrition/protein-during-fat-loss"}
    assert "nutrition/deficit-size-when-keeping-or-building-muscle" in {r["key"] for r in body["rules"]["kcal"]}


def test_muscle_gain_has_a_surplus_with_its_rule():
    body = get(make_user(profile={"goal": "muscle_gain", "activity_level": "desk"})).data
    assert body["deficit_kcal"] < 0
    assert "nutrition/surplus-size-for-muscle-gain" in {r["key"] for r in body["rules"]["kcal"]}


# --- Aceptación: con no_deficit el objetivo nunca baja del mantenimiento -------------------

NO_DEFICIT_CASES = {
    "scoff_positive": dict(screening={"scoff_yes_count": 2}),
    "scoff_warning_sign": dict(screening={"scoff_yes_count": 1, "scoff_positive": True}),
    "glp1": dict(profile={"medications": ["glp1"]}),
    "pregnancy": dict(profile={"conditions": ["pregnant"], "gender": "FEMALE"}),
    "menstrual_absent": dict(profile={"gender": "FEMALE"}, screening={"menstrual": "absent"}),
    "menstrual_irregular_hold": dict(profile={"gender": "FEMALE"}, screening={"menstrual": "irregular_new"}),
    "older_adult": dict(profile={"date_of_birth": date(1955, 1, 1)}),
}


@pytest.mark.parametrize("case", NO_DEFICIT_CASES)
def test_a_blocked_deficit_never_goes_below_maintenance(case):
    kw = NO_DEFICIT_CASES[case]
    kw = {**kw, "profile": {"goal": "fat_loss", "activity_level": "desk", **kw.get("profile", {})}}
    body = get(make_user(**kw)).data
    assert body["goal"] == "fat_loss"
    assert body["kcal"] >= body["maintenance_kcal"]
    assert body["deficit_kcal"] <= 0
    assert body["in_deficit"] is False
    assert body["deficit_blocked"] is True
    # el motivo que lo bloquea sale con su regla y su texto
    assert any(r["severity"] in ("refer", "limit") and r["text"] for r in body["reasons"])


def test_deficit_blocked_is_false_when_nothing_blocks_it():
    assert get(make_user(profile={"goal": "fat_loss"})).data["deficit_blocked"] is False


def test_blocked_deficit_reasons_come_with_rule_text_and_severity():
    body = get(make_user(profile={"goal": "fat_loss"}, screening={"scoff_yes_count": 3}), lang="es").data
    reason = next(r for r in body["reasons"] if r["code"] == "eating_disorder_screen")
    assert reason["rule_key"] and reason["professional"] and reason["severity"] == "refer"
    assert "cribado positivo" in reason["text"]


# --- Puertas: 409 y bloqueo --------------------------------------------------------------


def test_without_equation_sex_there_are_no_calorie_targets():
    """P7: sin `equation_sex` (gender OTHER) → 409, y la UI explica que no hay objetivos."""
    user = make_user(profile={"gender": "OTHER"})
    resp = get(user)
    assert resp.status_code == 409
    assert resp.data == {"code": "profile_incomplete", "field": "equation_sex"}
    user.profile.equation_sex = "female"
    user.profile.save()
    assert get(user).status_code == 200


@pytest.mark.parametrize(
    ("kw", "field"),
    [
        (dict(weight=None), "weight_kg"),
        (dict(screened=False), "screening.scoff_yes_count"),
        (dict(profile={"goal": None}), "goal"),
        (dict(profile={"height_cm": None}), "height_cm"),
        (dict(profile={"date_of_birth": None}), "date_of_birth"),
        (dict(profile={"activity_level": None}), "activity_level"),
    ],
)
def test_missing_profile_data_is_a_409_with_the_field(kw, field):
    resp = get(make_user(**kw))
    assert resp.status_code == 409
    assert resp.data == {"code": "profile_incomplete", "field": field}


def test_under_18_gets_no_targets_at_all_but_an_explained_block():
    user = make_user(profile={"date_of_birth": date(2012, 1, 1), "goal": "fat_loss"})
    resp = get(user, lang="en")
    assert resp.status_code == 200
    body = resp.data
    assert body["blocked"] == {"code": "no_calorie_targets", "reason_code": "under_18"}
    assert body["kcal"] is None and body["macros"] is None and body["rules"] == {}
    assert [r["code"] for r in body["reasons"]] == ["under_18"]
    assert body["reasons"][0]["text"].startswith("under 18, out of scope")


# --- El suelo calórico se explica con su regla -------------------------------------------


def test_the_calorie_floor_is_explained_with_its_rule():
    user = make_user(
        profile={"goal": "fat_loss", "gender": "FEMALE", "height_cm": 150, "date_of_birth": date(1980, 1, 1),
                 "activity_level": "desk"},
        weight=42.0,
    )
    body = get(user, lang="es").data
    assert body["kcal"] == 1200 and body["clamped"] is True
    floor = next(r for r in body["reasons"] if r["code"] == "floor_raised")
    assert floor["rule_key"] == "nutrition/low-and-very-low-calorie-diets-need-clinical-supervision"
    assert "1200 kcal" in floor["text"] and floor["severity"] == "limit"
    assert floor["rule_key"] in {r["key"] for r in body["rules"]["kcal"]}


def test_reason_texts_follow_the_request_language():
    user = make_user(profile={"goal": "fat_loss"}, screening={"scoff_yes_count": 3})
    es = get(user, lang="es").data["reasons"]
    en = get(user, lang="en").data["reasons"]
    assert [r["code"] for r in es] == [r["code"] for r in en]
    assert es != en
    # sin pesajes que recalibrar (no_weight_targets), el motor dice que es una estimación
    recal = next(r for r in en if r["code"] == "recalibrate_equation")
    assert recal["text"] == "starting estimate from an equation"


# --- U04: ecuaciones de atletas ----------------------------------------------------------


def test_trained_athlete_with_a_reliable_body_fat_uses_cunningham_and_says_so():
    user = make_user(body_fat=14.0, body_fat_method="dxa")
    body = get(user, lang="es").data
    eq = body["equation"]
    assert eq["code"] == "cunningham"
    assert eq["rmr_kcal"] == pytest.approx(500 + 22 * 70 * 0.86, abs=1)
    assert eq["rule_key"] == "nutrition/trained-clients-cunningham-or-ten-haaf"
    assert eq["ffm_kg"] == pytest.approx(70 * 0.86, abs=0.1)
    msj = energy.rmr_mifflin(to_coach_profile(user, TODAY), TODAY)
    assert eq["rmr_kcal"] != pytest.approx(msj, abs=1)
    assert body["maintenance_kcal"] == round(eq["rmr_kcal"] * energy.pal(to_coach_profile(user, TODAY)))
    codes = {r["code"] for r in body["reasons"]}
    assert {"rmr_cunningham", "body_fat_error_carries"} <= codes
    assert {"nutrition/trained-clients-cunningham-or-ten-haaf",
            "nutrition/body-fat-measurement-error-carries-into-rmr"} <= {r["key"] for r in body["rules"]["kcal"]}


def test_trained_athlete_without_body_composition_uses_ten_haaf():
    body = get(make_user()).data
    assert body["equation"]["code"] == "ten_haaf"
    assert body["equation"]["ffm_kg"] is None
    assert "rmr_ten_haaf" in {r["code"] for r in body["reasons"]}


def test_a_smart_scale_body_fat_keeps_mifflin_and_explains_why():
    body = get(make_user(body_fat=14.0, body_fat_method="smart_scale")).data
    assert body["equation"]["code"] == "mifflin_st_jeor"
    unreliable = next(r for r in body["reasons"] if r["code"] == "body_fat_unreliable")
    assert unreliable["rule_key"] == "nutrition/body-fat-measurement-error-carries-into-rmr"


def test_athlete_equation_still_goes_through_the_engines_floor_and_blockers():
    """El RMR de atleta entra como `tdee_kcal`: los bloqueos de `calorie_target` siguen aplicándose."""
    user = make_user(profile={"goal": "fat_loss"}, screening={"scoff_yes_count": 3}, body_fat=14.0,
                     body_fat_method="dxa")
    body = get(user).data
    assert body["equation"]["code"] == "cunningham"
    assert body["deficit_kcal"] == 0 and body["kcal"] == body["maintenance_kcal"]


# --- U06: no_training calcula con el PAL de desk -----------------------------------------


def test_no_training_computes_with_the_desk_pal_as_a_fightlab_convention():
    user = make_user(profile={"activity_level": "active"}, screening={"cardiac_symptoms": True})
    body = get(user, lang="es").data
    p = to_coach_profile(user, TODAY)
    desk = energy.rmr_mifflin(p, TODAY) * 1.45  # banda 1.4-1.5 de `desk`, punto medio
    assert body["maintenance_kcal"] == round(desk)
    assert body["equation"]["code"] == "mifflin_st_jeor"  # no entrena: sin ecuación de atletas
    assert body["equation"]["pal"] == 1.45
    note = next(r for r in body["reasons"] if r["code"] == "no_training_desk_pal")
    assert note["rule_key"] is None and "convención de FightLab" in note["text"]
    assert any(r["code"] == "cardiac_symptoms" for r in body["reasons"])  # y el motivo que lo causa


def test_the_pal_differs_with_and_without_no_training():
    active = make_user(profile={"activity_level": "active"})
    blocked = make_user(profile={"activity_level": "active"}, screening={"cardiac_symptoms": True})
    assert get(active).data["equation"]["pal"] == 1.8  # banda 1.7-1.9 de `active`
    assert get(blocked).data["equation"]["pal"] == 1.45


# --- Las reglas que cita el puente existen en la base de evidencia -----------------------


def test_every_rule_the_targets_api_cites_exists(real_knowledge):
    from coaching.targets import CITED_RULES

    keys = set(KnowledgeRule.objects.values_list("key", flat=True))
    from coaching.keys import rule_key

    for literal in CITED_RULES:
        file, heading = literal.split(': "', 1)
        assert rule_key(file, heading.rstrip('"')) in keys, literal
