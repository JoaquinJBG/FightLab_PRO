import pytest
from rest_framework.test import APIClient

from users.services import user_create, email_verify
from users.tokens import generate_email_verification_token


@pytest.fixture
def auth_client(db):
    user = user_create(email="a@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return client


@pytest.mark.django_db
def test_get_and_patch_profile(auth_client):
    resp = auth_client.get("/api/v1/me/profile")
    assert resp.status_code == 200
    assert resp.data["preferred_units"] == "METRIC"

    patched = auth_client.patch("/api/v1/me/profile", {"height_cm": 180, "dominant_stance": "SOUTHPAW"}, format="json")
    assert patched.status_code == 200
    assert patched.data["height_cm"] == 180
    assert patched.data["dominant_stance"] == "SOUTHPAW"


@pytest.mark.django_db
def test_create_and_list_biometrics(auth_client):
    created = auth_client.post("/api/v1/me/biometrics", {"weight_kg": "80.50", "sleep_quality_score": 8}, format="json")
    assert created.status_code == 201

    listed = auth_client.get("/api/v1/me/biometrics")
    assert listed.status_code == 200
    assert len(listed.data) == 1
    assert listed.data[0]["sleep_quality_score"] == 8


@pytest.mark.django_db
def test_biometrics_rejects_bad_sleep_score(auth_client):
    resp = auth_client.post("/api/v1/me/biometrics", {"sleep_quality_score": 99}, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_user_only_sees_own_biometrics(auth_client):
    other = user_create(email="other@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(other))
    from profiles.models import BiometricsLog
    BiometricsLog.objects.create(profile=other.profile, weight_kg=70)

    auth_client.post("/api/v1/me/biometrics", {"weight_kg": "80.00"}, format="json")
    listed = auth_client.get("/api/v1/me/biometrics")
    assert len(listed.data) == 1  # only own
