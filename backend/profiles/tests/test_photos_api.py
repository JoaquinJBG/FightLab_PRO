import base64

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from users.services import user_create, email_verify
from users.tokens import generate_email_verification_token

# PNG válido de 1x1 píxel
PNG_1X1 = base64.b64decode(
    b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def make_client(email: str) -> APIClient:
    user = user_create(email=email, password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": email, "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return client


@pytest.fixture
def auth_client(db, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path  # no ensuciar el repo con archivos de test
    return make_client("a@b.com")


@pytest.mark.django_db
def test_upload_and_list_photo(auth_client):
    f = SimpleUploadedFile("frente.png", PNG_1X1, content_type="image/png")
    created = auth_client.post("/api/v1/me/photos", {"image": f}, format="multipart")
    assert created.status_code == 201
    assert created.data["image"].startswith("/media/")
    assert created.data["taken_at"] is not None

    listed = auth_client.get("/api/v1/me/photos")
    assert listed.status_code == 200
    assert len(listed.data) == 1


@pytest.mark.django_db
def test_upload_requires_image(auth_client):
    resp = auth_client.post("/api/v1/me/photos", {}, format="multipart")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_delete_photo(auth_client):
    f = SimpleUploadedFile("frente.png", PNG_1X1, content_type="image/png")
    created = auth_client.post("/api/v1/me/photos", {"image": f}, format="multipart")
    pid = created.data["id"]
    deleted = auth_client.delete(f"/api/v1/me/photos/{pid}")
    assert deleted.status_code == 204
    assert auth_client.get("/api/v1/me/photos").data == []


@pytest.mark.django_db
def test_photos_are_isolated_per_user(auth_client, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    other = make_client("other@b.com")
    f = SimpleUploadedFile("o.png", PNG_1X1, content_type="image/png")
    created = other.post("/api/v1/me/photos", {"image": f}, format="multipart")
    pid = created.data["id"]

    # el primer usuario no la ve ni puede borrarla
    assert auth_client.get("/api/v1/me/photos").data == []
    assert auth_client.delete(f"/api/v1/me/photos/{pid}").status_code == 404
