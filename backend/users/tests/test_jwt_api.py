import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from users.services import user_create, email_verify
from users.tokens import generate_email_verification_token

User = get_user_model()


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def verified_user(db):
    user = user_create(email="a@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    return user


@pytest.mark.django_db
def test_unverified_user_cannot_login(client):
    user_create(email="a@b.com", password="pw-strong-123")  # inactive
    resp = client.post("/api/v1/auth/login", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_verified_user_logs_in_and_hits_me(client, verified_user):
    resp = client.post("/api/v1/auth/login", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    assert resp.status_code == 200
    access = resp.data["access"]
    assert "refresh" in resp.data

    me = client.get("/api/v1/me", HTTP_AUTHORIZATION=f"Bearer {access}")
    assert me.status_code == 200
    assert me.data["email"] == "a@b.com"


@pytest.mark.django_db
def test_me_requires_auth(client):
    resp = client.get("/api/v1/me")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_logout_blacklists_refresh(client, verified_user):
    login = client.post("/api/v1/auth/login", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    refresh = login.data["refresh"]
    out = client.post("/api/v1/auth/logout", {"refresh": refresh}, format="json")
    assert out.status_code == 205
    again = client.post("/api/v1/auth/refresh", {"refresh": refresh}, format="json")
    assert again.status_code == 401
