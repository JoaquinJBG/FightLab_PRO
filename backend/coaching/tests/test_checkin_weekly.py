"""Preguntas semanales del check-in (Task 5.3): ciclo (mujeres no embarazadas) y tensión (con
hipertensión), solo si no hay registro en los últimos 7 días (`checkin/SKILL.md` paso 4)."""
from datetime import timedelta

import pytest

from coaching import checkin
from coaching.models import Screening, ScreeningEvent

from .helpers import TODAY, client_for, fix_today, make_user

URL = "/api/v1/coach/checkin"
SAFETY = "/api/v1/coach/safety"
pytestmark = pytest.mark.django_db

FEMALE = {"gender": "FEMALE"}


@pytest.fixture(autouse=True)
def _today():
    with fix_today():
        yield


def _codes(client):
    return [q["code"] for q in client.get(URL).data["weekly_questions"]]


def test_no_questions_for_a_man_without_hypertension():
    assert _codes(client_for(make_user())) == []


def test_the_cycle_question_is_asked_to_a_woman_who_is_not_pregnant():
    assert _codes(client_for(make_user(profile=FEMALE))) == ["menstrual"]


def test_equation_sex_female_also_counts_when_gender_is_other():
    user = make_user(profile={"gender": "OTHER", "equation_sex": "female"})
    assert _codes(client_for(user)) == ["menstrual"]


def test_the_cycle_question_is_not_asked_when_pregnant():
    user = make_user(profile={**FEMALE, "conditions": ["pregnant"]})
    assert _codes(client_for(user)) == []


def test_the_bp_question_is_asked_with_hypertension():
    user = make_user(profile={"conditions": ["hypertension"]})
    assert _codes(client_for(user)) == ["bp"]


def test_a_recorded_answer_silences_the_question_for_7_calendar_days():
    user = make_user(profile=FEMALE)
    client = client_for(user)
    checkin.checkin_upsert(user, TODAY - timedelta(days=6), {"period_status": "normal"}, today=TODAY)
    assert _codes(client) == []  # hace 6 días: dentro de los 7 últimos
    user.profile.checkins.all().delete()
    checkin.checkin_upsert(user, TODAY - timedelta(days=7), {"period_status": "normal"}, today=TODAY)
    assert _codes(client) == ["menstrual"]  # hace 7 días: ya toca


def test_a_checkin_without_the_weekly_answer_does_not_silence_it():
    user = make_user(profile=FEMALE)
    client = client_for(user)
    checkin.checkin_upsert(user, TODAY, {"sleep_hours": 7, "notes": "bien"}, today=TODAY)
    assert _codes(client) == ["menstrual"]


def test_each_question_is_silenced_independently():
    user = make_user(profile={**FEMALE, "conditions": ["hypertension"]})
    client = client_for(user)
    assert _codes(client) == ["menstrual", "bp"]
    checkin.checkin_upsert(user, TODAY, {"bp_systolic": 120, "bp_diastolic": 80}, today=TODAY)
    assert _codes(client) == ["menstrual"]


def test_the_contraception_question_is_asked_once():
    user = make_user(profile=FEMALE)
    client = client_for(user)
    q = client.get(URL).data["weekly_questions"][0]
    assert q["ask_contraception"] is True
    checkin.checkin_upsert(
        user, TODAY - timedelta(days=30), {"period_status": "normal", "hormonal_contraception": False}, today=TODAY
    )
    q = client.get(URL).data["weekly_questions"][0]
    assert q["code"] == "menstrual" and q["ask_contraception"] is False


def test_new_irregular_periods_go_to_screening_and_hold_the_deficit():
    user = make_user(profile=FEMALE)
    client = client_for(user)
    resp = client.post(URL, {"period_status": "irregular_new"}, format="json")
    assert resp.status_code == 200, resp.data
    assert Screening.objects.get(profile=user.profile).menstrual == "irregular_new"
    event = ScreeningEvent.objects.get(profile=user.profile, key="menstrual")
    assert event.origin == "checkin" and event.new_value == "irregular_new"
    safety = client.get(SAFETY).data
    assert safety["flags"]["hold_deficit"] is True and safety["refer_gp"] is True
    assert resp.data["safety"]["flags"]["hold_deficit"] is True
    assert _codes(client) == []  # ya registrada esta semana


