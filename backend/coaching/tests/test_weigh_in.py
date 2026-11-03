"""Pesaje en la BD y bloqueos de la spec §8.3 en el servidor (Tasks 4.4 y 4.5). Un test por flag."""
from datetime import date, datetime, timezone

import pytest
from rest_framework.test import APIClient

from .helpers import client_for, fix_today, make_user

URL = "/api/v1/coach/weigh-in"
PROFILE = "/api/v1/me/profile"
pytestmark = pytest.mark.django_db

WEIGH_FIELDS = ("goal_weight_kg", "goal_date", "weight_class", "weigh_in_at")
PAYLOAD = {"goal_weight_kg": "68.5", "weigh_in_at": "2026-11-12T09:00:00Z", "weight_class": "Ligero (70,3 kg)"}


@pytest.fixture(autouse=True)
def _today():
    with fix_today():
        yield


def test_requires_auth():
    assert APIClient().get(URL).status_code == 401


def test_empty_weigh_in_is_available_and_empty():
    body = client_for(make_user()).get(URL).data
    assert body["blocked"] is False and body["deficit_blocked"] is False
    assert body["goal_weight_kg"] is None and body["days_left"] is None and body["to_go_kg"] is None
    assert body["current_kg"] == 70.0


def test_save_and_read_back_with_countdown_and_distance():
    client = client_for(make_user(weight=72.0))
    resp = client.put(URL, PAYLOAD, format="json")
    assert resp.status_code == 200, resp.data
    body = client.get(URL).data
    assert body["goal_weight_kg"] == 68.5
    assert body["weight_class"] == "Ligero (70,3 kg)"
    assert body["days_left"] == 14  # 2026-11-12 menos 2026-10-29
    assert body["goal_date"] == "2026-11-12"
    assert body["to_go_kg"] == 3.5  # 72 - 68.5
    # y en el perfil (la fuente de verdad)
    profile = client.get(PROFILE).data
    assert profile["goal_weight_kg"] == "68.50" and profile["weight_class"] == "Ligero (70,3 kg)"


def test_clear_removes_the_weigh_in():
    client = client_for(make_user())
    client.put(URL, PAYLOAD, format="json")
    assert client.delete(URL).status_code == 204
    body = client.get(URL).data
    assert body["goal_weight_kg"] is None and body["weigh_in_at"] is None


@pytest.mark.parametrize("payload", [{"goal_weight_kg": "5"}, {"goal_weight_kg": "abc"}, {}, {"goal_weight_kg": "70", "weigh_in_at": "no"}])
def test_invalid_input_is_a_400(payload):
    assert client_for(make_user()).put(URL, payload, format="json").status_code == 400


# --- no_weight_targets: no se ve nada de pesaje -----------------------------------------

NO_WEIGHT_TARGETS = {
    "under_18": dict(profile={"date_of_birth": date(2012, 1, 1)}),
    "scoff_positive": dict(screening={"scoff_yes_count": 2}),
    "scoff_warning_sign": dict(screening={"scoff_yes_count": 1, "scoff_positive": True}),
    "pregnancy": dict(profile={"conditions": ["pregnant"], "gender": "FEMALE"}),
    "unscreened": dict(screened=False),
}


def _with_stored_weigh_in(user):
    """Los datos ya estaban guardados antes de que el flag se activara."""
    p = user.profile
    p.goal_weight_kg, p.weight_class = 65, "Ligero"
    p.weigh_in_at = datetime(2026, 11, 12, 9, tzinfo=timezone.utc)
    p.goal_date = date(2026, 11, 12)
    p.save()


@pytest.mark.parametrize("case", NO_WEIGHT_TARGETS)
def test_no_weight_targets_hides_every_weigh_in_datum(case):
    user = make_user(**NO_WEIGHT_TARGETS[case])
    _with_stored_weigh_in(user)
    client = client_for(user)
    body = client.get(URL).data
    assert body["blocked"] is True
    assert all(body[f] is None for f in (*WEIGH_FIELDS, "days_left", "to_go_kg", "weigh_in_at"))
    profile = client.get(PROFILE).data
    assert all(profile[f] is None for f in WEIGH_FIELDS)
    if case != "unscreened":
        assert body["reasons"], "la UI explica por qué no hay pesaje"


