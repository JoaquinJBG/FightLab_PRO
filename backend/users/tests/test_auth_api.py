import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from users.tokens import generate_email_verification_token

User = get_user_model()


@pytest.fixture
def client():
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
def test_register_rejects_duplicate(client):
    client.post("/api/v1/auth/register", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
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
