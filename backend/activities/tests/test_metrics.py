"""Tests del motor de carga: paridad con frontend/lib/load.ts y bucketing por tz."""
from datetime import timedelta, timezone as dt_tz
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from activities.models import Activity
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token


@pytest.fixture
def user(db):
    cache.clear()
    u = user_create(email="metrics@test.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(u))
    return u


@pytest.fixture
def auth_client(user):
    client = APIClient()
    login = client.post(
        "/api/v1/auth/login", {"email": "metrics@test.com", "password": "pw-strong-123"}, format="json"
    )
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return client


def add(user, *, days_ago: int, minutes: int, rpe: int | None, kind="SPORT", hour=12):
    """Crea una actividad a las `hour` UTC de hace `days_ago` días."""
    started = (timezone.now() - timedelta(days=days_ago)).replace(
        hour=hour, minute=0, second=0, microsecond=0
    )
    return Activity.objects.create(
        profile=user.profile, kind=kind, started_at=started,
        duration_sec=minutes * 60, rpe=rpe,
    )


@pytest.mark.django_db
def test_sin_actividades(auth_client):
    resp = auth_client.get("/api/v1/activities/metrics")
    assert resp.status_code == 200
    assert resp.data == {
        "week_au": 0, "daily7": [0] * 7, "acwr": None, "provisional": True,
        "monotonia": None, "tension": None, "sin_variacion": False, "history_days": 0,
    }


@pytest.mark.django_db
def test_semana_sin_acwr_por_poco_historial(auth_client, user):
    add(user, days_ago=0, minutes=60, rpe=8)  # 480 AU hoy
    add(user, days_ago=2, minutes=30, rpe=6)  # 180 AU
    resp = auth_client.get("/api/v1/activities/metrics")
    assert resp.data["week_au"] == 660
    assert resp.data["daily7"][-1] == 480
    assert resp.data["history_days"] == 3
    assert resp.data["acwr"] is None  # umbral: 10 días de historial
    assert resp.data["monotonia"] is None  # umbral: 7 días


@pytest.mark.django_db
def test_acwr_con_historial_suficiente(auth_client, user):
    # 12 días de historial: 1 sesión hace 11 días + carga esta semana
    add(user, days_ago=11, minutes=60, rpe=5)  # 300 AU (fuera de la semana aguda)
    add(user, days_ago=1, minutes=60, rpe=7)  # 420 AU
    resp = auth_client.get("/api/v1/activities/metrics")
    d = resp.data
    assert d["history_days"] == 12
    assert d["week_au"] == 420
    # crónica = (300+420)/12 = 60 AU/día; aguda = 420/7 = 60 -> ACWR 1.0
    assert d["acwr"] == 1.0
    assert d["provisional"] is True  # < 28 días


@pytest.mark.django_db
def test_sin_variacion_monotonia_maxima(auth_client, user):
    # Misma carga los últimos 7 días -> SD=0 -> sin_variacion (no "sin datos")
    for i in range(7):
        add(user, days_ago=i, minutes=30, rpe=6)
    resp = auth_client.get("/api/v1/activities/metrics")
    assert resp.data["history_days"] == 7
    assert resp.data["monotonia"] is None
    assert resp.data["tension"] is None
    assert resp.data["sin_variacion"] is True


@pytest.mark.django_db
def test_monotonia_y_tension(auth_client, user):
    add(user, days_ago=7, minutes=30, rpe=6)  # asegura history_days >= 8
    add(user, days_ago=0, minutes=60, rpe=8)  # 480 AU, único día con carga en la semana
    resp = auth_client.get("/api/v1/activities/metrics")
    d = resp.data
    # mean = 480/7 ≈ 68.57; sd = sqrt((6*mean² + (480-mean)²)/7) ≈ 168.0
    assert d["monotonia"] == pytest.approx(0.41, abs=0.01)
    assert d["tension"] == pytest.approx(196, abs=2)
    assert d["sin_variacion"] is False


@pytest.mark.django_db
def test_actividades_sin_rpe_no_cuentan(auth_client, user):
    add(user, days_ago=20, minutes=60, rpe=None)  # paseo sin RPE: ni historia ni carga
    add(user, days_ago=1, minutes=30, rpe=6)
    resp = auth_client.get("/api/v1/activities/metrics")
    assert resp.data["history_days"] == 2  # arranca en la primera CON rpe
    assert resp.data["week_au"] == 180


@pytest.mark.django_db
def test_bucket_por_dia_local_del_tz(auth_client, user):
    """Una sesión a las 23:30 UTC es del día siguiente en Madrid (UTC+1/+2):
    el bucket diario debe depender del tz pedido. Índices calculados para que
    el test no dependa de la hora a la que se ejecute."""
    started = (timezone.now() - timedelta(days=1)).replace(
        hour=23, minute=30, second=0, microsecond=0
    )
    Activity.objects.create(
        profile=user.profile, kind="SPORT", started_at=started,
        duration_sec=1800, rpe=8,  # 240 AU
    )
    utc = auth_client.get("/api/v1/activities/metrics?tz=UTC").data
    mad = auth_client.get("/api/v1/activities/metrics?tz=Europe/Madrid").data

    utc_tz, mad_tz = dt_tz.utc, ZoneInfo("Europe/Madrid")
    idx_utc = 6 - (timezone.now().astimezone(utc_tz).date() - started.astimezone(utc_tz).date()).days
    idx_mad = 6 - (timezone.now().astimezone(mad_tz).date() - started.astimezone(mad_tz).date()).days
    assert idx_utc != idx_mad  # la misma sesión cae en días locales distintos
    assert utc["daily7"][idx_utc] == 240
    assert mad["daily7"][idx_mad] == 240


@pytest.mark.django_db
def test_tz_invalido_cae_a_utc(auth_client, user):
    add(user, days_ago=0, minutes=30, rpe=6)
    resp = auth_client.get("/api/v1/activities/metrics?tz=No/Existe")
    assert resp.status_code == 200
    assert resp.data["week_au"] == 180


@pytest.mark.django_db
def test_historial_viejo_sin_semana_activa(auth_client, user):
    """Última sesión hace 30+ días: historia llena (28) pero semana a cero -> sin ACWR."""
    Activity.objects.create(
        profile=user.profile, kind="SPORT",
        started_at=timezone.now() - timedelta(days=35),
        duration_sec=3600, rpe=7,
    )
    resp = auth_client.get("/api/v1/activities/metrics")
    assert resp.data["history_days"] == 28
    assert resp.data["week_au"] == 0
    assert resp.data["acwr"] is None


@pytest.mark.django_db
def test_load_au_paridad_con_frontend(user):
    """load = round(durationSec/60 × rpe), la fórmula exacta de lib/load.ts."""
    a = Activity.objects.create(
        profile=user.profile, kind="GYM",
        started_at=timezone.now() - timedelta(hours=1),
        duration_sec=1530, rpe=8,  # 25.5 min × 8 = 204 (no 200 ni 208)
    )
    assert a.load_au == 204
    # Half-up como Math.round: 90s × RPE 3 = 4.5 -> 5 (round() de Python daría 4)
    b = Activity.objects.create(
        profile=user.profile, kind="SPORT",
        started_at=timezone.now() - timedelta(hours=2),
        duration_sec=90, rpe=3,
    )
    assert b.load_au == 5


@pytest.mark.django_db
def test_sesiones_con_carga_cero_no_cuentan(auth_client, user):
    """Carga que redondea a 0 (sec×rpe < 30) no fija historia ni suma, como el
    filtro load > 0 del frontend."""
    Activity.objects.create(
        profile=user.profile, kind="SPORT",
        started_at=timezone.now() - timedelta(days=20),
        duration_sec=20, rpe=1,  # round(20/60×1) = 0
    )
    add(user, days_ago=1, minutes=30, rpe=6)
    resp = auth_client.get("/api/v1/activities/metrics")
    assert resp.data["history_days"] == 2  # la sesión de carga 0 no abre historial
    assert resp.data["week_au"] == 180
