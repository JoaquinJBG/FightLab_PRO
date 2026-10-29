"""Usuarios de prueba con perfil, peso y cribado para los tests de objetivos, zonas y pesaje."""
from datetime import date, datetime, timezone
from unittest import mock

import pytest
from rest_framework.test import APIClient

from coaching.services import injury_add, screening_set
from profiles.models import BiometricsLog
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token

TODAY = date(2026, 10, 29)
# Cribado limpio: SCOFF negativo y PAR-Q+ todo NO (sin flags propios).
CLEAN_SCREENING = {"scoff_yes_count": 0, "scoff_positive": False, "parq_any_yes": False, "parq_followup_yes": False}

_counter = 0


def make_user(
    *,
    profile=None,
    screening=None,
    weight=70.0,
    body_fat=None,
    body_fat_method="",
    body_fat_day=date(2026, 10, 20),
    resting_hr=None,
    injuries=(),
    screened=True,
):
    """Un usuario verificado. `profile` pisa los campos del perfil; `screening` pisa el cribado
    limpio (con `screened=False` no se contesta nada)."""
    global _counter
    _counter += 1
    email = f"t{_counter}@b.com"
    user = user_create(email=email, password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    fields = {
        "date_of_birth": date(1996, 5, 1),
        "height_cm": 175,
        "gender": "MALE",
        "goal": "maintenance",
        "activity_level": "desk_training",
        **(profile or {}),
    }
    p = user.profile
    for name, value in fields.items():
        setattr(p, name, value)
    p.save()
    if screened:
        for key, value in {**CLEAN_SCREENING, **(screening or {})}.items():
            screening_set(p, key, value, origin="onboarding")
    elif screening:
        for key, value in screening.items():
            screening_set(p, key, value, origin="onboarding")
    if weight is not None:
        BiometricsLog.objects.create(
            profile=p,
            weight_kg=weight,
            body_fat_pct=body_fat,
            body_fat_method=body_fat_method if body_fat is not None else "",
            resting_heart_rate=resting_hr,
            timestamp=datetime.combine(body_fat_day, datetime.min.time(), tzinfo=timezone.utc),
        )
    for injury in injuries:
        injury_add(p, **injury)
    return user


def client_for(user) -> APIClient:
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": user.email, "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return client


def fix_today(today=TODAY):
    """Fija «hoy» en la API de coaching (la edad cambia el día del cumpleaños)."""
    return mock.patch("coaching.safety_views.timezone.localdate", return_value=today)


@pytest.fixture
def today_fixed():
    with fix_today():
        yield
