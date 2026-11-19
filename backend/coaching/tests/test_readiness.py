"""Check-in de bienestar y readiness (Task 5.5): las reglas "Simple readiness monitoring" y
"HRV is optional" de `recovery-habits.md`.

Cinco puntuaciones de 1 a 5 (5 = lo mejor), comparadas con la propia línea base de cada persona.
Una bajada en 2 o más puntos durante 3 o más días significa mantener o reducir la carga. La VFC es
opcional: solo cuenta su propia tendencia de 7 días, junto a un bienestar subjetivo malo, y nunca
decide sola.
"""
from datetime import datetime, time, timedelta, timezone

import pytest

from coaching import checkin, readiness
from profiles.models import BiometricsLog

from .helpers import TODAY, client_for, fix_today, make_user

URL = "/api/v1/coach/checkin"
pytestmark = pytest.mark.django_db

GOOD = {"sleep_quality": 4, "energy": 4, "soreness": 4, "stress": 4, "mood": 4}
BAD = {"sleep_quality": 2, "energy": 2, "soreness": 2, "stress": 2, "mood": 2}


@pytest.fixture(autouse=True)
def _today():
    with fix_today():
        yield


def _fill(user, ago_to_scores: dict[int, dict]):
    for ago, scores in ago_to_scores.items():
        checkin.checkin_upsert(user, TODAY - timedelta(days=ago), scores, today=TODAY)


def _baseline(days=range(3, 12)):
    return {ago: dict(GOOD) for ago in days}


def test_no_data_without_enough_baseline():
    user = make_user()
    _fill(user, {0: BAD, 1: BAD, 2: BAD})  # sin línea base
    assert readiness.readiness_data(user, TODAY)["status"] == "no_data"


def test_three_days_of_a_drop_on_two_or_more_items_means_reduce():
    user = make_user()
    _fill(user, {**_baseline(), 0: BAD, 1: BAD, 2: BAD})
    data = readiness.readiness_data(user, TODAY)
    assert data["status"] == "reduce"
    assert set(data["drops_today"]) == set(BAD)
    assert data["days_with_drop"] == 3
    assert data["rule_key"] == "recovery-habits/simple-readiness-monitoring"


def test_two_days_are_not_enough():
    user = make_user()
    _fill(user, {**_baseline(), 0: BAD, 1: BAD, 2: GOOD})
    assert readiness.readiness_data(user, TODAY)["status"] == "ok"


def test_a_drop_on_one_item_only_does_not_count():
    user = make_user()
    one = {**GOOD, "sleep_quality": 2}
    _fill(user, {**_baseline(), 0: one, 1: one, 2: one})
    assert readiness.readiness_data(user, TODAY)["status"] == "ok"


def test_the_baseline_is_each_persons_own_not_an_absolute_threshold():
    user = make_user()
    low_but_normal = {k: 2 for k in GOOD}  # un 2 que es su media: no es una bajada
    _fill(user, {**{ago: dict(low_but_normal) for ago in range(3, 12)}, 0: low_but_normal, 1: low_but_normal, 2: low_but_normal})
    assert readiness.readiness_data(user, TODAY)["status"] == "ok"


def test_a_missing_day_in_the_window_breaks_the_run():
    user = make_user()
    _fill(user, {**_baseline(), 0: BAD, 2: BAD})  # falta ayer
    assert readiness.readiness_data(user, TODAY)["status"] == "ok"


def _hrv(user, values_by_ago: dict[int, int]):
    for ago, hrv in values_by_ago.items():
        day = TODAY - timedelta(days=ago)
        BiometricsLog.objects.create(
            profile=user.profile, hrv_ms=hrv, timestamp=datetime.combine(day, time(7), tzinfo=timezone.utc)
        )


def test_hrv_alone_never_decides():
    user = make_user()
    _hrv(user, {**{ago: 80 for ago in range(7, 25)}, **{ago: 60 for ago in range(0, 7)}})
    _fill(user, {**_baseline(), 0: GOOD})
    data = readiness.readiness_data(user, TODAY)
    assert data["hrv_drop"] is True and data["status"] == "ok"


def test_a_sustained_hrv_drop_with_poor_wellness_keeps_the_session_easy():
    user = make_user()
    _hrv(user, {**{ago: 80 for ago in range(7, 25)}, **{ago: 60 for ago in range(0, 7)}})
    _fill(user, {**_baseline(), 0: {**GOOD, "energy": 2}})
    data = readiness.readiness_data(user, TODAY)
    assert data["status"] == "easy" and data["hrv_drop"] is True
    assert data["hrv_rule_key"] == "recovery-habits/hrv-is-optional"


def test_hrv_is_optional_without_it_everything_still_works():
    user = make_user()
    _fill(user, {**_baseline(), 0: GOOD})
    data = readiness.readiness_data(user, TODAY)
    assert data["hrv_drop"] is False and data["status"] == "ok"


def test_the_checkin_response_carries_the_readiness():
    user = make_user()
    _fill(user, _baseline())
    client = client_for(user)
    resp = client.post(URL, {**BAD}, format="json")
    assert resp.data["readiness"]["status"] == "ok"  # un solo día malo no es una tendencia
    assert "drops_today" in resp.data["readiness"]
    assert client.get(URL).data["readiness"]["rule_key"] == "recovery-habits/simple-readiness-monitoring"
