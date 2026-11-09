"""Revisión semanal (Tasks 7.1-7.4): adherencia, tendencia, recalibración, descarga, aceptar y
evidencia antigua.

Aceptación: el cambio calórico solo se propone fuera del rango del objetivo y lo calcula el motor,
de escalón en escalón; con `no_weight_targets` no sale nada de peso ni de kcal; con `no_deficit` o
`hold_deficit` nunca se propone un déficit; aceptar genera un `WeeklyPlan` nuevo y el TDEE
aceptado lo usa `coach/targets`; la evidencia antigua solo la ve el admin; y los números son los
mismos con y sin LLM.
"""
from datetime import date, datetime, time, timedelta, timezone
from unittest import mock

import pytest
from coach import energy, safety
from coach import strength as coach_strength
from coach import trend as coach_trend
from django.test import override_settings
from rest_framework.test import APIClient

from activities.models import Activity
from coaching import plan as plans
from coaching import review as reviews
from coaching import review_narrative
from coaching.bridge.adapters import to_coach_profile
from coaching.models import DailyCheckin, KnowledgeRule, WeeklyPlan, WeeklyReview
from coaching.targets import _key
from profiles.models import BiometricsLog

from .helpers import TODAY, client_for, make_user, today_fixed  # noqa: F401
from .test_strength import bench, log_session

pytestmark = pytest.mark.django_db

URL = "/api/v1/coach/review"
TARGETS = "/api/v1/coach/targets"
STORED = ("week_end", "goal", "adherence", "trend", "recalibrated_tdee", "current_kcal", "calories", "training",
          "signs", "deload", "proposals", "safety_reasons", "rules_used", "engine_sha")


def weigh_daily(user, days=28, start_kg=72.0, per_day=-0.02, end=TODAY):
    """Un pesaje diario durante `days` días hasta `end`."""
    for i in range(days):
        day = end - timedelta(days=days - 1 - i)
        BiometricsLog.objects.create(
            profile=user.profile, weight_kg=round(start_kg + per_day * i, 3),
            timestamp=datetime.combine(day, time(8), tzinfo=timezone.utc),
        )


def log_intake(user, days=28, kcal=2000, end=TODAY):
    for i in range(days):
        DailyCheckin.objects.create(profile=user.profile, date=end - timedelta(days=i), intake_kcal=kcal)


def athlete(goal="fat_loss", **kwargs):
    return make_user(profile={"goal": goal, **kwargs.pop("profile", {})}, weight=None, **kwargs)


def run(user, **body):
    return client_for(user).post(URL, body, format="json")


def numbers_in(value) -> list:
    if isinstance(value, bool) or value is None:
        return []
    if isinstance(value, (int, float)):
        return [value]
    if isinstance(value, dict):
        return [n for v in value.values() for n in numbers_in(v)]
    if isinstance(value, list):
        return [n for v in value for n in numbers_in(v)]
    return []


# ---------------------------------------------------------------- API básica


def test_requires_auth():
    assert APIClient().get(URL).status_code == 401
    assert APIClient().post(URL, {}, format="json").status_code == 401


def test_signs_are_the_engine_ones():
    assert set(reviews.SIGNS) == coach_strength.DELOAD_SIGNS | coach_strength.OVERREACHING_SIGNS
    assert len(reviews.SIGNS) == 6


def test_get_returns_defaults_and_no_stale_for_the_athlete(today_fixed):
    user = athlete()
    body = client_for(user).get(URL).json()
    assert body["week_end"] == TODAY.isoformat() and body["latest"] is None
    assert body["signs"] == list(reviews.SIGNS)
    assert "stale" not in body


def test_rules_used_exist_in_the_knowledge(real_knowledge):
    keys = {_key(rule) for rule, _ in reviews.RATE_RULES.values()} | {_key(r) for r in reviews.ALWAYS_RULES}
    keys.add(_key(coach_strength.DELOADS))
    assert keys <= set(KnowledgeRule.objects.values_list("key", flat=True))


def test_unscreened_profile_is_incomplete(today_fixed):
    user = make_user(screened=False)
    resp = run(user)
    assert resp.status_code == 409 and resp.json()["field"] == "screening.scoff_yes_count"


