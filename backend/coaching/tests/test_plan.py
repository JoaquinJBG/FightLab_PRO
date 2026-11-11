"""Plan de la semana (Tasks 6.3 y 6.4): generador por reglas, bloqueos y aplicar.

Aceptación del plan: los ejercicios en pausa no progresan; con `no_training` no se genera plan;
cada línea del plan lleva su regla. Y el LLM no cambia números: el plan guardado es el mismo con
y sin texto.
"""
from datetime import datetime, time, timedelta, timezone
from unittest import mock

import pytest
from django.test import override_settings

from activities.models import Activity
from coaching import plan as plans
from coaching import plan_narrative, rules
from coaching.models import HeadImpact, WeeklyPlan

from .helpers import TODAY, client_for, make_user, today_fixed  # noqa: F401
from .test_strength import bench, log_session

pytestmark = pytest.mark.django_db

PLAN = "/api/v1/coach/plan"
VIGOROUS_WORK = {"sparring_hard", "competition", "hiit", "sprints", "jump_rope", "plyometrics", "one_rm_test",
                 "near_maximal_lift"}
STORED = ("week_start", "status", "target_kcal", "in_deficit", "training_schedule", "sessions", "cardio",
          "nutrition", "safety_reasons", "rules_used", "engine_sha")


def generate(user, **body):
    return client_for(user).post(PLAN, body, format="json")


def offered_keys(plan: dict) -> set[str]:
    """Todo lo que el plan propone hacer (no lo que excluye)."""
    keys = {o["key"] for o in plan["cardio"]["options"]}
    for entry in plan["training_schedule"]:
        keys |= {w["key"] for w in entry.get("allowed", [])}
    return keys


def lines(plan: dict):
    """Cada línea del plan: ejercicios, días, trabajo de MMA, cardio y nutrición."""
    for session in plan["sessions"]:
        yield from session["items"]
        yield session["effort"]
    for entry in plan["training_schedule"]:
        if entry["kind"] == "mma":
            yield from entry["allowed"]
            yield from entry["excluded"]
        else:
            yield entry
    yield plan["cardio"]
    yield from plan["cardio"]["options"]
    yield from plan["cardio"]["excluded"]


def mma(user, day, minutes=60):
    Activity.objects.create(profile=user.profile, kind="MMA", duration_sec=minutes * 60, rpe=7,
                            started_at=datetime.combine(day, time(19), tzinfo=timezone.utc))


# ---------------------------------------------------------------- generador


def test_default_plan_without_logs(today_fixed, real_knowledge):
    user = make_user()
    resp = generate(user, gym_days=["mon", "thu"])
    assert resp.status_code == 201, resp.json()
    plan = resp.json()
    gym = [e for e in plan["training_schedule"] if e["kind"] == "gym"]
    assert [(e["day"], e["session"]) for e in gym] == [("mon", "A"), ("thu", "B")]
    for session in plan["sessions"]:
        assert [i["pattern"] for i in session["items"]] == ["legs", "push", "pull"]
        for item in session["items"]:
            # Sin registros no hay carga inventada: la regla de las repeticiones en reserva.
            assert item["load_kg"] is None and item["action"] == "no_data"
            assert item["rule_key"] == "strength-hypertrophy/target-reps-in-reserve"
            assert item["rep_range"] == [8, 12] and item["sets"] == plans.SETS_WITHOUT_LOG
    assert plan["sessions"][0]["items"][0]["exercise"] != plan["sessions"][1]["items"][0]["exercise"]
    # Cardio: 150 min moderados repartidos en los 5 días libres.
    cardio = plan["cardio"]
    assert cardio["days"] == ["tue", "wed", "fri", "sat", "sun"] and cardio["minutes_per_day"] == 30
    assert cardio["zone"]["rpe"]
    # Nutrición del motor, tal cual.
    targets = client_for(user).get("/api/v1/coach/targets").json()
    assert plan["target_kcal"] == targets["kcal"] and plan["nutrition"]["macros"] == targets["macros"]
    assert {r["key"] for r in plan["rules"]} >= {"cardio-health/weekly-baseline-dose",
                                                 "strength-hypertrophy/full-body-versus-split"}
    assert all(r["grade"] for r in plan["rules"]), [r for r in plan["rules"] if not r["grade"]]


