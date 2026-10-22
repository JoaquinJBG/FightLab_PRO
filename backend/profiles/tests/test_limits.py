import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from profiles.models import BiometricsLog, ProgressPhoto, UserProfile
from profiles.tests.test_photos_api import PNG_1X1, make_client

URL = "/api/v1/me/biometrics"


@pytest.fixture
def client(db):
    return make_client("lim@test.com")


@pytest.mark.parametrize(
    "field,bad",
    [
        ("weight_kg", -5), ("weight_kg", 19.9), ("weight_kg", 301),
        ("body_fat_pct", 1.9), ("body_fat_pct", 70.5),
        ("waist_cm", 9), ("hip_cm", 251), ("chest_cm", 0), ("arm_cm", 500),
        ("thigh_cm", 9.9), ("neck_cm", 251),
        ("resting_heart_rate", 10), ("resting_heart_rate", 400),
        ("hrv_ms", 0), ("hrv_ms", 20000),
    ],
)
def test_out_of_range_values_are_rejected(client, field, bad):
    resp = client.post(URL, {field: bad}, format="json")
    assert resp.status_code == 400
    assert field in str(resp.data)
    assert BiometricsLog.objects.count() == 0


@pytest.mark.parametrize(
    "payload",
    [
        {"weight_kg": 20, "body_fat_pct": 2, "waist_cm": 10, "resting_heart_rate": 25, "hrv_ms": 1},
        {"weight_kg": 300, "body_fat_pct": 70, "hip_cm": 250, "resting_heart_rate": 250, "hrv_ms": 500},
        {"weight_kg": 82.5, "body_fat_pct": 14.2},
    ],
)
def test_in_range_values_are_accepted(client, payload):
    assert client.post(URL, payload, format="json").status_code == 201


def test_manual_entry_ignores_client_source_and_payload(client):
    resp = client.post(
        URL,
        {"weight_kg": 80, "source": "GARMIN", "external_id": "x", "raw_payload": {"a": "b" * 100_000}},
        format="json",
    )
    assert resp.status_code == 201
    log = BiometricsLog.objects.get()
    assert log.source == "MANUAL"
    assert log.external_id is None
    assert log.raw_payload is None


def test_existing_out_of_range_row_still_readable(client):
    profile = UserProfile.objects.get()
    BiometricsLog.objects.bulk_create([BiometricsLog(profile=profile, weight_kg=999, timestamp="2024-01-01T00:00:00Z")])
    resp = client.get(URL)
    assert resp.status_code == 200
    assert float(resp.data[0]["weight_kg"]) == 999


def test_photo_count_is_capped(client, monkeypatch):
    monkeypatch.setattr("profiles.views.MAX_PHOTOS_PER_USER", 2)
    for _ in range(2):
        up = SimpleUploadedFile("a.png", PNG_1X1, content_type="image/png")
        assert client.post("/api/v1/me/photos", {"image": up}, format="multipart").status_code == 201
    up = SimpleUploadedFile("a.png", PNG_1X1, content_type="image/png")
    resp = client.post("/api/v1/me/photos", {"image": up}, format="multipart")
    assert resp.status_code == 400
    assert ProgressPhoto.objects.count() == 2
