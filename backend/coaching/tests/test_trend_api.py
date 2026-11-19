"""`GET /api/v1/coach/trend` (Task 5.4): `coach.trend.weight_trend` sobre los pesajes de
`BiometricsLog`. Con menos de 7 pesajes en 14 días dice "insuficiente"; con `no_weight_targets`
no devuelve nada."""
from datetime import date, datetime, time, timedelta, timezone

import pytest
from coach import trend as coach_trend
from rest_framework.test import APIClient

from profiles.models import BiometricsLog

from .helpers import TODAY, client_for, fix_today, make_user

URL = "/api/v1/coach/trend"
pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _today():
    with fix_today():
        yield


def _weigh(user, days_ago_and_kg):
    for ago, kg in days_ago_and_kg:
        day = TODAY - timedelta(days=ago)
        BiometricsLog.objects.create(
            profile=user.profile, weight_kg=kg, timestamp=datetime.combine(day, time(8), tzinfo=timezone.utc)
        )


def _steady_loss():
    """Un pesaje diario durante 15 días, bajando 0,1 kg al día."""
    return [(ago, 72.0 - 0.1 * (14 - ago)) for ago in range(14, -1, -1)]


def test_requires_auth():
    assert APIClient().get(URL).status_code == 401


def test_no_weigh_ins_is_insufficient_with_its_reason():
    body = client_for(make_user(weight=None)).get(URL).data
    assert body["status"] == "insufficient_data" and body["blocked"] is False
    assert body["rate_kg_week"] is None and body["points"] == 0
    assert body["reasons"][0]["code"] == "no_weigh_ins"


def test_fewer_than_7_weigh_ins_in_14_days_is_insufficient():
    """Aceptación del plan."""
    user = make_user(weight=None)
    _weigh(user, [(13, 72.0), (10, 71.9), (8, 71.9), (5, 71.7), (3, 71.6), (0, 71.5)])  # 6 pesajes
    body = client_for(user).get(URL).data
    assert body["status"] == "insufficient_data"
    assert body["points"] == 6 and body["days"] == 14
    assert body["rate_kg_week"] is None and body["weight_kg"] is None
    assert body["min_points"] == 7 and body["min_days"] == 14
    reason = body["reasons"][0]
    assert reason["code"] == "trend_insufficient" and reason["params"] == {"min_points": 7, "min_days": 14}
    assert reason["rule_key"] == "nutrition/read-the-scale-with-weekly-averages"
    assert body["rule_key"] == "nutrition/read-the-scale-with-weekly-averages"


def test_seven_weigh_ins_but_not_covering_14_days_is_insufficient():
    user = make_user(weight=None)
    _weigh(user, [(ago, 71.0) for ago in range(0, 8)])
    body = client_for(user).get(URL).data
    assert body["status"] == "insufficient_data" and body["points"] == 8 and body["days"] == 8


def test_enough_weigh_ins_give_the_engine_rate():
    user = make_user(weight=None)
    series = _steady_loss()
    _weigh(user, series)
    body = client_for(user).get(URL).data
    expected = coach_trend.weight_trend([(TODAY - timedelta(days=a), kg) for a, kg in series])
    assert body["status"] == "ok"
    assert body["rate_kg_week"] == pytest.approx(expected.rate_kg_week)
    assert body["rate_pct_week"] == pytest.approx(expected.rate_pct_week)
    assert body["weight_kg"] == pytest.approx(expected.weight_kg)
    assert body["points"] == expected.points and body["days"] == expected.days
    assert body["start"] == expected.start.isoformat() and body["end"] == TODAY.isoformat()
    assert body["rate_kg_week"] < 0 and body["can_recalibrate"] is False
    assert body["reasons"] == []


def test_several_weigh_ins_on_one_day_count_once():
    user = make_user(weight=None)
    series = [(ago, 71.0) for ago in range(0, 6)]
    _weigh(user, series + series)  # doce registros, seis días
    assert client_for(user).get(URL).data["points"] == 6


def test_weigh_ins_dated_after_today_are_ignored():
    user = make_user(weight=None)
    _weigh(user, _steady_loss())
    BiometricsLog.objects.create(
        profile=user.profile, weight_kg=90, timestamp=datetime.combine(TODAY + timedelta(days=3), time(8), tzinfo=timezone.utc)
    )
    body = client_for(user).get(URL).data
    assert body["end"] == TODAY.isoformat() and body["weight_kg"] < 72


@pytest.mark.parametrize(
    "kwargs",
    [
        {"screening": {"scoff_yes_count": 3}},
        {"profile": {"gender": "FEMALE", "conditions": ["pregnant"]}},
        {"profile": {"date_of_birth": date(2012, 1, 1)}},
    ],
    ids=["positive_scoff", "pregnant", "under_18"],
)
def test_no_weight_targets_hides_the_trend(kwargs):
    user = make_user(weight=None, **kwargs)
    _weigh(user, _steady_loss())
    body = client_for(user).get(URL).data
    assert body["status"] == "disabled" and body["blocked"] is True
    assert body["rate_kg_week"] is None and body["weight_kg"] is None and body["points"] == 0
    assert body["reasons"] and body["reasons"][0]["text"]


def test_an_unscreened_user_gets_no_trend_either():
    user = make_user(weight=None, screened=False)
    _weigh(user, _steady_loss())
    body = client_for(user).get(URL).data
    assert body["status"] == "disabled" and body["blocked"] is True and body["rate_kg_week"] is None


def test_the_reason_text_follows_the_request_language():
    user = make_user(weight=None)
    client = client_for(user)
    es = client.get(URL, HTTP_ACCEPT_LANGUAGE="es").data["reasons"][0]["text"]
    en = client.get(URL, HTTP_ACCEPT_LANGUAGE="en").data["reasons"][0]["text"]
    assert es != en


def test_biometrics_list_hides_body_data_when_blocked_but_keeps_heart_rate():
    user = make_user(weight=None, screening={"scoff_positive": True})
    BiometricsLog.objects.create(
        profile=user.profile, weight_kg=70, waist_cm=80, body_fat_pct=15, resting_heart_rate=55,
        timestamp=datetime.combine(TODAY, time(8), tzinfo=timezone.utc),
    )
    (row,) = client_for(user).get("/api/v1/me/biometrics").data
    assert row["weight_kg"] is None and row["waist_cm"] is None and row["body_fat_pct"] is None
    assert row["resting_heart_rate"] == 55


def test_biometrics_list_is_untouched_when_not_blocked():
    user = make_user(weight=70)
    (row,) = client_for(user).get("/api/v1/me/biometrics").data
    assert row["weight_kg"] == "70.00"