def test_future_or_invalid_input_is_refused(today_fixed):
    user = athlete()
    assert run(user, week_end=(TODAY + timedelta(days=1)).isoformat()).json()["code"] == "week_end_future"
    assert run(user, week_end=(TODAY - timedelta(days=90)).isoformat()).json()["code"] == "week_end_too_old"
    assert run(user, signs=["tired"]).status_code == 400


# ---------------------------------------------------------------- peso y calorías (7.1)


def test_slow_loss_proposes_a_one_step_cut_from_the_engine(today_fixed):
    user = athlete()
    weigh_daily(user, per_day=-0.02)  # unos -0,2 %/semana: fuera de 0,5-1 %
    log_intake(user, kcal=2000)
    resp = run(user)
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["trend"]["status"] == "ok" and body["trend"]["can_recalibrate"]
    cal = body["calories"]
    assert cal["status"] == "out_of_range" and cal["in_range"] is False
    assert cal["range_pct"] == [-1.0, -0.5] and cal["rate_rule_key"] == "nutrition/rate-of-loss-for-lean-trained-clients"
    review = WeeklyReview.objects.get(pk=body["id"])
    # El TDEE es el del motor sobre los mismos pesajes e ingestas.
    points = [(d, kg) for d, kg in ((b.timestamp.date(), float(b.weight_kg)) for b in BiometricsLog.objects.filter(profile=user.profile))]
    expected_trend = coach_trend.weight_trend(points)
    assert review.recalibrated_tdee == pytest.approx(coach_trend.recalibrate_tdee(expected_trend, 2000))
    # La propuesta es la de `calorie_target(recalibrated=True)` desde el objetivo en vigor.
    (proposal,) = [p for p in body["proposals"] if p["kind"] == "calories"]
    profile = to_coach_profile(user, TODAY)
    target = energy.calorie_target(profile, safety.flags(profile, TODAY), today=TODAY, tdee_kcal=review.recalibrated_tdee,
                                   current_kcal=review.current_kcal, recalibrated=True)
    assert proposal["kcal"] == target.kcal
    assert proposal["change_kcal"] == -energy.RECALIBRATE_STEP_KCAL and proposal["stepped"]
    assert any(r["code"] == "recalibrate_step" for r in proposal["reasons"])


def test_rate_in_range_proposes_no_calorie_change(today_fixed):
    user = athlete()
    weigh_daily(user, per_day=-0.08)  # unos -0,8 %/semana
    log_intake(user)
    body = run(user).json()
    assert body["calories"]["status"] == "in_range"
    assert body["calories"]["tdee_kcal"] is not None
    assert not [p for p in body["proposals"] if p["kind"] == "calories"]


def test_maintenance_has_no_rate_rule_and_no_proposal(today_fixed):
    user = athlete(goal="maintenance")
    weigh_daily(user, per_day=-0.08)
    log_intake(user)
    body = run(user).json()
    assert body["calories"]["status"] == "no_rate_rule" and body["calories"]["range_pct"] is None
    assert body["proposals"] == []


def test_before_four_weeks_there_is_no_tdee(today_fixed):
    user = athlete()
    weigh_daily(user, days=20, per_day=-0.02)
    log_intake(user)
    cal = run(user).json()["calories"]
    assert cal["tdee_status"] == "wait" and cal["tdee_kcal"] is None and not cal["proposal"]


def test_without_logged_intake_there_is_no_tdee(today_fixed):
    user = athlete()
    weigh_daily(user, per_day=-0.02)
    cal = run(user).json()["calories"]
    assert cal["tdee_status"] == "no_intake" and not cal["proposal"]


def test_few_weigh_ins_say_insufficient(today_fixed):
    user = athlete()
    weigh_daily(user, days=3)
    body = run(user).json()
    assert body["trend"]["status"] == "insufficient_data"
    assert body["calories"]["status"] == "insufficient_data" and body["proposals"] == []


