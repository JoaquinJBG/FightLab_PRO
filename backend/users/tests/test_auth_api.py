import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from users.tokens import generate_email_verification_token

User = get_user_model()


@pytest.fixture
def client():
    cache.clear()  # resetea el throttle de login/register/password-reset entre tests
    return APIClient()


@pytest.mark.django_db
def test_register_creates_inactive_user(client):
    resp = client.post(
        "/api/v1/auth/register",
        {"email": "a@b.com", "password": "pw-strong-123"},
        format="json",
    )
    assert resp.status_code == 201
    user = User.objects.get(email="a@b.com")
    assert user.is_active is False


@pytest.mark.django_db
def test_register_resends_for_unverified_duplicate_without_touching_password(client):
    client.post("/api/v1/auth/register", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    resp = client.post("/api/v1/auth/register", {"email": "a@b.com", "password": "pw-strong-456"}, format="json")
    assert resp.status_code == 201  # reenvía el enlace, no bloquea
    user = User.objects.get(email="a@b.com")
    assert user.check_password("pw-strong-123")  # no se secuestra la cuenta a medio verificar
    assert not user.check_password("pw-strong-456")


@pytest.mark.django_db
def test_register_rejects_verified_duplicate(client):
    client.post("/api/v1/auth/register", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    user = User.objects.get(email="a@b.com")
    token = generate_email_verification_token(user)
    client.post("/api/v1/auth/verify-email", {"token": token}, format="json")
    resp = client.post("/api/v1/auth/register", {"email": "a@b.com", "password": "pw-strong-456"}, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_verify_email_activates(client):
    client.post("/api/v1/auth/register", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    user = User.objects.get(email="a@b.com")
    token = generate_email_verification_token(user)
    resp = client.post("/api/v1/auth/verify-email", {"token": token}, format="json")
    assert resp.status_code == 200
    user.refresh_from_db()
    assert user.is_active is True


@pytest.mark.django_db
def test_register_normalizes_email(client):
    resp = client.post(
        "/api/v1/auth/register",
        {"email": "  MixedCase@B.COM  ", "password": "pw-strong-123"},
        format="json",
    )
    assert resp.status_code == 201
    assert User.objects.filter(email="mixedcase@b.com").exists()


@pytest.mark.django_db
def test_register_rejects_email_outside_beta_allowlist(client, settings):
    settings.DEBUG = False
    settings.BETA_ALLOWED_EMAILS = ["allowed@b.com"]
    resp = client.post(
        "/api/v1/auth/register",
        {"email": "outsider@b.com", "password": "pw-strong-123"},
        format="json",
    )
    assert resp.status_code == 403
    assert resp.data["detail"] == "Registro solo por invitación"
    assert not User.objects.filter(email="outsider@b.com").exists()


@pytest.mark.django_db
def test_register_allows_email_in_beta_allowlist_case_insensitive(client, settings):
    settings.DEBUG = False
    settings.BETA_ALLOWED_EMAILS = ["allowed@b.com"]
    resp = client.post(
        "/api/v1/auth/register",
        {"email": "Allowed@B.com", "password": "pw-strong-123"},
        format="json",
    )
    assert resp.status_code == 201


@pytest.mark.django_db
def test_register_allows_all_when_debug_and_allowlist_empty(client, settings):
    settings.DEBUG = True
    settings.BETA_ALLOWED_EMAILS = []
    resp = client.post(
        "/api/v1/auth/register",
        {"email": "anyone@b.com", "password": "pw-strong-123"},
        format="json",
    )
    assert resp.status_code == 201


@pytest.mark.django_db
def test_register_rejects_all_in_production_when_allowlist_empty(client, settings):
    settings.DEBUG = False
    settings.BETA_ALLOWED_EMAILS = []
    resp = client.post(
        "/api/v1/auth/register",
        {"email": "anyone@b.com", "password": "pw-strong-123"},
        format="json",
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_register_throttle_blocks_after_limit(client, monkeypatch):
    # DRF congela DEFAULT_THROTTLE_RATES como atributo de clase al importar
    # rest_framework.throttling, así que sobreescribir settings.REST_FRAMEWORK
    # en el test no lo ve: hay que parchear ese dict compartido directamente.
    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "register", "2/min")
    for i in range(2):
        client.post(
            "/api/v1/auth/register",
            {"email": f"user{i}@b.com", "password": "pw-strong-123"},
            format="json",
        )
    resp = client.post(
        "/api/v1/auth/register",
        {"email": "user2@b.com", "password": "pw-strong-123"},
        format="json",
    )
    assert resp.status_code == 429
