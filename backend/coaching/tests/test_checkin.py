"""Check-in diario (Task 5.1): `DailyCheckin`, `checkin_upsert` y `POST/GET /coach/checkin`.

Peso y cintura van a `BiometricsLog`; lo demás, a `DailyCheckin`. Con `no_weight_targets` el
servidor no acepta peso, cintura ni kcal (spec §8.3), y los demás campos sí.
"""
from datetime import date

import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from coaching import checkin
from coaching.models import DailyCheckin
from profiles.models import BiometricsLog

from .helpers import TODAY, client_for, fix_today, make_user

URL = "/api/v1/coach/checkin"
pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _today():
    with fix_today():
        yield


def _logs(user):
    return list(user.profile.biometrics.filter(external_id__startswith="checkin:"))


def test_requires_auth():
    assert APIClient().get(URL).status_code == 401
    assert APIClient().post(URL, {}, format="json").status_code == 401


def test_upsert_creates_checkin_and_biometrics_log():
    user = make_user(weight=None)
    saved = checkin.checkin_upsert(
        user,
        TODAY,
        {"weight_kg": 71.4, "waist_cm": 82.5, "intake_kcal": 2300, "sleep_hours": 7.5, "notes": "dolor de cabeza"},
        today=TODAY,
    )
    assert saved.date == TODAY and saved.intake_kcal == 2300 and saved.sleep_hours == 7.5
    assert saved.notes == "dolor de cabeza"
    (log,) = _logs(user)
    assert float(log.weight_kg) == 71.4 and float(log.waist_cm) == 82.5
    assert log.source == BiometricsLog.Source.MANUAL


def test_weight_log_is_dated_in_the_profile_timezone():
    user = make_user(weight=None, profile={"timezone": "Europe/Madrid"})
    checkin.checkin_upsert(user, date(2026, 10, 20), {"weight_kg": 70}, today=TODAY)
    from coaching.bridge.adapters import weigh_ins

    assert weigh_ins(user) == [(date(2026, 10, 20), 70.0)]


def test_second_checkin_the_same_day_fills_or_overrides_field_by_field_and_adds_notes():
    user = make_user(weight=None)
    checkin.checkin_upsert(user, TODAY, {"weight_kg": 71.0, "sleep_hours": 6, "notes": "mareo leve"}, today=TODAY)
    saved = checkin.checkin_upsert(user, TODAY, {"sleep_hours": 8, "intake_kcal": 2200, "notes": "regla: normal"}, today=TODAY)
    assert saved.sleep_hours == 8 and saved.intake_kcal == 2200
    assert saved.notes == "mareo leve; regla: normal"  # las notas se suman: un síntoma no se pierde
    assert DailyCheckin.objects.filter(profile=user.profile).count() == 1
    (log,) = _logs(user)  # el peso del primero sigue ahí y no se duplica
    assert float(log.weight_kg) == 71.0


def test_second_weight_the_same_day_replaces_the_first():
    user = make_user(weight=None)
    checkin.checkin_upsert(user, TODAY, {"weight_kg": 71.0}, today=TODAY)
    checkin.checkin_upsert(user, TODAY, {"weight_kg": 70.6}, today=TODAY)
    (log,) = _logs(user)
    assert float(log.weight_kg) == 70.6


def test_a_note_given_alone_does_not_erase_the_previous_one():
    user = make_user(weight=None)
    checkin.checkin_upsert(user, TODAY, {"notes": "uno"}, today=TODAY)
    saved = checkin.checkin_upsert(user, TODAY, {"sleep_hours": 7}, today=TODAY)
    assert saved.notes == "uno"


def test_the_engine_plausibility_ranges_are_enforced():
    user = make_user(weight=None)
    for field, bad in (("weight_kg", 20), ("waist_cm", 300), ("intake_kcal", 20000), ("sleep_hours", 30)):
        with pytest.raises(ValidationError) as err:
            checkin.checkin_upsert(user, TODAY, {field: bad}, today=TODAY)
        assert field in err.value.message_dict
    assert not DailyCheckin.objects.exists() and not BiometricsLog.objects.filter(profile=user.profile).exists()


def test_wellness_scores_are_1_to_5():
    user = make_user(weight=None)
    with pytest.raises(ValidationError) as err:
        checkin.checkin_upsert(user, TODAY, {"energy": 6, "stress": 0}, today=TODAY)
    assert {"energy", "stress"} <= set(err.value.message_dict)


def test_unknown_field_and_future_date_are_rejected():
    user = make_user(weight=None)
    with pytest.raises(ValidationError) as err:
        checkin.checkin_upsert(user, TODAY, {"mood_emoji": 3}, today=TODAY)
    assert "mood_emoji" in err.value.message_dict
    with pytest.raises(ValidationError) as err:
        checkin.checkin_upsert(user, date(2026, 10, 30), {"sleep_hours": 7}, today=TODAY)
    assert "date" in err.value.message_dict


def test_soreness_zones_must_be_known():
    user = make_user(weight=None)
    saved = checkin.checkin_upsert(user, TODAY, {"soreness_zones": ["legs", "back"]}, today=TODAY)
    assert saved.soreness_zones == ["legs", "back"]
    with pytest.raises(ValidationError):
        checkin.checkin_upsert(user, TODAY, {"soreness_zones": ["knees-of-doom"]}, today=TODAY)


def test_resting_hr_and_hrv_are_optional_and_go_to_the_biometrics_log():
    user = make_user(weight=None)
    checkin.checkin_upsert(user, TODAY, {"resting_heart_rate": 52, "hrv_ms": 70}, today=TODAY)
    (log,) = _logs(user)
    assert log.resting_heart_rate == 52 and log.hrv_ms == 70 and log.weight_kg is None


