"""Señales de alarma del check-in (Task 5.2): lista de `checkin/SKILL.md` paso 3, con la tabla
"Red flags" de `docs/safety.md`. Cada señal escribe en `Screening` o `Injury` (con su
`ScreeningEvent`) y el efecto se ve en la siguiente llamada a `/coach/safety`.
"""
import pytest

from coaching.models import DailyCheckin, Injury, Screening, ScreeningEvent

from .helpers import client_for, fix_today, make_user

URL = "/api/v1/coach/checkin"
SAFETY = "/api/v1/coach/safety"
pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _today():
    with fix_today():
        yield


def _post(client, signs, **extra):
    return client.post(URL, {"signs": signs, **extra}, format="json")


def _alerts(resp):
    return {a["code"]: a for a in resp.data["alerts"]}


def test_a_cardiac_symptom_turns_on_no_training_in_the_next_safety_call():
    """Aceptación del plan: síntoma cardiaco → `no_training` en la siguiente llamada a safety."""
    user = make_user()
    client = client_for(user)
    assert client.get(SAFETY).data["flags"]["no_training"] is False
    resp = _post(client, [{"code": "cardiac"}])
    assert resp.status_code == 200, resp.data
    assert Screening.objects.get(profile=user.profile).cardiac_symptoms is True
    event = ScreeningEvent.objects.get(profile=user.profile, key="cardiac_symptoms")
    assert event.origin == "checkin" and event.old_value is None and event.new_value is True
    assert event.actor == user
    safety = client.get(SAFETY).data
    assert safety["flags"]["no_training"] is True and safety["refer_gp"] is True


def test_cardiac_alert_levels_and_emergency_number():
    user = make_user(profile={"region": "es"})
    client = client_for(user)
    stop = _post(client, [{"code": "cardiac"}])
    assert _alerts(stop)["cardiac_stop"]["level"] == "stop"
    now = _post(client, [{"code": "cardiac", "emergency": True}])
    alert = _alerts(now)["cardiac_emergency"]
    assert alert["level"] == "emergency"
    assert "112" in alert["text"]
    assert alert["rule_key"] == "recovery-habits/cardiac-warning-symptoms-stop-and-refer"
    assert now.data["safety"]["emergency_number"] == "112"


def test_cardiac_emergency_without_a_stored_number_says_to_use_the_local_one():
    resp = _post(client_for(make_user()), [{"code": "cardiac", "emergency": True}])
    alert = _alerts(resp)["cardiac_emergency"]
    assert alert["level"] == "emergency" and "112" in alert["text"]  # el de Europa, como la skill


def test_reporting_the_same_symptom_twice_leaves_one_event():
    user = make_user()
    client = client_for(user)
    _post(client, [{"code": "cardiac"}])
    _post(client, [{"code": "cardiac"}])
    assert ScreeningEvent.objects.filter(profile=user.profile, key="cardiac_symptoms").count() == 1


def test_disordered_eating_sets_scoff_positive_and_closes_weight_tracking():
    user = make_user()
    client = client_for(user)
    resp = _post(client, [{"code": "disordered_eating"}])
    alert = _alerts(resp)["disordered_eating"]
    assert alert["level"] == "refer"
    assert alert["rule_key"] == "recovery-habits/warning-signs-that-warrant-referral"
    assert Screening.objects.get(profile=user.profile).scoff_positive is True
    safety = client.get(SAFETY).data
    assert safety["flags"]["no_weight_targets"] is True and safety["refer_gp"] is True
    assert client.get(URL).data["weight_blocked"] is True


def test_disordered_eating_urgent_is_same_day_urgent_care():
    resp = _post(client_for(make_user()), [{"code": "disordered_eating", "urgent": True}])
    alert = _alerts(resp)["disordered_eating_urgent"]
    assert alert["level"] == "urgent"
    assert alert["rule_key"] == "recovery-habits/urgent-medical-red-flags"


def test_weight_sent_together_with_a_new_eating_flag_is_not_saved_but_the_flag_is():
    user = make_user(weight=None)
    client = client_for(user)
    resp = _post(client, [{"code": "disordered_eating"}], weight_kg=60, sleep_hours=6)
    assert resp.status_code == 200
    assert resp.data["refused"] == ["weight_kg"]
    assert Screening.objects.get(profile=user.profile).scoff_positive is True
    assert not user.profile.biometrics.exists()
    assert DailyCheckin.objects.get(profile=user.profile).sleep_hours == 6


def test_systemic_illness_means_no_training_and_is_recorded_without_touching_screening():
    user = make_user()
    client = client_for(user)
    resp = _post(client, [{"code": "systemic_illness"}])
    alert = _alerts(resp)["systemic_illness"]
    assert alert["level"] == "rest"
    assert alert["rule_key"] == "recovery-habits/fever-and-systemic-illness-do-not-train"
    row = DailyCheckin.objects.get(profile=user.profile)
    assert row.illness == "systemic" and row.red_flags == ["systemic_illness"]
    assert not ScreeningEvent.objects.filter(profile=user.profile, origin="checkin").exists()