def test_no_weight_targets_shows_nothing_about_weight_or_kcal(today_fixed):
    user = athlete(screening={"scoff_yes_count": 2})  # no_deficit + no_weight_targets
    weigh_daily(user, per_day=-0.02)
    log_intake(user)
    body = run(user).json()
    assert body["trend"]["status"] == "disabled" and body["trend"]["blocked"]
    assert numbers_in({k: v for k, v in body["trend"].items() if k != "reasons"}) == []
    assert body["calories"]["status"] == "blocked"
    assert body["adherence"]["nutrition"] == {
        "blocked": True, "days_logged": 0, "mean_kcal": None, "target_kcal": None, "diff_kcal": None,
    }
    assert [p for p in body["proposals"] if p["kind"] == "calories"] == []
    review = WeeklyReview.objects.get(pk=body["id"])
    assert review.recalibrated_tdee is None and review.current_kcal is None
    assert "nutrition/recalibrate-tdee-from-the-weight-trend" not in review.rules_used


@pytest.mark.parametrize("screening", [{"menstrual": "absent"}, {"menstrual": "irregular_new"}],
                         ids=["no_deficit", "hold_deficit"])
@pytest.mark.parametrize("per_day", [-0.02, 0.05], ids=["slow_loss", "gaining"])
def test_no_deficit_flags_never_propose_a_deficit(today_fixed, screening, per_day):
    user = athlete(profile={"gender": "FEMALE"}, screening=screening)
    weigh_daily(user, start_kg=62, per_day=per_day)
    log_intake(user, kcal=1900)
    body = run(user).json()
    for proposal in body["proposals"]:
        if proposal["kind"] == "calories":
            assert not proposal["in_deficit"] and proposal["deficit_kcal"] <= 0


# ---------------------------------------------------------------- adherencia


def test_adherence_compares_the_plan_in_force_with_the_logs(today_fixed):
    user = athlete()
    plan = plans.generate(user, TODAY, plans.PlanRequest(gym_days=["mon", "thu"], mma_days=[], cardio_days=[]))
    plans.apply(user, plan, TODAY)
    log_session(user, date(2026, 10, 26), [bench()])  # lunes: hecho; el jueves no
    Activity.objects.create(profile=user.profile, kind="MMA", duration_sec=3600, rpe=7,
                            started_at=datetime.combine(date(2026, 10, 27), time(19), tzinfo=timezone.utc))
    adherence = run(user).json()["adherence"]
    assert adherence["plan_id"] == plan.id
    gym = [e for e in adherence["entries"] if e["kind"] == "gym"]
    assert [(e["day"], e["done"]) for e in gym] == [("mon", True), ("thu", False)]
    assert adherence["sessions"]["gym"] == {"planned": 2, "done": 1}
    assert adherence["sessions"]["mma"]["done"] == 1


def test_adherence_counters_and_list_follow_the_same_criterion(today_fixed):
    """F7 (prueba en móvil): «Gimnasio: 2 de 2» con los dos gimnasios «No registrada» porque se
    hicieron en días de cardio, «MMA: 3 de 2» sin las sesiones en la lista, y la lista sin ordenar."""
    user = athlete()
    plan = plans.generate(user, TODAY, plans.PlanRequest(gym_days=["mon", "thu"], mma_days=[], cardio_days=["tue", "fri"]))
    plans.apply(user, plan, TODAY)
    # La semana revisada va del viernes 23 al jueves 29. Gimnasio el viernes y el martes (días de
    # cardio) y dos MMA que el plan no tenía.
    log_session(user, date(2026, 10, 23), [bench()])
    log_session(user, date(2026, 10, 27), [bench()])
    for day in (date(2026, 10, 24), date(2026, 10, 25)):
        Activity.objects.create(profile=user.profile, kind="MMA", duration_sec=3600, rpe=7,
                                started_at=datetime.combine(day, time(12), tzinfo=timezone.utc))
    adherence = run(user).json()["adherence"]
    entries = adherence["entries"]
    assert [e["date"] for e in entries] == sorted(e["date"] for e in entries)  # en orden de fecha
    gym = [e for e in entries if e["kind"] == "gym"]
    assert [(e["date"], e["done"], e["done_date"]) for e in gym] == [
        ("2026-10-26", True, "2026-10-23"), ("2026-10-29", True, "2026-10-27"),
    ]
    assert adherence["sessions"]["gym"] == {"planned": 2, "done": 2}
    # Las MMA fuera del plan cuentan y se ven
    mma = [e for e in entries if e["kind"] == "mma"]
    assert [(e["date"], e["planned"], e["done"]) for e in mma] == [("2026-10-24", False, True), ("2026-10-25", False, True)]
    assert adherence["sessions"]["mma"] == {"planned": 0, "done": 2}
    # El cardio del plan no se hizo (el gimnasio de ese día no cuenta como cardio)
    assert [e["done"] for e in entries if e["kind"] == "cardio"] == [False, False]
    assert adherence["done_planned"] == 2 and adherence["planned_total"] == 4
    # Cada contador cuadra con la lista
    for kind, count in adherence["sessions"].items():
        assert count["done"] == sum(1 for e in entries if e["kind"] == kind and e["done"]), kind