def test_absent_periods_stop_the_deficit():
    user = make_user(profile=FEMALE)
    client = client_for(user)
    client.post(URL, {"period_status": "absent"}, format="json")
    assert client.get(SAFETY).data["flags"]["no_deficit"] is True


def test_a_normal_answer_is_recorded_and_sets_screening_only_if_it_was_blank():
    user = make_user(profile=FEMALE)
    client = client_for(user)
    client.post(URL, {"period_status": "normal"}, format="json")
    assert Screening.objects.get(profile=user.profile).menstrual == "normal"
    # una respuesta «normal» no borra un aviso anterior: eso lo decide un clínico
    screening = Screening.objects.get(profile=user.profile)
    screening.menstrual = "irregular_new"
    screening.save()
    client.post(URL, {"date": (TODAY - timedelta(days=1)).isoformat(), "period_status": "normal"}, format="json")
    assert Screening.objects.get(profile=user.profile).menstrual == "irregular_new"


def test_the_cycle_answer_is_refused_if_it_does_not_apply():
    man = client_for(make_user())
    resp = man.post(URL, {"period_status": "absent"}, format="json")
    assert resp.status_code == 400 and "period_status" in resp.data
    pregnant = client_for(make_user(profile={**FEMALE, "conditions": ["pregnant"]}))
    assert pregnant.post(URL, {"period_status": "absent"}, format="json").status_code == 400


def test_the_bp_reading_is_stored_in_screening_and_the_engine_applies_its_band():
    user = make_user(profile={"conditions": ["hypertension"]})
    client = client_for(user)
    resp = client.post(URL, {"bp_systolic": 185, "bp_diastolic": 95}, format="json")
    assert resp.status_code == 200, resp.data
    screening = Screening.objects.get(profile=user.profile)
    assert (screening.bp_systolic, screening.bp_diastolic) == (185, 95)
    assert client.get(SAFETY).data["flags"]["no_training"] is True
    assert {"bp_systolic", "bp_diastolic"} <= set(
        ScreeningEvent.objects.filter(profile=user.profile, origin="checkin").values_list("key", flat=True)
    )
    got = client.get(URL).data["checkin"]
    assert got["bp_systolic"] == 185 and got["bp_diastolic"] == 95


def test_a_lower_reading_later_replaces_the_stored_one():
    user = make_user(profile={"conditions": ["hypertension"]})
    client = client_for(user)
    client.post(URL, {"bp_systolic": 185, "bp_diastolic": 95}, format="json")
    client.post(URL, {"date": (TODAY - timedelta(days=1)).isoformat(), "bp_systolic": 150}, format="json")
    # la lectura guardada en el cribado es siempre la última enviada
    assert Screening.objects.get(profile=user.profile).bp_systolic == 150


def test_the_period_note_is_the_structured_value_not_text():
    user = make_user(profile=FEMALE)
    client = client_for(user)
    client.post(URL, {"period_status": "normal", "hormonal_contraception": True, "notes": "bien"}, format="json")
    got = client.get(URL).data["checkin"]
    assert got["period_status"] == "normal" and got["hormonal_contraception"] is True and got["notes"] == "bien"


def test_invalid_weekly_values_are_400():
    client = client_for(make_user(profile=FEMALE))
    assert client.post(URL, {"period_status": "maybe"}, format="json").status_code == 400
    assert client.post(URL, {"bp_systolic": 0}, format="json").status_code == 400
    assert client.post(URL, {"hormonal_contraception": "si"}, format="json").status_code == 400
    assert not Screening.objects.filter(menstrual__isnull=False).exists()
