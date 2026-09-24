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
    assert resp.status_code == 201  # reenvía el enlace, no bloquea, no enumera
    user = User.objects.get(email="a@b.com")
    # La contraseña del PRIMER registro se conserva: un segundo intento del
    # propio usuario legítimo (el caso más común) no debe dejarlo sin poder
    # entrar tras verificar. La del segundo intento se ignora.
    assert user.has_usable_password()
    assert user.check_password("pw-strong-123")
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
    assert resp.data["needs_password"] is False
    assert "uid" not in resp.data
    user.refresh_from_db()
    assert user.is_active is True


@pytest.mark.django_db
def test_verify_email_flags_needs_password_for_unusable_password_account(client):
    """Bug major (re-registro/cuentas heredadas): si la cuenta no tiene
    contraseña utilizable, verify-email debe devolver un uid/token de reset
    en vez de dejar al usuario con un login que dará 401 sin explicación."""
    client.post("/api/v1/auth/register", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    user = User.objects.get(email="a@b.com")
    user.set_unusable_password()
    user.save(update_fields=["password"])
    token = generate_email_verification_token(user)

    resp = client.post("/api/v1/auth/verify-email", {"token": token}, format="json")

    assert resp.status_code == 200
    assert resp.data["needs_password"] is True
    assert resp.data["uid"]
    assert resp.data["token"]

    reset_resp = client.post(
        "/api/v1/auth/password-reset/confirm",
        {"uid": resp.data["uid"], "token": resp.data["token"], "password": "pw-new-strong-999"},
        format="json",
    )
    assert reset_resp.status_code == 200
    login = client.post(
        "/api/v1/auth/login", {"email": "a@b.com", "password": "pw-new-strong-999"}, format="json"
    )
    assert login.status_code == 200


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