def test_adherence_without_a_plan_counts_only_what_was_done(today_fixed):
    user = athlete()
    log_session(user, TODAY - timedelta(days=1), [bench()])
    adherence = run(user).json()["adherence"]
    assert adherence["plan_id"] is None and adherence["planned_total"] is None
    assert adherence["sessions"]["gym"] == {"planned": None, "done": 1}


def test_nutrition_adherence_uses_the_checkin_intake(today_fixed):
    user = make_user(profile={"goal": "fat_loss"})  # con peso: hay objetivo con el que comparar
    log_intake(user, days=4, kcal=2100)
    nutrition = run(user).json()["adherence"]["nutrition"]
    assert nutrition["days_logged"] == 4 and nutrition["mean_kcal"] == 2100
    assert nutrition["diff_kcal"] == 2100 - nutrition["target_kcal"]


# ---------------------------------------------------------------- descarga (7.2)


def test_two_signs_give_the_engine_deload(today_fixed):
    user = athlete()
    body = run(user, signs=["joint_aches", "poor_sleep"]).json()
    (proposal,) = [p for p in body["proposals"] if p["kind"] == "deload"]
    expected = coach_strength.deload({"joint_aches", "poor_sleep"})
    assert proposal["volume_cut"] == list(expected.volume_cut) and proposal["stop_rir"] == expected.stop_rir
    assert proposal["rule_key"] == "strength-hypertrophy/deloads"
    assert body["deload"]["status"] == "indicated"


def test_one_sign_is_not_a_deload_and_no_sign_skips_the_call(today_fixed):
    user = athlete()
    assert run(user, signs=["poor_sleep"]).json()["deload"]["status"] == "not_indicated"
    with mock.patch("coaching.review.coach_strength.deload") as call:
        assert run(user, signs=[]).json()["deload"]["status"] == "no_signs"
    call.assert_not_called()


def test_overreaching_adds_rest_days(today_fixed):
    user = athlete()
    (proposal,) = run(user, signs=["drop_despite_rest", "low_mood"]).json()["proposals"]
    assert proposal["extra_rest_days"] == list(coach_strength.OVERREACHING_REST_DAYS)


def test_a_stalled_lift_counts_as_a_performance_stall(today_fixed):
    user = athlete()
    for ago in (12, 8, 4, 1):
        log_session(user, TODAY - timedelta(days=ago), [bench(60, 10)])
    body = run(user, signs=["joint_aches"]).json()
    assert "Press banca" in body["training"]["stalled"]
    assert body["deload"]["signs_derived"] == ["performance_stall"]
    assert set(body["signs"]) == {"joint_aches", "performance_stall"}
    assert [p["kind"] for p in body["proposals"]] == ["deload"]


def test_no_training_gives_no_training_or_deload_advice(today_fixed):
    user = athlete(screening={"cardiac_symptoms": True})
    body = run(user, signs=["joint_aches", "poor_sleep"]).json()
    assert body["training"] is None and body["deload"]["status"] == "no_training"
    assert [p for p in body["proposals"] if p["kind"] == "deload"] == []
    assert any(r["code"] == "cardiac_symptoms" for r in body["safety_reasons"])


