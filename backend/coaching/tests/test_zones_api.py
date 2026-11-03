"""`GET /api/v1/coach/zones` (Task 4.2): zonas de FC y RPE con sus reglas."""
import pytest
from rest_framework.test import APIClient

from .helpers import client_for, fix_today, make_user

URL = "/api/v1/coach/zones"
pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _today():
    with fix_today():
        yield


def get(user, lang=None):
    extra = {"HTTP_ACCEPT_LANGUAGE": lang} if lang else {}
    return client_for(user).get(URL, **extra)


def test_requires_auth():
    assert APIClient().get(URL).status_code == 401


def test_zones_from_tanaka_without_resting_hr_use_hrmax_with_rules():
    body = get(make_user(), lang="es").data
    assert body["method"] == "hrmax"
    assert body["hr_max_source"] == "tanaka" and body["hr_max"] == round(208 - 0.7 * 30)
    assert [z["name"] for z in body["zones"]] == ["light", "moderate", "vigorous"]
    assert body["zones"][1]["rpe"] == [12, 13] and body["zones"][1]["talk_test"] == "can talk, but not sing"
    assert all(z["bpm"][0] < z["bpm"][1] for z in body["zones"])
    keys = {r["key"] for r in body["rules"]}
    assert {"cardio-health/acsm-intensity-bands", "cardio-health/hrmax-formulas-and-setting-the-anchor"} <= keys
    codes = {r["code"] for r in body["reasons"]}
    assert {"bands_approx", "hrmax_tanaka"} <= codes
    assert "aproximadas" in next(r for r in body["reasons"] if r["code"] == "bands_approx")["text"]


def test_resting_hr_from_biometrics_switches_to_heart_rate_reserve():
    body = get(make_user(resting_hr=55)).data
    assert body["method"] == "hrr"
    assert body["hr_rest"] == 55 and body["hr_rest_date"] == "2026-10-20"


def test_an_implausible_resting_hr_is_ignored():
    body = get(make_user(resting_hr=25)).data
    assert body["method"] == "hrmax" and body["hr_rest"] is None


def test_beta_blocker_gets_rpe_zones_without_vigorous():
    body = get(make_user(profile={"medications": ["beta_blocker"]})).data
    assert body["method"] == "rpe"
    assert [z["name"] for z in body["zones"]] == ["light", "moderate"]
    assert all(z["bpm"] is None for z in body["zones"])
    assert "beta_blocker_no_vigorous" in {r["code"] for r in body["reasons"]}


def test_unanswered_parq_removes_the_vigorous_zone_and_says_why():
    body = get(make_user(screening={"parq_any_yes": None, "parq_followup_yes": None})).data
    assert "vigorous" not in [z["name"] for z in body["zones"]]
    assert "parq_unanswered_light" in {r["code"] for r in body["reasons"]}


def test_no_training_gives_no_zones_with_the_blocking_reason():
    body = get(make_user(screening={"cardiac_symptoms": True})).data
    assert body["method"] == "no_training" and body["zones"] == []
    assert "cardiac_symptoms" in {r["code"] for r in body["reasons"]}


def test_zones_work_without_equation_sex_and_without_a_goal():
    """P7: sin `equation_sex` no hay objetivos calóricos, pero las zonas funcionan igual."""
    body = get(make_user(profile={"gender": "OTHER", "goal": None})).data
    assert body["method"] == "hrmax"
