import base64
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
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


def make_jpeg_with_exif(size=(3000, 2000)) -> bytes:
    """JPEG con EXIF real (orientación + GPS) para comprobar que el
    procesado del servidor lo elimina."""
    img = Image.new("RGB", size, color=(120, 45, 200))
    exif = img.getexif()
    exif[0x0112] = 6  # Orientation
    gps = {1: "N", 2: (40, 0, 0), 3: "W", 4: (3, 0, 0)}  # bloque GPS mínimo
    exif[0x8825] = gps  # GPSInfo IFD
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    return buf.getvalue()


@pytest.fixture
def auth_client(db):
    return make_client("a@b.com")


@pytest.mark.django_db
def test_upload_and_list_photo(auth_client):
    f = SimpleUploadedFile("frente.png", PNG_1X1, content_type="image/png")
    created = auth_client.post("/api/v1/me/photos", {"image": f}, format="multipart")
    assert created.status_code == 201
    assert created.data["file_url"] == f"/api/v1/me/photos/{created.data['id']}/file"
    assert created.data["taken_at"] is not None
    assert "image" not in created.data

    listed = auth_client.get("/api/v1/me/photos")
    assert listed.status_code == 200
    assert len(listed.data) == 1


@pytest.mark.django_db
def test_upload_requires_image(auth_client):
    resp = auth_client.post("/api/v1/me/photos", {}, format="multipart")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_upload_rejects_non_image_content(auth_client):
    f = SimpleUploadedFile("no-es-foto.png", b"esto no es un PNG", content_type="image/png")
    resp = auth_client.post("/api/v1/me/photos", {"image": f}, format="multipart")
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
def test_upload_compresses_and_strips_exif(auth_client):
    raw = make_jpeg_with_exif(size=(3000, 2000))
    f = SimpleUploadedFile("progreso.jpg", raw, content_type="image/jpeg")
    created = auth_client.post("/api/v1/me/photos", {"image": f}, format="multipart")
    assert created.status_code == 201
    pid = created.data["id"]

    from profiles.models import ProgressPhoto

    photo = ProgressPhoto.objects.get(pk=pid)
    assert photo.content_type == "image/jpeg"
    assert max(photo.width, photo.height) <= 1600  # lado largo redimensionado
    assert len(bytes(photo.data)) < len(raw)  # se comprimió respecto al original

    with Image.open(io.BytesIO(bytes(photo.data))) as stored:
        assert stored.getexif() == {}  # sin EXIF (ni por tanto GPS)


@pytest.mark.django_db
def test_upload_rejects_oversized_pixel_dimensions(auth_client):
    # PNG de color liso: pesa poco (comprime muy bien) pero decodificado son
    # 8000x8000 = 64 megapíxeles, por encima de MAX_INPUT_PIXELS (40 MP). No
    # debe llegar a decodificarse en RGB a resolución completa: eso es lo que
    # antes tumbaba el proceso por RSS en Render free.
    buf = io.BytesIO()
    Image.new("RGB", (8000, 8000), color=(10, 20, 30)).save(buf, format="PNG")
    f = SimpleUploadedFile("gigante.png", buf.getvalue(), content_type="image/png")

    resp = auth_client.post("/api/v1/me/photos", {"image": f}, format="multipart")

    assert resp.status_code == 400
    assert auth_client.get("/api/v1/me/photos").data == []


@pytest.mark.django_db
def test_photo_file_requires_auth():
    client = APIClient()
    resp = client.get("/api/v1/me/photos/1/file")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_photo_file_served_to_owner(auth_client):
    f = SimpleUploadedFile("frente.png", PNG_1X1, content_type="image/png")
    created = auth_client.post("/api/v1/me/photos", {"image": f}, format="multipart")
    pid = created.data["id"]

    resp = auth_client.get(f"/api/v1/me/photos/{pid}/file")
    assert resp.status_code == 200
    assert resp["Content-Type"] == "image/jpeg"
    assert resp["Cache-Control"] == "private, max-age=3600"
    assert len(resp.content) > 0


@pytest.mark.django_db
def test_photos_are_isolated_per_user(auth_client):
    other = make_client("other@b.com")
    f = SimpleUploadedFile("o.png", PNG_1X1, content_type="image/png")
    created = other.post("/api/v1/me/photos", {"image": f}, format="multipart")
    pid = created.data["id"]

    # el primer usuario no la ve, ni puede borrarla ni descargarla
    assert auth_client.get("/api/v1/me/photos").data == []
    assert auth_client.delete(f"/api/v1/me/photos/{pid}").status_code == 404
    assert auth_client.get(f"/api/v1/me/photos/{pid}/file").status_code == 404
