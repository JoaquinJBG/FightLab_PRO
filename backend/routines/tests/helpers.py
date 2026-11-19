"""Usuarios y rutinas de prueba para la app `routines`."""
from rest_framework.test import APIClient

from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token

_counter = 0

FOLDERS = "/api/v1/gym/routine-folders"
ROUTINES = "/api/v1/gym/routines"
PROGRAMS = "/api/v1/gym/programs"
PLAN_ROUTINES = "/api/v1/gym/plan-routines"


def make_client(email: str | None = None):
    """Un usuario verificado y su cliente con sesión. Devuelve `(user, client)`."""
    global _counter
    _counter += 1
    email = email or f"rut{_counter}@test.com"
    user = user_create(email=email, password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": email, "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return user, client


def bench(**over) -> dict:
    """Un ejercicio de rutina válido (press banca, 1 de calentamiento y 3 efectivas)."""
    base = {
        "exercise_key": "cat:barbell-bench-press",
        "name": "Press banca",
        "notes": "Agarre medio",
        "rest_s": 150,
        "superset": None,
        "sets": [
            {"set_type": "warmup", "reps": 10, "reps_max": None, "weight_kg": 40, "rpe": None, "rir": None},
            {"set_type": "normal", "reps": 8, "reps_max": 10, "weight_kg": 70, "rpe": None, "rir": 2},
            {"set_type": "normal", "reps": 8, "reps_max": 10, "weight_kg": 70, "rpe": None, "rir": 2},
            {"set_type": "failure", "reps": 8, "reps_max": None, "weight_kg": 60, "rpe": 10, "rir": None},
        ],
    }
    base.update(over)
    return base


def row(**over) -> dict:
    base = {
        "exercise_key": "cat:barbell-row",
        "name": "Remo con barra",
        "notes": "",
        "rest_s": 120,
        "superset": None,
        "sets": [{"set_type": "normal", "reps": 10, "reps_max": 12, "weight_kg": 50, "rpe": 8, "rir": None}],
    }
    base.update(over)
    return base


def routine_body(**over) -> dict:
    base = {"title": "Torso A", "notes": "Lunes", "folder": None, "exercises": [bench(), row()]}
    base.update(over)
    return base