def test_deload_sets_stay_inside_the_engine_cut():
    low, high = coach_strength.DELOAD_VOLUME_CUT
    for sets in range(plans.MIN_SETS, plans.MAX_SETS + 1):
        cut = 1 - plans.deload_sets(sets, (low, high)) / sets
        assert low - 1e-9 <= cut <= high + 1e-9, sets


# ---------------------------------------------------------------- aceptar (7.3)


def _proposing_user():
    user = athlete()
    weigh_daily(user, per_day=-0.02)
    log_intake(user, kcal=2000)
    for ago in (12, 8, 4, 1):
        log_session(user, TODAY - timedelta(days=ago), [bench(60, 10)])
    return user


def test_accepting_generates_a_deload_plan_and_targets_use_the_tdee(today_fixed):
    user = _proposing_user()
    client = client_for(user)
    body = client.post(URL, {"signs": ["joint_aches"]}, format="json").json()
    assert {p["kind"] for p in body["proposals"]} == {"calories", "deload"}
    calories = next(p for p in body["proposals"] if p["kind"] == "calories")
    accepted = client.post(f"{URL}/{body['id']}/accept", {"accept": ["calories", "deload"]}, format="json")
    assert accepted.status_code == 200, accepted.json()
    out = accepted.json()
    assert out["status"] == "accepted" and out["accepted"] == ["calories", "deload"]
    assert out["target_kcal"] == calories["kcal"]

    plan = WeeklyPlan.objects.get(pk=out["plan_id"])
    assert plan.status == "draft" and plan.week_start.isoformat() == out["plan_week_start"]
    assert plan.target_kcal == calories["kcal"]  # la nutrición del plan nuevo sale de `targets`
    assert plan.deload["volume_cut"] == list(coach_strength.DELOAD_VOLUME_CUT)
    items = [i for s in plan.sessions for i in s["items"]]
    bench_item = next(i for i in items if i["exercise"] == "Press banca")
    assert bench_item["action"] == "deload" and bench_item["load_kg"] == 60.0  # la misma carga
    assert bench_item["sets"] == plans.deload_sets(3, coach_strength.DELOAD_VOLUME_CUT)
    assert all(s["effort"]["rir"] == [coach_strength.DELOAD_STOP_RIR] * 2 for s in plan.sessions)
    # El plan de la revisión aparece como borrador en `/coach/plan`.
    assert client.get("/api/v1/coach/plan").json()["draft"]["id"] == plan.id

    targets = client.get(TARGETS).json()
    review = WeeklyReview.objects.get(pk=out["id"])
    assert targets["maintenance_kcal"] == round(review.recalibrated_tdee)
    assert targets["kcal"] == calories["kcal"] and targets["recalibrated"]["held"]
    assert any(r["code"] == "recalibrate_from_trend" for r in targets["reasons"])
    # Volver a pedir los objetivos no baja otro escalón.
    assert client.get(TARGETS).json()["kcal"] == calories["kcal"]


def test_accepting_nothing_records_the_tdee_and_keeps_the_target(today_fixed):
    user = _proposing_user()
    client = client_for(user)
    before = client.get(TARGETS).json()["kcal"]
    body = client.post(URL, {}, format="json").json()
    out = client.post(f"{URL}/{body['id']}/accept", {"accept": []}, format="json").json()
    assert out["status"] == "accepted" and out["plan_id"] is None
    targets = client.get(TARGETS).json()
    assert targets["kcal"] == before
    assert targets["maintenance_kcal"] == round(WeeklyReview.objects.get(pk=out["id"]).recalibrated_tdee)


def test_a_new_goal_after_the_review_steps_from_the_held_target(today_fixed):
    user = _proposing_user()
    user.profile.goal = "maintenance"
    user.profile.save()
    client = client_for(user)
    body = client.post(URL, {}, format="json").json()
    client.post(f"{URL}/{body['id']}/accept", {"accept": []}, format="json")
    review = WeeklyReview.objects.get(pk=body["id"])
    user.profile.goal = "fat_loss"
    user.profile.save()
    targets = client.get(TARGETS).json()
    assert targets["kcal"] == max(round(review.recalibrated_tdee) - energy.DEFICIT_KCAL,
                                  review.current_kcal - energy.RECALIBRATE_STEP_KCAL)


