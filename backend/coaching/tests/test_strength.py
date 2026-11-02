"""Fuerza (Task 6.2): `set_records`, e1RM, series duras por músculo y progresión por ejercicio."""
from datetime import date, datetime, time, timedelta, timezone

import pytest
from coach import strength as coach_strength
from coach.safety import Pause, SafetyFlags

from activities.models import Activity, SetLog
from coaching.bridge import reason_texts
from coaching.bridge.adapters import SetRecord, set_records
from coaching.bridge.muscle_map import FIGHTLAB_ALIASES, muscle_map
from coaching.bridge.reasons import UNKNOWN, parse_reason

from .helpers import TODAY, client_for, make_user, today_fixed  # noqa: F401

pytestmark = pytest.mark.django_db


def log_session(user, day: date, exercises: list[tuple[str, list[tuple[float | None, int]]]], hour=18):
    activity = Activity.objects.create(
        profile=user.profile, kind="GYM", started_at=datetime.combine(day, time(hour), tzinfo=timezone.utc),
        duration_sec=3600, rpe=8,
    )
    for ei, (name, sets) in enumerate(exercises):
        for si, (kg, reps) in enumerate(sets):
            SetLog.objects.create(activity=activity, exercise=name, exercise_index=ei, set_index=si,
                                  weight_kg=kg, reps=reps)
    return activity


def bench(kg=60.0, reps=10, n=3):
    return ("Press banca", [(kg, reps)] * n)


# ---------------------------------------------------------------- adaptador y mapa


def test_set_records_uses_the_profile_timezone(today_fixed):
    user = make_user(profile={"timezone": "Pacific/Auckland"})
    log_session(user, date(2026, 10, 20), [bench()], hour=20)  # 20:00 UTC = día 21 en Auckland
    records = set_records(user)
    assert {r.date for r in records} == {date(2026, 10, 21)}
    assert records[0] == SetRecord("Press banca", date(2026, 10, 21), "normal", 60.0, 10, None, None)
    assert set_records(user, since=date(2026, 10, 22)) == []


def test_fightlab_aliases_point_at_existing_coach_entries():
    coach_map = coach_strength.load_muscle_map()
    for alias, key in FIGHTLAB_ALIASES.items():
        assert key in coach_map, key
        assert coach_strength.lookup(alias, muscle_map()) is coach_strength.lookup(alias, muscle_map())
        assert coach_strength.lookup(alias, muscle_map())["muscles"] == coach_map[key]["muscles"]
    # El mapa del coach no cambia (se copia).
    assert "curl bíceps" not in coach_map["bicep curl"].get("aliases", [])


# ---------------------------------------------------------------- motivos es/en


def _strength_reasons() -> list[str]:
    day = date(2026, 10, 1)

    def s(d, kg, reps, rir=None, name="Bench Press"):
        return SetRecord(name, d, "normal", kg, reps, rir, None)

    texts = []
    texts += coach_strength.progression([s(day, 60, 10)], today=day + timedelta(days=10)).reasons  # restart
    texts += coach_strength.progression([s(day, 60, 10)], today=day + timedelta(days=30)).reasons
    texts += coach_strength.progression([s(day, 60, 10, rir=6)], today=day).reasons  # too_easy
    texts += coach_strength.progression([s(day, 60, 13)], today=day).reasons  # increase upper
    texts += coach_strength.progression([s(day, 100, 13, name="Squat")], today=day).reasons  # lower
    texts += coach_strength.progression([s(day, None, 13, name="Pull Up")], today=day).reasons  # bodyweight
    texts += coach_strength.progression([s(day, 60, 10)], today=day).reasons  # add_reps
    stalled = [s(day + timedelta(days=2 * i), 60, 10) for i in range(5)]
    texts += coach_strength.progression(stalled, today=day + timedelta(days=8)).reasons
    texts += coach_strength.progression(
        [s(day, 60, 10)], today=day, flags=SafetyFlags(hold_progression=True)
    ).reasons
    texts += coach_strength.deload({"performance_stall", "joint_aches"}).reasons
    return texts


def test_every_strength_reason_has_both_languages():
    texts = _strength_reasons()
    codes = set()
    for text in texts:
        reason = parse_reason(text)
        assert reason.code != UNKNOWN, text
        codes.add(reason.code)
        body = text.split('": ', 1)[1] if '": ' in text else text
        assert reason_texts.render(reason, "en") == body, text
        es = reason_texts.render(reason, "es")
        assert es and es != body, text
    assert codes >= {
        "strength_restart", "strength_too_easy", "strength_increase_load", "strength_increase_bodyweight",
        "strength_add_reps", "strength_stalled", "strength_hold", "strength_deload",
    }


def test_spanish_step_uses_decimal_comma():
    reason = parse_reason(
        'strength-hypertrophy.md: "Double progression": every work set beat 12 reps, add 2.5% or the '
        "smallest practical jump"
    )
    assert "2,5 %" in reason_texts.render(reason, "es")


