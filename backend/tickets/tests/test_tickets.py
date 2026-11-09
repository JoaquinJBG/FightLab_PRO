"""Fase 12: fotos de tickets en R2. En las pruebas, siempre el almacenamiento falso en memoria
(`conftest._tickets_in_memory`): ninguna llamada a R2."""
import io
from urllib.parse import parse_qs, urlparse

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image

from coaching.tests.helpers import client_for, make_user
from tickets import services
from tickets.models import TicketPhoto
from tickets.storage import MemoryStorage, R2Storage, get_storage

pytestmark = pytest.mark.django_db

URL = "/api/v1/coach/tickets"


def jpeg(size=(800, 1200), gps=True) -> bytes:
    img = Image.new("RGB", size, (240, 240, 230))
    out = io.BytesIO()
    exif = Image.Exif()
    if gps:
        exif[0x8825] = {1: "N", 2: (36.0, 43.0, 0.0)}  # GPSInfo inventado
    exif[0x010F] = "Movil de prueba"
    img.save(out, format="JPEG", exif=exif.tobytes())
    return out.getvalue()


def post(user, raw: bytes, name="ticket.jpg", **extra):
    return client_for(user).post(URL, {"image": SimpleUploadedFile(name, raw, "image/jpeg"), **extra}, format="multipart")


def test_upload_list_signed_url_and_delete(django_capture_on_commit_callbacks):
    user = make_user()
    resp = post(user, jpeg(), taken_on="2026-10-28", note="Súper del sábado")
    assert resp.status_code == 201, resp.json()
    ticket = TicketPhoto.objects.get(pk=resp.json()["id"])
    assert ticket.key.startswith(f"tickets/{user.profile.pk}/") and ticket.note == "Súper del sábado"
    data, content_type = MemoryStorage.objects[ticket.key]
    assert content_type == "image/jpeg" and len(data) == ticket.size
    stored = Image.open(io.BytesIO(data))
    assert not stored.getexif()  # sin EXIF ni GPS: el backend la vuelve a codificar
    client = client_for(user)
    listing = client.get(URL).json()
    assert listing["enabled"] is True and [t["id"] for t in listing["tickets"]] == [ticket.id]
    assert "key" not in listing["tickets"][0]
    signed = client.get(f"{URL}/{ticket.id}/url")
    assert signed.status_code == 200 and signed["Cache-Control"] == "private, no-store"
    assert signed.json()["expires_in"] == 600 and ticket.key in signed.json()["url"]
    with django_capture_on_commit_callbacks(execute=True):
        assert client.delete(f"{URL}/{ticket.id}").status_code == 204
    assert ticket.key not in MemoryStorage.objects and not TicketPhoto.objects.exists()


def test_only_the_owner_sees_or_deletes_a_ticket():
    owner, other = make_user(), make_user()
    ticket_id = post(owner, jpeg()).json()["id"]
    client = client_for(other)
    assert client.get(f"{URL}/{ticket_id}/url").status_code == 404
    assert client.delete(f"{URL}/{ticket_id}").status_code == 404
    assert client.get(URL).json()["tickets"] == []


def test_deleting_the_account_deletes_every_photo(django_capture_on_commit_callbacks):
    user = make_user()
    keys = [TicketPhoto.objects.get(pk=post(user, jpeg()).json()["id"]).key for _ in range(2)]
    assert all(k in MemoryStorage.objects for k in keys)
    with django_capture_on_commit_callbacks(execute=True):
        user.delete()
    assert not any(k in MemoryStorage.objects for k in keys)


def test_too_large_and_not_an_image_are_refused():
    user = make_user()
    big = post(user, b"\xff\xd8" + b"0" * (services.MAX_UPLOAD_BYTES + 1))
    assert big.status_code == 413 and big.json()["code"] == "ticket_too_large"
    bad = post(user, b"esto no es una foto", name="x.jpg")
    assert bad.status_code == 400 and bad.json()["code"] == "ticket_not_image"
    assert not MemoryStorage.objects


def test_a_plan_of_another_user_is_not_accepted():
    from coaching.models import MealPlan

    owner, other = make_user(), make_user()
    plan = MealPlan.objects.create(profile=owner.profile, start_date="2026-11-02")
    assert post(other, jpeg(), plan=plan.id).status_code == 404
    ok = post(owner, jpeg(), plan=plan.id)
    assert ok.status_code == 201 and ok.json()["plan_id"] == plan.id
    assert client_for(owner).get(f"{URL}?plan={plan.id}").json()["tickets"][0]["plan_id"] == plan.id


@override_settings(TICKETS_STORAGE="r2", R2_ACCOUNT_ID="", R2_ACCESS_KEY_ID="", R2_SECRET_ACCESS_KEY="", R2_BUCKET="")
def test_without_r2_variables_upload_is_off_and_the_app_is_told():
    user = make_user()
    assert get_storage() is None
    assert client_for(user).get(URL).json()["enabled"] is False
    resp = post(user, jpeg())
    assert resp.status_code == 503 and resp.json()["code"] == "tickets_not_configured"


@override_settings(TICKETS_STORAGE="r2", R2_ACCOUNT_ID="abc123", R2_ACCESS_KEY_ID="AKIAFAKE", R2_SECRET_ACCESS_KEY="fake-secret",
                   R2_BUCKET="fightlab-tickets", R2_SIGNED_URL_SECONDS=300)
def test_r2_client_signs_urls_for_the_private_bucket_without_calling_r2():
    storage = get_storage()
    assert isinstance(storage, R2Storage)
    url = storage.signed_url("tickets/1/x.jpg", 300)  # firmar es local: no hay red
    parsed = urlparse(url)
    assert parsed.netloc in ("abc123.r2.cloudflarestorage.com", "fightlab-tickets.abc123.r2.cloudflarestorage.com")
    query = parse_qs(parsed.query)
    assert query["X-Amz-Expires"] == ["300"] and "X-Amz-Signature" in query


def test_admin_is_warned_once_when_usage_crosses_80_percent(django_user_model):
    django_user_model.objects.create_superuser(email="admin@example.test", password="pw-strong-123")
    limit = int(services.FREE_TIER_BYTES * services.ALERT_SHARE)
    assert services.alert_admins(limit - 10, limit - 1) is False
    assert services.alert_admins(limit - 10, limit + 10) is True
    assert services.alert_admins(limit + 10, limit + 20) is False
    assert len(mail.outbox) == 1 and mail.outbox[0].to == ["admin@example.test"]