def test_no_weight_log_is_created_when_only_wellness_is_given():
    user = make_user(weight=None)
    checkin.checkin_upsert(user, TODAY, {"sleep_hours": 7, "energy": 4}, today=TODAY)
    assert _logs(user) == []


# --- con `no_weight_targets` -------------------------------------------------------------


BLOCKED_PROFILES = {
    "positive_scoff": {"screening": {"scoff_yes_count": 3}},
    "pregnant": {"profile": {"gender": "FEMALE", "conditions": ["pregnant"]}},
    "under_18": {"profile": {"date_of_birth": date(2012, 1, 1)}},
}


@pytest.mark.parametrize("name", BLOCKED_PROFILES)
def test_blocked_user_cannot_record_weight_waist_or_kcal(name):
    user = make_user(weight=None, **BLOCKED_PROFILES[name])
    for field, value in (("weight_kg", 70), ("waist_cm", 80), ("intake_kcal", 2000)):
        with pytest.raises(checkin.CheckinRefused) as err:
            checkin.checkin_upsert(user, TODAY, {field: value, "sleep_hours": 7}, today=TODAY)
        assert err.value.code == "weight_targets_blocked" and err.value.fields == [field]
    # nada se guardó, ni siquiera lo que sí se aceptaba
    assert not DailyCheckin.objects.exists() and not BiometricsLog.objects.filter(profile=user.profile).exists()


def test_blocked_user_can_still_record_sleep_wellness_and_symptoms():
    user = make_user(weight=None, screening={"scoff_positive": True})
    saved = checkin.checkin_upsert(
        user, TODAY, {"sleep_hours": 6, "energy": 2, "stress": 2, "notes": "cansancio"}, today=TODAY
    )
    assert saved.sleep_hours == 6 and saved.energy == 2


# --- API ---------------------------------------------------------------------------------


def test_post_then_get_returns_the_day_with_weight_and_waist():
    user = make_user(weight=None)
    client = client_for(user)
    resp = client.post(
        URL, {"weight_kg": 71.2, "waist_cm": 80, "sleep_hours": 7, "sleep_quality": 4, "notes": "bien"}, format="json"
    )
    assert resp.status_code == 200, resp.data
    got = client.get(URL).data["checkin"]
    assert got["date"] == TODAY.isoformat()
    assert got["weight_kg"] == 71.2 and got["waist_cm"] == 80.0
    assert got["sleep_hours"] == 7 and got["sleep_quality"] == 4 and got["notes"] == "bien"


def test_get_without_a_checkin_returns_null_and_the_blocked_flag():
    client = client_for(make_user(weight=None))
    body = client.get(URL).data
    assert body["checkin"] is None
    assert body["weight_blocked"] is False


def test_get_for_a_blocked_user_says_so_and_hides_weight_and_waist():
    user = make_user(weight=None, screening={"scoff_positive": True})
    client = client_for(user)
    body = client.get(URL).data
    assert body["weight_blocked"] is True
    client.post(URL, {"sleep_hours": 7}, format="json")
    got = client.get(URL).data["checkin"]
    assert got["weight_kg"] is None and got["waist_cm"] is None and got["intake_kcal"] is None


def test_post_a_blocked_field_is_403_with_the_fields():
    client = client_for(make_user(weight=None, screening={"scoff_positive": True}))
    resp = client.post(URL, {"weight_kg": 70, "intake_kcal": 2000, "sleep_hours": 7}, format="json")
    assert resp.status_code == 403
    assert resp.data["code"] == "weight_targets_blocked"
    assert resp.data["fields"] == ["weight_kg", "intake_kcal"]


def test_post_validation_errors_are_400():
    client = client_for(make_user(weight=None))
    resp = client.post(URL, {"weight_kg": 10}, format="json")
    assert resp.status_code == 400 and "weight_kg" in resp.data


def test_post_for_a_past_date_and_future_date():
    client = client_for(make_user(weight=None))
    ok = client.post(URL, {"date": "2026-10-27", "sleep_hours": 6}, format="json")
    assert ok.status_code == 200
    assert client.get(URL, {"date": "2026-10-27"}).data["checkin"]["sleep_hours"] == 6
    bad = client.post(URL, {"date": "2026-12-01", "sleep_hours": 6}, format="json")
    assert bad.status_code == 400 and "date" in bad.data


def test_a_user_only_sees_their_own_checkins():
    a, b = make_user(weight=None), make_user(weight=None)
    client_for(a).post(URL, {"sleep_hours": 5}, format="json")
    assert client_for(b).get(URL).data["checkin"] is None


def test_the_generic_biometrics_endpoint_also_refuses_body_data_when_blocked():
    user = make_user(weight=None, screening={"scoff_positive": True})
    client = client_for(user)
    resp = client.post("/api/v1/me/biometrics", {"weight_kg": "70.0"}, format="json")
    assert resp.status_code == 403 and resp.data["code"] == "weight_targets_blocked"
    ok = client.post("/api/v1/me/biometrics", {"resting_heart_rate": 55, "sleep_quality_score": 7}, format="json")
    assert ok.status_code == 201


def test_logged_weight_feeds_the_safety_weight_and_the_trend_source():
    user = make_user(weight=None)
    client = client_for(user)
    client.post(URL, {"weight_kg": 70.5}, format="json")
    assert client.get("/api/v1/coach/safety").data["weight"]["kg"] == 70.5
