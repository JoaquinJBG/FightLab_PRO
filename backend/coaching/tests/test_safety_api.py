"""`GET /api/v1/coach/safety`, la puerta 409 y la API del cribado (Task 3.4).

Una prueba de API por fila de la tabla de flags de `docs/safety.md` (spec §8.4):
perfil → endpoint → flags y motivos esperados.
"""
from datetime import date
from unittest import mock

import pytest
from coach.profile import ProfileIncomplete
from django.urls import include, path
from rest_framework.test import APIClient
from rest_framework.views import APIView

from coaching.bridge import reason_texts
from coaching.models import ScreeningEvent
from coaching.services import injury_add, screening_set
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token

from .flag_rows import ADULT_DOB, BOOL_FLAGS, ROWS, TODAY, screening_for

SAFETY = "/api/v1/coach/safety"


def _client_for(email="sf@b.com"):
    user = user_create(email=email, password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": email, "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return user, client


@pytest.fixture
def user_client(db):
    user, client = _client_for()
    profile = user.profile
    profile.date_of_birth = ADULT_DOB
    profile.height_cm = 175
    profile.gender = "MALE"
    profile.save()
    return user, client


@pytest.fixture(autouse=True)
def fixed_today():
    with mock.patch("coaching.safety_views.timezone.localdate", return_value=TODAY):
        yield


def _apply(row, profile):
    for name, value in row.profile.items():
        setattr(profile, name, value)
    profile.save()
    for key, value in screening_for(row).items():
        screening_set(profile, key, value, origin="onboarding")
    for injury in row.injuries:
        injury_add(profile, **injury)


@pytest.mark.parametrize("row", ROWS, ids=lambda r: r.id)
def test_flags_table_row(user_client, row):
    user, client = user_client
    _apply(row, user.profile)
    resp = client.get(SAFETY, HTTP_ACCEPT_LANGUAGE="es")
    assert resp.status_code == 200, resp.data
    data = resp.data
    on = {name for name, value in data["flags"].items() if value}
    assert row.flags <= on, (row.id, on)
    assert set(data["flags"]) == BOOL_FLAGS
    codes = {r["code"] for r in data["reasons"]}
    assert row.codes <= codes, (row.id, codes)
    for reason in data["reasons"]:
        assert reason["rule_key"], reason
        assert reason["text"] and reason["severity"] in ("stop", "refer", "limit")
    assert data["refer_gp"] == ("refer_gp" in row.flags)
    if data["refer_gp"]:
        assert data["deferral_line"] == reason_texts.DEFERRAL_LINE["es"]
    else:
        assert data["deferral_line"] is None
    assert data["disclaimer"] == reason_texts.DISCLAIMER["es"]
    assert data["screened"] is True


def test_injury_rows_pause_the_exercises(user_client):
    user, client = user_client
    _apply(next(r for r in ROWS if r.id == "injury_unassessed"), user.profile)
    data = client.get(SAFETY).data
    assert data["paused_exercises"]["Sentadilla"]["assessed"] is False
    assert data["paused_exercises"]["Sentadilla"]["reasons"][0]["code"] == "injury_unassessed"


def test_texts_follow_the_request_language(user_client):
    user, client = user_client
    _apply(next(r for r in ROWS if r.id == "cardiac"), user.profile)
    es = client.get(SAFETY, HTTP_ACCEPT_LANGUAGE="es").data
    en = client.get(SAFETY, HTTP_ACCEPT_LANGUAGE="en").data
    reason_es = next(r for r in es["reasons"] if r["code"] == "cardiac_symptoms")
    reason_en = next(r for r in en["reasons"] if r["code"] == "cardiac_symptoms")
    assert reason_en["text"].startswith("stop exercising")
    assert reason_es["text"].startswith("deja de hacer ejercicio")
    assert reason_en["professional"] == "clinician" and reason_es["professional"] == "clínico"
    assert en["deferral_line"] == reason_texts.DEFERRAL_LINE["en"]


def test_unscreened_profile(user_client):
    _, client = user_client
    data = client.get(SAFETY).data
    assert data["screened"] is False
    assert data["parq_pending"] is True
    assert data["flags"]["review_before_vigorous"] is True


def test_emergency_number_and_weight(user_client):
    user, client = user_client
    user.profile.region = "es"
    user.profile.save()
    from profiles.models import BiometricsLog

    BiometricsLog.objects.create(profile=user.profile, weight_kg="80.20")
    data = client.get(SAFETY).data
    assert data["emergency_number"] == "112"
    assert data["weight"]["kg"] == 80.2 and data["weight"]["date"]


def test_safety_needs_auth(db):
    assert APIClient().get(SAFETY).status_code == 401


# --- Puerta 409 (spec §8.1): ProfileIncomplete → {"code": "profile_incomplete", "field": …} ---


class _Raises(APIView):
    field = "screening.scoff_yes_count"

    def get(self, request):
        raise ProfileIncomplete(self.field)


class _RaisesSex(_Raises):
    field = "sex"


urlpatterns = [
    path("raises", _Raises.as_view()),
    path("raises-sex", _RaisesSex.as_view()),
    path("", include("core.urls")),  # el login del fixture
]


@pytest.mark.urls("coaching.tests.test_safety_api")
def test_profile_incomplete_is_409(user_client):
    _, client = user_client
    resp = client.get("/raises")
    assert resp.status_code == 409
    assert resp.data == {"code": "profile_incomplete", "field": "screening.scoff_yes_count"}


@pytest.mark.urls("coaching.tests.test_safety_api")
def test_profile_incomplete_names_fightlab_fields(user_client):
    """P7: sin sexo para las ecuaciones, el campo que falta es `equation_sex`."""
    _, client = user_client
    assert client.get("/raises-sex").data == {"code": "profile_incomplete", "field": "equation_sex"}


# --- API del cribado y las lesiones (la usa el onboarding) ---


def test_screening_get_and_patch(user_client, settings):
    user, client = user_client
    settings.PARQ_URL_ES = "https://example.org/parq-es.pdf"
    data = client.get("/api/v1/coach/screening", HTTP_ACCEPT_LANGUAGE="es").data
    assert data["values"]["parq_any_yes"] is None
    assert data["parq_url"] == "https://example.org/parq-es.pdf"
    assert data["parq_native_form"] is False

    resp = client.patch(
        "/api/v1/coach/screening",
        {"values": {"vigorous_reviewed": True, "parq_any_yes": True, "scoff_yes_count": 1}},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    # El PAR-Q+ se guarda antes que la revisión, que si no se borraría al cambiarlo.
    assert resp.data["values"]["vigorous_reviewed"] is True
    assert resp.data["values"]["parq_any_yes"] is True
    events = ScreeningEvent.objects.filter(profile=user.profile)
    assert {e.origin for e in events} == {"onboarding"}
    assert all(e.actor_id == user.id for e in events)


def test_screening_patch_rejects_bad_values(user_client):
    _, client = user_client
    resp = client.patch("/api/v1/coach/screening", {"values": {"scoff_yes_count": 9}}, format="json")
    assert resp.status_code == 400
    resp = client.patch("/api/v1/coach/screening", {"values": {"nope": True}}, format="json")
    assert resp.status_code == 400
    resp = client.patch(
        "/api/v1/coach/screening", {"values": {"cardiac_symptoms": True}, "origin": "x"}, format="json"
    )
    assert resp.status_code == 400


def test_parq_url_in_english(user_client, settings):
    user, client = user_client
    settings.PARQ_URL_EN = "https://example.org/parq-en.pdf"
    assert client.get("/api/v1/coach/screening", HTTP_ACCEPT_LANGUAGE="en").data["parq_url"] == (
        "https://example.org/parq-en.pdf"
    )


def test_parq_native_form_is_off_by_default(settings):
    """Spec §8.1 y §12 (A1): sin permiso escrito de la PAR-Q+ Collaboration, no hay formulario nativo."""
    from django.conf import settings as real

    assert real.PARQ_NATIVE_FORM is False


def test_injuries_api(user_client):
    user, client = user_client
    resp = client.post(
        "/api/v1/coach/injuries",
        {"area": "hombro", "since": "2026-09-01", "exercises": ["Press banca"]},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    injury_id = resp.data["id"]
    assert resp.data["status"] == "active" and resp.data["origin"] == "onboarding"
    assert client.get("/api/v1/coach/injuries").data[0]["area"] == "hombro"

    bad = client.patch(f"/api/v1/coach/injuries/{injury_id}", {"status": "cleared"}, format="json")
    assert bad.status_code == 400  # falta cleared_on
    ok = client.patch(
        f"/api/v1/coach/injuries/{injury_id}", {"status": "cleared", "cleared_on": "2026-10-01"}, format="json"
    )
    assert ok.status_code == 200 and ok.data["status"] == "cleared"

    other, other_client = _client_for("other@b.com")
    assert other_client.delete(f"/api/v1/coach/injuries/{injury_id}").status_code == 404
    assert client.delete(f"/api/v1/coach/injuries/{injury_id}").status_code == 204
    assert client.get("/api/v1/coach/injuries").data == []


def test_injury_before_since_is_rejected(user_client):
    _, client = user_client
    resp = client.post(
        "/api/v1/coach/injuries",
        {"area": "rodilla", "status": "cleared", "since": "2026-09-01", "cleared_on": "2026-08-01"},
        format="json",
    )
    assert resp.status_code == 400


def test_today_is_used_for_age(user_client):
    """La edad sale de la fecha de hoy en el servidor (menor de 18 hasta el cumpleaños)."""
    user, client = user_client
    user.profile.date_of_birth = date(2008, 10, 30)  # cumple 18 el día después de TODAY
    user.profile.save()
    assert client.get(SAFETY).data["flags"]["no_calorie_targets"] is True