def test_every_line_has_its_rule(today_fixed):
    user = make_user(screening={"parq_any_yes": True})
    log_session(user, TODAY - timedelta(days=3), [bench(60, 10), ("Sentadilla", [(80, 8)] * 3)])
    mma(user, TODAY - timedelta(days=2))
    mma(user, TODAY - timedelta(days=9))
    plan = generate(user).json()
    for line in lines(plan):
        assert line.get("rule_key") or line.get("convention") in ("coach", "fightlab"), line


def test_too_few_gym_days_is_refused(today_fixed):
    resp = generate(make_user(), gym_days=["mon"])
    assert resp.status_code == 400 and resp.json()["code"] == "too_few_gym_days"


def test_review_before_vigorous_keeps_vigorous_work_out(today_fixed):
    user = make_user(screening={"parq_any_yes": True})  # PAR-Q+ con algún SÍ, sin revisión
    mma(user, TODAY - timedelta(days=2))
    mma(user, TODAY - timedelta(days=9))
    plan = generate(user).json()
    assert offered_keys(plan) & VIGOROUS_WORK == set()
    assert offered_keys(plan) >= {"walking_brisk", "technical_drilling"}
    excluded = {w["key"] for e in plan["training_schedule"] for w in e.get("excluded", [])}
    assert "sparring_hard" in excluded
    # Ni tests de 1RM ni cargas casi máximas: rangos de 8 repeticiones o más.
    assert all(i["rep_range"][0] >= 8 for s in plan["sessions"] for i in s["items"])


def test_no_all_out_sprints_means_no_sit_or_rehit(today_fixed):
    # Revisado el trabajo vigoroso, pero con un SÍ en el PAR-Q+: HIIT sí, SIT y REHIT no.
    user = make_user(screening={"parq_any_yes": True, "vigorous_reviewed": True})
    plan = generate(user).json()
    assert "hiit" in offered_keys(plan)
    assert offered_keys(plan) & {"sit", "rehit", "sprints"} == set()
    blocked = {o["key"]: o["blocked_by"] for o in plan["cardio"]["excluded"]}
    assert "no_all_out_sprints" in blocked["sit"] and "no_all_out_sprints" in blocked["rehit"]


def test_all_out_sprints_are_never_offered_on_their_own(today_fixed):
    plan = generate(make_user()).json()
    assert offered_keys(plan) & {"sit", "rehit", "sprints"} == set()
    assert {o["key"]: o["blocked_by"] for o in plan["cardio"]["excluded"]}["sit"] == ["prerequisites"]


def test_no_training_generates_no_plan(today_fixed):
    user = make_user(screening={"bp_systolic": 185, "bp_diastolic": 80})
    resp = generate(user)
    assert resp.status_code == 409
    assert resp.json()["code"] == "no_training" and resp.json()["reasons"]
    assert not WeeklyPlan.objects.exists()
    state = client_for(user).get(PLAN).json()
    assert state["blocked"]["code"] == "no_training" and state["defaults"] is None


def test_unscreened_profile_is_incomplete(today_fixed):
    resp = generate(make_user(screened=False))
    assert resp.status_code == 409 and resp.json()["code"] == "profile_incomplete"


def test_paused_exercise_does_not_progress(today_fixed):
    injury = {"area": "rodilla", "status": "active", "professional": "fisio", "exercises": ["Sentadilla"]}
    user = make_user(injuries=[injury])
    log_session(user, TODAY - timedelta(days=3), [("Sentadilla", [(80, 13)] * 3)])  # subiría carga
    plan = generate(user, gym_days=["mon", "thu"]).json()
    squat = [i for s in plan["sessions"] for i in s["items"] if i["exercise"] == "Sentadilla"]
    assert squat and all(i["action"] == "paused" and i["load_kg"] == 80 for i in squat)
    assert all(i["sets"] <= 3 for i in squat)
    assert squat[0]["reasons"][0]["code"] == "injury_managed"


def test_unassessed_injury_swaps_the_lift(today_fixed):
    injury = {"area": "rodilla", "status": "active", "exercises": ["Sentadilla"]}
    user = make_user(injuries=[injury])
    plan = generate(user, gym_days=["mon", "thu"]).json()
    legs = [s["items"][0] for s in plan["sessions"]]
    assert all(i["exercise"] != "Sentadilla" for i in legs)
    swapped = [i for i in legs if i["swapped_from"] == "Sentadilla"]
    assert swapped and swapped[0]["reasons"][0]["code"] == "injury_unassessed"