@pytest.mark.parametrize("case", NO_WEIGHT_TARGETS)
def test_no_weight_targets_refuses_to_store_weigh_in_data(case):
    user = make_user(**NO_WEIGHT_TARGETS[case])
    client = client_for(user)
    resp = client.put(URL, PAYLOAD, format="json")
    assert resp.status_code == 403 and resp.data["code"] == "weight_targets_blocked"
    resp = client.patch(PROFILE, {"goal_weight_kg": "65"}, format="json")
    assert resp.status_code == 403 and resp.data["code"] == "weight_targets_blocked"
    resp = client.patch(PROFILE, {"weight_class": "Ligero"}, format="json")
    assert resp.status_code == 403
    user.profile.refresh_from_db()
    assert user.profile.goal_weight_kg is None and user.profile.weight_class is None
    # el resto del perfil se sigue pudiendo editar
    assert client.patch(PROFILE, {"height_cm": 180}, format="json").status_code == 200


def test_the_biometrics_endpoint_does_not_carry_weigh_in_data():
    client = client_for(make_user(screening={"scoff_yes_count": 2}))
    row = client.get("/api/v1/me/biometrics").data[0]
    assert not set(WEIGH_FIELDS) & set(row)


# --- no_deficit y hold_deficit: nada de "a X kg de tu categoría" ni pérdida ------------------

NO_DEFICIT = {
    "glp1_prescriber_owns_weight": dict(profile={"medications": ["glp1"]}),
    "menstrual_absent": dict(profile={"gender": "FEMALE"}, screening={"menstrual": "absent"}),
    "menstrual_irregular_hold_deficit": dict(profile={"gender": "FEMALE"}, screening={"menstrual": "irregular_new"}),
    "older_adult": dict(profile={"date_of_birth": date(1955, 1, 1)}),
}


@pytest.mark.parametrize("case", NO_DEFICIT)
def test_a_blocked_deficit_keeps_the_countdown_but_not_the_distance(case):
    user = make_user(**NO_DEFICIT[case], weight=72.0)
    client = client_for(user)
    resp = client.put(URL, {"goal_weight_kg": "72", "weigh_in_at": "2026-11-12T09:00:00Z"}, format="json")
    assert resp.status_code == 200, resp.data
    body = client.get(URL).data
    assert body["blocked"] is False and body["deficit_blocked"] is True
    assert body["days_left"] == 14
    assert body["goal_weight_kg"] == 72.0
    assert body["to_go_kg"] is None, "sin 'a X kg de tu categoría' con el déficit bloqueado"
    assert body["reasons"]


@pytest.mark.parametrize("case", NO_DEFICIT)
def test_a_blocked_deficit_refuses_a_weight_below_the_current_one(case):
    user = make_user(**NO_DEFICIT[case], weight=72.0)
    client = client_for(user)
    resp = client.put(URL, {"goal_weight_kg": "68", "weigh_in_at": "2026-11-12T09:00:00Z"}, format="json")
    assert resp.status_code == 400 and resp.data["code"] == "deficit_blocked"
    resp = client.patch(PROFILE, {"goal_weight_kg": "68"}, format="json")
    assert resp.status_code == 400 and resp.data["code"] == "deficit_blocked"
    user.profile.refresh_from_db()
    assert user.profile.goal_weight_kg is None
    # un objetivo igual o por encima del peso actual no es una pérdida
    assert client.put(URL, {"goal_weight_kg": "75", "weigh_in_at": "2026-11-12T09:00:00Z"}, format="json").status_code == 200


def test_no_other_flag_touches_the_weigh_in():
    """Banderas sin relación con el peso (cardiaco, PAR-Q+...) no ocultan ni limitan el pesaje."""
    client = client_for(make_user(screening={"cardiac_symptoms": True, "parq_any_yes": True}))
    assert client.put(URL, {"goal_weight_kg": "65", "weigh_in_at": "2026-11-12T09:00:00Z"}, format="json").status_code == 200
    body = client.get(URL).data
    assert body["blocked"] is False and body["deficit_blocked"] is False and body["to_go_kg"] == 5.0


def test_the_countdown_is_in_the_profile_time_zone():
    user = make_user()
    user.profile.timezone = "Pacific/Auckland"  # el 12/11 a las 23:00 UTC ya es 13/11 allí
    user.profile.save()
    client = client_for(user)
    client.put(URL, {"goal_weight_kg": "68", "weigh_in_at": "2026-11-12T23:00:00Z"}, format="json")
    body = client.get(URL).data
    assert body["goal_date"] == "2026-11-13"
