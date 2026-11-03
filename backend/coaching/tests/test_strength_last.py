"""`GET /coach/strength/last`: "Última vez" y récords del gimnasio desde `SetLog`."""
from datetime import date

import pytest
from coach import strength as coach_strength

from activities.models import SetLog

from .helpers import client_for, make_user, today_fixed  # noqa: F401
from .test_strength import log_session

pytestmark = pytest.mark.django_db


def last(client, *names):
    response = client.get("/api/v1/coach/strength/last", {"exercise": list(names)})
    assert response.status_code == 200, response.data
    return response.data["exercises"]


def test_last_session_record_and_e1rm(today_fixed):
    user = make_user()
    log_session(user, date(2026, 10, 10), [("Press banca", [(90.0, 3), (80.0, 6)])])
    log_session(user, date(2026, 10, 20), [("Press banca", [(70.0, 8), (75.0, 6), (75.0, 5)])])
    data = last(client_for(user), "Press banca")["Press banca"]
    assert data["last"] == {"date": "2026-10-20", "sets": 3, "reps": 6, "weight_kg": 75.0}
    assert data["pr_kg"] == 90.0  # el récord es de todo el historial
    assert data["best_e1rm_kg"] == pytest.approx(round(coach_strength.e1rm(90.0, 3), 2))


def test_warmups_and_bodyweight_do_not_count(today_fixed):
    user = make_user()
    activity = log_session(user, date(2026, 10, 20), [("Sentadilla", [(60.0, 8)]), ("Dominadas", [(None, 10)])])
    SetLog.objects.create(activity=activity, exercise="Sentadilla", exercise_index=0, set_index=1,
                          set_type="warmup", weight_kg=140, reps=1)
    data = last(client_for(user), "Sentadilla", "Dominadas")
    assert data["Sentadilla"]["pr_kg"] == 60.0
    assert data["Sentadilla"]["last"]["sets"] == 1
    assert data["Dominadas"] == {
        "last": {"date": "2026-10-20", "sets": 1, "reps": 10, "weight_kg": None},
        "pr_kg": None,
        "best_e1rm_kg": None,
    }


def test_names_match_without_case_and_unknown_ones_are_empty(today_fixed):
    user = make_user()
    log_session(user, date(2026, 10, 20), [("Press banca", [(60.0, 10)])])
    data = last(client_for(user), "press BANCA", "Remo")
    assert data["press BANCA"]["pr_kg"] == 60.0
    assert data["Remo"] == {"last": None, "pr_kg": None, "best_e1rm_kg": None}


def test_only_the_users_own_sets(today_fixed):
    other = make_user()
    log_session(other, date(2026, 10, 20), [("Press banca", [(100.0, 5)])])
    assert last(client_for(make_user()), "Press banca")["Press banca"]["last"] is None


def test_imported_sets_feed_the_gym(today_fixed):
    from .test_imports import HEVY_A, upload

    user = make_user()
    client = client_for(user)
    upload(client, HEVY_A)
    data = last(client, "Bench Press (Barbell)")["Bench Press (Barbell)"]
    assert data["last"] == {"date": "2026-09-03", "sets": 2, "reps": 6, "weight_kg": 80.0}
    assert data["pr_kg"] == 80.0