# ---------------------------------------------------------------- API


def test_e1rm_endpoint(today_fixed):
    user = make_user()
    log_session(user, TODAY - timedelta(days=7), [bench(60, 10)])
    log_session(user, TODAY - timedelta(days=3), [bench(62.5, 10), ("Dominadas", [(None, 8)])])
    data = client_for(user).get("/api/v1/coach/strength/e1rm").json()
    by_name = {e["exercise"]: e for e in data["exercises"]}
    assert set(by_name) == {"Press banca"}  # el peso corporal no tiene e1RM
    assert [p["e1rm_kg"] for p in by_name["Press banca"]["points"]] == [
        round(coach_strength.e1rm(60, 10), 2), round(coach_strength.e1rm(62.5, 10), 2)
    ]
    assert data["convention"] == "coach" and data["rules"] == []


def test_sets_endpoint_counts_hard_sets_and_warns_unmapped(today_fixed, real_knowledge):
    user = make_user()
    log_session(user, TODAY - timedelta(days=2), [bench(), ("Fondos", [(None, 10)] * 3), ("Curl bíceps", [(12, 10)] * 2)])
    log_session(user, TODAY - timedelta(days=20), [bench()])  # fuera de la semana
    data = client_for(user).get("/api/v1/coach/strength/sets").json()
    assert data["week"] == {"start": (TODAY - timedelta(days=8)).isoformat(), "end": (TODAY - timedelta(days=2)).isoformat()}
    assert data["sets"]["chest"] == 3
    assert data["sets"]["biceps"] == 2  # "Curl bíceps": alias de FightLab
    assert data["unmapped"] == ["Fondos"]
    assert data["reference_sets_per_week"] == coach_strength.WEEKLY_SETS_REFERENCE
    assert [r["grade"] for r in data["rules"]] == ["strong", "moderate"]


def test_sets_endpoint_rejects_a_bad_date(today_fixed):
    resp = client_for(make_user()).get("/api/v1/coach/strength/sets?week_ending=ayer")
    assert resp.status_code == 400


def _progress(user):
    return {e["exercise"]: e for e in client_for(user).get("/api/v1/coach/strength/progress").json()["exercises"]}


def test_progress_add_reps_with_its_rule(today_fixed, real_knowledge):
    user = make_user()
    log_session(user, TODAY - timedelta(days=2), [bench(60, 10)])
    item = _progress(user)["Press banca"]
    assert item["action"] == "add_reps" and item["load_kg"] == 60
    assert item["rule_key"] == "strength-hypertrophy/double-progression"
    assert item["reasons"][0]["code"] == "strength_add_reps"


def test_paused_exercise_never_progresses(today_fixed):
    injury = {"area": "hombro", "status": "active", "professional": "fisio", "exercises": ["Press banca"],
              "since": date(2026, 10, 1)}
    user = make_user(injuries=[injury])
    log_session(user, TODAY - timedelta(days=2), [bench(60, 13)])  # sin la pausa subiría carga
    item = _progress(user)["Press banca"]
    assert item["action"] == "paused" and item["load_kg"] == 60
    assert item["reasons"][0]["code"] == "injury_managed"


def test_unassessed_injury_gets_no_load(today_fixed):
    injury = {"area": "hombro", "status": "active", "exercises": ["press banca"]}
    user = make_user(injuries=[injury])
    log_session(user, TODAY - timedelta(days=2), [bench(60, 13)])
    item = _progress(user)["Press banca"]
    assert item["action"] == "paused" and item["load_kg"] is None


def test_hold_progression_keeps_the_load(today_fixed):
    user = make_user(screening={"bp_systolic": 165, "bp_diastolic": 80})
    log_session(user, TODAY - timedelta(days=2), [bench(60, 13)])
    item = _progress(user)["Press banca"]
    assert item["action"] == "hold" and item["load_kg"] == 60
    assert item["reasons"][0]["code"] == "strength_hold"


def test_no_training_prescribes_nothing(today_fixed):
    user = make_user(screening={"bp_systolic": 185, "bp_diastolic": 80})
    log_session(user, TODAY - timedelta(days=2), [bench(60, 10)])
    data = client_for(user).get("/api/v1/coach/strength/progress").json()
    assert data["no_training"] is True
    assert {e["action"] for e in data["exercises"]} == {"no_training"}
    assert all(e["load_kg"] is None for e in data["exercises"])


def test_strength_endpoints_need_auth(client):
    for path in ("e1rm", "sets", "progress"):
        assert client.get(f"/api/v1/coach/strength/{path}").status_code == 401


def test_pause_helper_matches_fightlab_aliases():
    pause = Pause(["x"], assessed=True)
    assert coach_strength.find_pause("Press con mancuernas", {"bench press": pause}, muscle_map()) is not None
