"""`BiometricsLog.body_fat_method` (U04): cómo se midió la grasa corporal."""
import pytest
from rest_framework.test import APIClient

from coaching.bridge import energy_athletes
from coaching.tests.helpers import client_for, make_user
from profiles.models import BODY_FAT_METHODS

pytestmark = pytest.mark.django_db


def test_the_choices_match_the_bridge():
    assert tuple(v for v, _ in BODY_FAT_METHODS) == energy_athletes.BODY_FAT_METHODS
    assert set(energy_athletes.RELIABLE_BODY_FAT_METHODS) < set(energy_athletes.BODY_FAT_METHODS)


def test_the_method_is_saved_and_returned():
    client = client_for(make_user(weight=None))
    resp = client.post("/api/v1/me/biometrics", {"body_fat_pct": "14.5", "body_fat_method": "dxa"}, format="json")
    assert resp.status_code == 201
    assert resp.data["body_fat_method"] == "dxa"
    assert client.get("/api/v1/me/biometrics").data[0]["body_fat_method"] == "dxa"


def test_the_method_is_optional_and_empty_by_default():
    client = client_for(make_user(weight=None))
    resp = client.post("/api/v1/me/biometrics", {"body_fat_pct": "20"}, format="json")
    assert resp.status_code == 201 and resp.data["body_fat_method"] == ""


def test_an_unknown_method_is_rejected():
    client = client_for(make_user(weight=None))
    resp = client.post("/api/v1/me/biometrics", {"body_fat_pct": "20", "body_fat_method": "magic"}, format="json")
    assert resp.status_code == 400