def test_logged_lifts_use_their_names_and_engine_loads(today_fixed):
    user = make_user()
    log_session(user, TODAY - timedelta(days=3), [bench(60, 10)])
    plan = generate(user, gym_days=["mon", "thu"]).json()
    push = plan["sessions"][0]["items"][1]
    assert push["exercise"] == "Press banca"
    assert push["action"] == "add_reps" and push["load_kg"] == 60 and push["sets"] == 3
    assert push["sets_basis"] == "log"
    assert push["rule_key"] == "strength-hypertrophy/double-progression"


def test_rotation_continues_from_the_last_session_done(today_fixed):
    user = make_user()
    act = log_session(user, TODAY - timedelta(days=1), [bench()])
    act.detail = {"plan_session": "A"}
    act.save()
    plan = generate(user, gym_days=["tue", "fri"]).json()
    assert [e["session"] for e in plan["training_schedule"] if e["kind"] == "gym"] == ["B", "A"]
    assert "recovery-habits/how-long-habits-take" in {r["key"] for r in plan["rules"]}


def test_mma_sessions_keep_their_days(today_fixed):
    user = make_user()
    tue = TODAY - timedelta(days=(TODAY.weekday() - 1) % 7)  # el último martes
    mma(user, tue)
    mma(user, tue - timedelta(days=7))
    state = client_for(user).get(PLAN).json()
    assert state["defaults"]["mma_days"] == ["tue"]
    assert "tue" not in state["defaults"]["gym_days"]
    plan = generate(user).json()
    days = {e["day"]: e["kind"] for e in plan["training_schedule"]}
    assert days["tue"] == "mma"
    tue_entry = next(e for e in plan["training_schedule"] if e["kind"] == "mma")
    assert "sparring_hard" in {w["key"] for w in tue_entry["allowed"]}
    # 2 sesiones de 60 min en 4 semanas = 30 min a la semana que cuentan como cardio moderado.
    assert plan["cardio"]["mma_minutes"] == 30 and plan["cardio"]["minutes_needed"] == 120
    assert plan["cardio"]["mma_convention"] == "fightlab"


@pytest.mark.parametrize(
    "needed,days,expected",
    [
        (10, ["mon", "wed", "sat"], (["mon"], 20)),  # la demo: 140 min de MMA, faltaban 10 → 3 × 5 min
        (20, ["mon", "wed", "sat"], (["mon"], 20)),
        (45, ["mon", "wed", "sat"], (["mon", "wed"], 25)),
        (120, ["mon", "wed", "sat"], (["mon", "wed", "sat"], 40)),
        (150, ["tue", "fri"], (["tue", "fri"], 75)),
        (26, ["mon", "tue", "wed", "thu", "fri"], (["mon"], 30)),
        (0, ["mon", "wed"], ([], 0)),
        (30, [], ([], 0)),
    ],
)
def test_cardio_split_never_proposes_sessions_under_the_minimum(needed, days, expected):
    """F9: «Cardio moderado · 5 min» salía del generador, que repartía lo que faltaba hasta 150
    entre todos los días de cardio. Ahora ninguna sesión baja de 20 min y lo que falta se junta."""
    chosen, per_day = plans.cardio_split(needed, days)
    assert (chosen, per_day) == expected
    if chosen:
        assert per_day >= plans.CARDIO_MIN_SESSION and per_day * len(chosen) >= needed


def test_mma_almost_covering_the_minimum_gives_one_short_session_not_three(today_fixed):
    user = make_user()
    for weeks in range(4):  # 2 sesiones de 70 min por semana = 140 min: faltan 10
        for offset in (1, 3):
            mma(user, TODAY - timedelta(days=offset + 7 * weeks), minutes=70)
    plan = generate(user, gym_days=["mon", "thu"], mma_days=["tue"], cardio_days=["wed", "fri", "sat"]).json()
    cardio = [e for e in plan["training_schedule"] if e["kind"] == "cardio"]
    assert plan["cardio"]["minutes_needed"] == 10
    assert [(e["day"], e["minutes"]) for e in cardio] == [("wed", 20)]
    assert plan["cardio"]["min_session"] == 20 and plan["cardio"]["min_session_convention"] == "fightlab"