def test_accept_is_refused_twice_for_old_reviews_and_unknown_kinds(today_fixed):
    user = athlete()
    client = client_for(user)
    first = client.post(URL, {"week_end": (TODAY - timedelta(days=7)).isoformat()}, format="json").json()
    second = client.post(URL, {"signs": ["joint_aches", "poor_sleep"]}, format="json").json()
    assert client.post(f"{URL}/{first['id']}/accept", {"accept": []}, format="json").json()["code"] == "superseded"
    assert client.post(f"{URL}/{second['id']}/accept", {"accept": ["calories"]}, format="json").status_code == 400
    assert client.post(f"{URL}/{second['id']}/accept", {"accept": ["deload"]}, format="json").status_code == 200
    again = client.post(f"{URL}/{second['id']}/accept", {"accept": ["deload"]}, format="json")
    assert again.status_code == 409 and again.json()["code"] == "already_accepted"


def test_reviews_are_private(today_fixed):
    owner, other = athlete(), athlete()
    body = run(owner).json()
    assert client_for(other).post(f"{URL}/{body['id']}/accept", {"accept": []}, format="json").status_code == 404
    assert client_for(other).get(URL).json()["latest"] is None


def test_pending_review_for_the_same_week_is_replaced(today_fixed):
    user = athlete()
    run(user)
    run(user, signs=["poor_sleep"])
    assert WeeklyReview.objects.filter(profile=user.profile).count() == 1


# ---------------------------------------------------------------- LLM


def test_saved_review_is_the_same_with_and_without_llm(today_fixed):
    user = _proposing_user()
    without = reviews.generate(user, TODAY, TODAY, {"joint_aches"}, "es", narrate=None)
    snapshot = {f: getattr(without, f) for f in STORED}

    def fake(data, lang):
        return "Semana revisada: el press banca está estancado."

    with_llm = reviews.generate(user, TODAY, TODAY, {"joint_aches"}, "es", narrate=fake)
    assert with_llm.narrative.startswith("Semana")
    assert {f: getattr(with_llm, f) for f in STORED} == snapshot
    assert without.narrative == ""


def test_review_narrative_without_api_key_calls_nothing():
    with override_settings(ANTHROPIC_API_KEY=""), mock.patch("ai.services._client") as client:
        assert review_narrative.write_review_narrative({"x": 1}, "es") == ""
    client.assert_not_called()


def test_review_narrative_with_foreign_numbers_is_discarded():
    fake = mock.Mock()
    fake.messages.create.return_value = mock.Mock(content=[mock.Mock(text="Baja a 1500 kcal")])
    with override_settings(ANTHROPIC_API_KEY="test"), mock.patch("ai.services._client", return_value=fake):
        assert review_narrative.write_review_narrative({"kcal": 2037}, "es") == ""
    fake.messages.create.return_value = mock.Mock(content=[mock.Mock(text="Objetivo de 2037 kcal")])
    with override_settings(ANTHROPIC_API_KEY="test"), mock.patch("ai.services._client", return_value=fake):
        assert review_narrative.write_review_narrative({"kcal": 2037}, "es") == "Objetivo de 2037 kcal"


# ---------------------------------------------------------------- evidencia antigua (7.4)


def test_stale_knowledge_is_only_for_the_admin(today_fixed):
    user = athlete()
    assert client_for(user).get("/api/v1/coach/knowledge/stale").status_code == 403
    type(user).objects.filter(pk=user.pk).update(is_staff=True)
    client = client_for(user)
    resp = client.get("/api/v1/coach/knowledge/stale")
    assert resp.status_code == 200 and resp.json()["months"] == reviews.STALE_MONTHS
    assert "stale" in client.get(URL).json()


def test_stale_files_lists_the_coach_and_annex_files_once_old():
    later = reviews.stale_knowledge(date(2030, 1, 1))
    origins = {f["origin"] for f in later["files"]}
    assert origins == {"upstream", "fightlab"}
    assert "dropped-claims.md" not in {f["file"] for f in later["files"]}
    assert all(f["checked"] for f in later["files"])
