import pytest
from django.conf import settings as dj_settings
from django.core.cache import cache
from rest_framework.test import APIClient

from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token


@pytest.fixture(autouse=True)
def user_state_throttle_rate():
    """`user-state` lo define el paquete A en settings.py (ver la lista de throttle
    scopes del proyecto). Este worktree aún no lo tiene, así que se inyecta solo para
    los tests: sin esto, ScopedRateThrottle lanza ImproperlyConfigured.

    DRF cachea `DEFAULT_THROTTLE_RATES` como atributo de clase en
    `SimpleRateThrottle` la primera vez que se importa `rest_framework.throttling`
    (una única vez por proceso), apuntando al MISMO dict de `settings.REST_FRAMEWORK`.
    Reasignar `settings.REST_FRAMEWORK` (p. ej. con la fixture `settings` de
    pytest-django) no le llega a esa referencia ya cacheada. Por eso aquí se muta
    ese dict en el sitio, en vez de reemplazarlo."""
    rates = dj_settings.REST_FRAMEWORK.setdefault("DEFAULT_THROTTLE_RATES", {})
    rates["user-state"] = "1000/min"
    cache.clear()
    yield
    rates.pop("user-state", None)
    cache.clear()


@pytest.fixture
def auth_client(db):
    user = user_create(email="f@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": "f@b.com", "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return client


@pytest.mark.django_db
def test_put_creates_entry_and_get_returns_it(auth_client):
    put = auth_client.put(
        "/api/v1/me/state/weigh",
        {"value": {"kg": 80.5}, "updated_at": "2026-09-24T10:00:00Z"},
        format="json",
    )
    assert put.status_code == 200
    assert put.data["accepted"] is True
    assert put.data["value"] == {"kg": 80.5}

    got = auth_client.get("/api/v1/me/state?keys=weigh")
    assert got.status_code == 200
    assert got.data["weigh"]["value"] == {"kg": 80.5}


@pytest.mark.django_db
def test_put_rejects_key_not_in_allowlist(auth_client):
    resp = auth_client.put(
        "/api/v1/me/state/not_allowed", {"value": {"x": 1}}, format="json"
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_put_rejects_value_over_64kb(auth_client):
    huge = {"blob": "x" * (64 * 1024 + 1)}
    resp = auth_client.put("/api/v1/me/state/coach_fb", {"value": huge}, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_put_last_write_wins_older_write_does_not_overwrite(auth_client):
    auth_client.put(
        "/api/v1/me/state/weigh",
        {"value": {"kg": 80}, "updated_at": "2026-09-24T12:00:00Z"},
        format="json",
    )
    older = auth_client.put(
        "/api/v1/me/state/weigh",
        {"value": {"kg": 70}, "updated_at": "2026-09-24T09:00:00Z"},
        format="json",
    )
    assert older.status_code == 200
    assert older.data["accepted"] is False
    assert older.data["value"] == {"kg": 80}  # devuelve el valor ganador (el del servidor)


@pytest.mark.django_db
def test_get_by_keys_returns_only_requested_and_existing(auth_client):
    auth_client.put("/api/v1/me/state/nutri_goal", {"value": {"kcal": 2200}}, format="json")
    resp = auth_client.get("/api/v1/me/state?keys=nutri_goal,weigh")
    assert resp.status_code == 200
    assert "nutri_goal" in resp.data
    assert "weigh" not in resp.data  # nunca se escribió


@pytest.mark.django_db
def test_get_by_prefix_and_date_range(auth_client):
    for day in ("2026-09-01", "2026-09-02", "2026-09-10"):
        auth_client.put(f"/api/v1/me/state/nutri_{day}", {"value": {"kcal": 2000}}, format="json")

    resp = auth_client.get("/api/v1/me/state?prefix=nutri_&from=2026-09-01&to=2026-09-05")
    assert resp.status_code == 200
    assert set(resp.data.keys()) == {"nutri_2026-09-01", "nutri_2026-09-02"}


@pytest.mark.django_db
def test_get_requires_keys_or_prefix(auth_client):
    resp = auth_client.get("/api/v1/me/state")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_delete_is_idempotent(auth_client):
    auth_client.put("/api/v1/me/state/weigh", {"value": {"kg": 80}}, format="json")
    first = auth_client.delete("/api/v1/me/state/weigh")
    assert first.status_code == 204
    second = auth_client.delete("/api/v1/me/state/weigh")
    assert second.status_code == 204

    resp = auth_client.get("/api/v1/me/state?keys=weigh")
    assert "weigh" not in resp.data


@pytest.mark.django_db
def test_user_only_sees_own_state(auth_client):
    other = user_create(email="other-f@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(other))
    from userstate.models import UserState
    UserState.objects.create(profile=other.profile, key="weigh", value={"kg": 999}, updated_at="2026-01-01T00:00:00Z")

    resp = auth_client.get("/api/v1/me/state?keys=weigh")
    assert "weigh" not in resp.data


@pytest.mark.django_db
def test_requires_auth(db):
    client = APIClient()
    resp = client.get("/api/v1/me/state?keys=weigh")
    assert resp.status_code == 401
