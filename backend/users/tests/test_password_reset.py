import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from users.services import email_verify, password_reset_confirm, password_reset_request, user_create
from users.tokens import (
    check_password_reset_token,
    generate_email_verification_token,
    generate_password_reset_uid_and_token,
)

User = get_user_model()


@pytest.fixture
def client():
    cache.clear()
    return APIClient()


@pytest.fixture
def verified_user(db):
    user = user_create(email="a@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    mail.outbox.clear()  # limpia el email de verificación: no nos interesa aquí
    return user


# --- servicios ---


@pytest.mark.django_db
def test_password_reset_request_sends_email_for_active_user(verified_user):
    password_reset_request(email="a@b.com")
    assert len(mail.outbox) == 1
    assert "a@b.com" in mail.outbox[0].to


@pytest.mark.django_db
def test_password_reset_request_is_silent_for_unknown_email():
    password_reset_request(email="nadie@b.com")  # no debe lanzar
    assert len(mail.outbox) == 0


@pytest.mark.django_db
def test_password_reset_request_normalizes_email(verified_user):
    password_reset_request(email="  A@B.COM  ")
    assert len(mail.outbox) == 1


@pytest.mark.django_db
def test_password_reset_confirm_sets_new_password(verified_user):
    uid, token = generate_password_reset_uid_and_token(verified_user)
    password_reset_confirm(uid=uid, token=token, password="pw-new-strong-999")
    verified_user.refresh_from_db()
    assert verified_user.check_password("pw-new-strong-999")


@pytest.mark.django_db
def test_password_reset_confirm_rejects_bad_token(verified_user):
    uid, _ = generate_password_reset_uid_and_token(verified_user)
    with pytest.raises(ValueError):
        password_reset_confirm(uid=uid, token="not-a-real-token", password="pw-new-strong-999")


@pytest.mark.django_db
def test_password_reset_confirm_token_is_single_use(verified_user):
    uid, token = generate_password_reset_uid_and_token(verified_user)
    password_reset_confirm(uid=uid, token=token, password="pw-new-strong-999")
    verified_user.refresh_from_db()
    # el generador estándar de Django ata el hash a la contraseña: al cambiarla,
    # el mismo (uid, token) deja de ser válido.
    assert not check_password_reset_token(verified_user, token)


# --- endpoints ---


@pytest.mark.django_db
def test_password_reset_endpoint_always_returns_200(client, verified_user):
    resp = client.post("/api/v1/auth/password-reset", {"email": "a@b.com"}, format="json")
    assert resp.status_code == 200
    resp2 = client.post("/api/v1/auth/password-reset", {"email": "nadie@b.com"}, format="json")
    assert resp2.status_code == 200


@pytest.mark.django_db
def test_password_reset_confirm_endpoint_updates_password_and_logs_in(client, verified_user):
    uid, token = generate_password_reset_uid_and_token(verified_user)
    resp = client.post(
        "/api/v1/auth/password-reset/confirm",
        {"uid": uid, "token": token, "password": "pw-new-strong-999"},
        format="json",
    )
    assert resp.status_code == 200
    login = client.post(
        "/api/v1/auth/login", {"email": "a@b.com", "password": "pw-new-strong-999"}, format="json"
    )
    assert login.status_code == 200


@pytest.mark.django_db
def test_password_reset_confirm_endpoint_rejects_invalid_token(client, verified_user):
    resp = client.post(
        "/api/v1/auth/password-reset/confirm",
        {"uid": "bad-uid", "token": "bad-token", "password": "pw-new-strong-999"},
        format="json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_password_reset_confirm_blacklists_existing_refresh_tokens(client, verified_user):
    login = client.post(
        "/api/v1/auth/login", {"email": "a@b.com", "password": "pw-strong-123"}, format="json"
    )
    old_refresh = login.data["refresh"]

    uid, token = generate_password_reset_uid_and_token(verified_user)
    client.post(
        "/api/v1/auth/password-reset/confirm",
        {"uid": uid, "token": token, "password": "pw-new-strong-999"},
        format="json",
    )

    again = client.post("/api/v1/auth/refresh", {"refresh": old_refresh}, format="json")
    assert again.status_code == 401


@pytest.mark.django_db
def test_password_reset_throttle_blocks_after_limit(client, verified_user, monkeypatch):
    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "password-reset", "2/min")
    for _ in range(2):
        client.post("/api/v1/auth/password-reset", {"email": "a@b.com"}, format="json")
    resp = client.post("/api/v1/auth/password-reset", {"email": "a@b.com"}, format="json")
    assert resp.status_code == 429