def test_head_cold_allows_light_training_except_with_no_training():
    user = make_user()
    client = client_for(user)
    light = _alerts(_post(client, [{"code": "head_cold"}]))["head_cold"]
    assert light["level"] == "info"
    assert light["rule_key"] == "recovery-habits/head-cold-optional-light-training"
    _post(client, [{"code": "cardiac"}])
    resp = _post(client, [{"code": "head_cold"}])
    assert "head_cold_no_training" in _alerts(resp)


def test_rhabdomyolysis_signs_are_urgent_care_now():
    resp = _post(client_for(make_user()), [{"code": "rhabdo"}])
    alert = _alerts(resp)["rhabdo"]
    assert alert["level"] == "urgent"
    assert alert["rule_key"] == "recovery-habits/recognise-it-and-send-to-urgent-care"


def test_a_new_injury_is_recorded_unassessed_with_origin_checkin():
    user = make_user()
    client = client_for(user)
    resp = _post(
        client, [{"code": "injury", "area": "hombro derecho", "exercises": ["Press militar"], "since": "2026-10-25"}]
    )
    assert resp.status_code == 200, resp.data
    injury = Injury.objects.get(profile=user.profile)
    assert injury.area == "hombro derecho" and injury.status == "active" and injury.origin == "checkin"
    assert injury.exercises == ["Press militar"] and str(injury.since) == "2026-10-25"
    assert injury.professional is None
    alert = _alerts(resp)["injury_new"]
    assert alert["level"] == "refer"
    safety = client.get(SAFETY).data
    assert safety["refer_gp"] is True  # sin profesional: médico o fisio antes de cargarla
    assert "Press militar" in safety["paused_exercises"]


def test_an_injury_already_assessed_does_not_force_a_referral():
    user = make_user()
    client = client_for(user)
    _post(client, [{"code": "injury", "area": "rodilla", "professional": "fisio"}])
    assert Injury.objects.get(profile=user.profile).professional == "fisio"
    assert client.get(SAFETY).data["refer_gp"] is False


def test_severe_pain_is_stop_and_see_a_doctor():
    resp = _post(client_for(make_user()), [{"code": "injury", "area": "espalda", "severe": True}])
    alert = _alerts(resp)["injury_severe"]
    assert alert["level"] == "stop"
    assert alert["rule_key"] == "recovery-habits/some-pain-during-exercise-is-acceptable-in-chronic-assessed-pain"


def test_an_active_injury_in_the_same_area_is_not_duplicated():
    user = make_user()
    client = client_for(user)
    _post(client, [{"code": "injury", "area": "Rodilla"}])
    _post(client, [{"code": "injury", "area": "rodilla "}])
    assert Injury.objects.filter(profile=user.profile).count() == 1


def test_signs_are_recorded_by_code_on_the_checkin_without_duplicates():
    user = make_user()
    client = client_for(user)
    _post(client, [{"code": "rhabdo"}])
    _post(client, [{"code": "rhabdo"}, {"code": "systemic_illness"}])
    assert DailyCheckin.objects.get(profile=user.profile).red_flags == ["rhabdo", "systemic_illness"]


@pytest.mark.parametrize(
    "signs",
    [
        [{"code": "telepathy"}],
        [{"code": "injury"}],  # sin zona
        [{"code": "injury", "area": "  "}],
        [{"code": "injury", "area": "codo", "since": "ayer"}],
        [{"code": "injury", "area": "codo", "exercises": "dominadas"}],
        "cardiac",
        [{"emergency": True}],
    ],
)
def test_malformed_signs_are_400_and_nothing_is_written(signs):
    user = make_user()
    client = client_for(user)
    resp = _post(client, signs, sleep_hours=7)
    assert resp.status_code == 400 and "signs" in resp.data
    assert not Injury.objects.exists() and not DailyCheckin.objects.exists()
    assert not ScreeningEvent.objects.filter(origin="checkin").exists()


def test_invalid_values_with_signs_write_nothing():
    user = make_user()
    resp = _post(client_for(user), [{"code": "cardiac"}], sleep_hours=99)
    assert resp.status_code == 400
    assert Screening.objects.get(profile=user.profile).cardiac_symptoms is None


def test_the_response_carries_the_deferral_line_in_the_users_language_when_refer_gp_is_set():
    client = client_for(make_user())
    resp = client.post(URL, {"signs": [{"code": "cardiac"}]}, format="json", HTTP_ACCEPT_LANGUAGE="en")
    assert resp.data["safety"]["refer_gp"] is True
    assert resp.data["safety"]["deferral_line"].startswith("This is general guidance from an automated coach")
    es = client_for(make_user())
    resp = es.post(URL, {"signs": [{"code": "cardiac"}]}, format="json", HTTP_ACCEPT_LANGUAGE="es")
    assert resp.data["safety"]["deferral_line"].startswith("Esto es orientación general")


def test_alert_texts_exist_in_both_languages_and_name_a_professional_or_none():
    from coaching import redflags

    assert set(redflags.TEXTS["es"]) == set(redflags.TEXTS["en"]) == set(redflags.LEVELS)