def test_no_contact_takes_contact_work_out_of_mma_days(today_fixed):
    user = make_user()
    HeadImpact.objects.create(profile=user.profile, occurred_on=TODAY - timedelta(days=1), symptoms=True)
    plan = generate(user, mma_days=["wed"]).json()
    entry = next(e for e in plan["training_schedule"] if e["kind"] == "mma")
    assert {w["key"] for w in entry["allowed"]} & {"sparring_hard", "sparring_light", "rolling_flow"} == set()
    assert any(w["blocked_by"] == ["no_contact"] for w in entry["excluded"])


# ---------------------------------------------------------------- LLM


def test_saved_plan_is_the_same_with_and_without_llm(today_fixed):
    user = make_user()
    log_session(user, TODAY - timedelta(days=3), [bench(60, 10)])
    request = plans.PlanRequest(gym_days=["mon", "thu"])
    without = plans.generate(user, TODAY, request, "es", narrate=None)
    snapshot = {f: getattr(without, f) for f in STORED}

    def fake(plan_data, lang):
        return "Semana con 2 sesiones de cuerpo completo y 60 kg en press banca."

    with_llm = plans.generate(user, TODAY, request, "es", narrate=fake)
    assert with_llm.narrative.startswith("Semana")
    assert {f: getattr(with_llm, f) for f in STORED} == snapshot
    assert without.narrative == ""


def test_narrative_with_numbers_not_in_the_plan_is_dropped():
    plan = {"cardio": {"minutes_per_day": 30}, "sessions": [{"items": [{"load_kg": 62.5, "rep_range": [8, 12]}]}]}
    assert plan_narrative.numbers_ok("30 minutos, 62,5 kg, de 8 a 12", plan)
    assert not plan_narrative.numbers_ok("sube a 65 kg", plan)


@override_settings(ANTHROPIC_API_KEY="")
def test_no_api_key_means_no_llm_call():
    with mock.patch("ai.services._client") as client:
        assert plan_narrative.write_narrative({"x": 1}, "es") == ""
    client.assert_not_called()


@override_settings(ANTHROPIC_API_KEY="test-key")
def test_llm_text_with_foreign_numbers_is_discarded():
    reply = mock.Mock(content=[mock.Mock(text="Levanta 999 kg")])
    with mock.patch("ai.services._client") as client:
        client.return_value.messages.create.return_value = reply
        assert plan_narrative.write_narrative({"load_kg": 60}, "es") == ""
        reply.content = [mock.Mock(text="Mantén 60 kg")]
        assert plan_narrative.write_narrative({"load_kg": 60}, "es") == "Mantén 60 kg"


# ---------------------------------------------------------------- aplicar


def test_apply_moves_the_plan_to_my_routine(today_fixed):
    user = make_user()
    client = client_for(user)
    first = client.post(PLAN, {"gym_days": ["mon", "thu"]}, format="json").json()
    assert client.get(PLAN).json()["draft"]["id"] == first["id"]
    applied = client.post(f"{PLAN}/{first['id']}/apply").json()
    assert applied["status"] == "active" and applied["applied_at"]
    second = client.post(PLAN, {"gym_days": ["tue", "fri"]}, format="json").json()
    client.post(f"{PLAN}/{second['id']}/apply")
    state = client.get(PLAN).json()
    assert state["active"]["id"] == second["id"] and state["draft"] is None
    assert WeeklyPlan.objects.get(pk=first["id"]).status == "superseded"
    assert client.post(f"{PLAN}/{first['id']}/apply").status_code == 409


def test_apply_is_refused_once_no_training_fires(today_fixed):
    from coaching.services import screening_set

    user = make_user()
    client = client_for(user)
    draft = client.post(PLAN, {}, format="json").json()
    screening_set(user.profile, "bp_systolic", 185, origin="checkin")
    resp = client.post(f"{PLAN}/{draft['id']}/apply")
    assert resp.status_code == 409 and resp.json()["code"] == "no_training"


def test_plans_are_private(today_fixed):
    owner, other = make_user(), make_user()
    draft = client_for(owner).post(PLAN, {}, format="json").json()
    assert client_for(other).post(f"{PLAN}/{draft['id']}/apply").status_code == 404


def test_modalities_in_plan_match_the_table(today_fixed):
    plan = generate(make_user()).json()
    for item in plan["cardio"]["options"] + plan["cardio"]["excluded"]:
        assert item["intensity"] == rules.MODALITY_INTENSITY[item["key"]].intensity
