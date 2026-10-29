"""Perfil ampliado (spec §6.2): campos del coach y propios de FightLab, e idioma."""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from profiles.models import UserProfile
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token


def _verified(email="a@b.com", **kwargs):
    user = user_create(email=email, password="pw-strong-123", **kwargs)
    email_verify(token=generate_email_verification_token(user))
    return user


@pytest.fixture
def auth_client(db):
    _verified()
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return client


@pytest.mark.django_db
def test_new_fields_are_empty_by_default():
    profile = _verified().profile
    assert profile.equation_sex is None
    assert profile.goal is None
    assert profile.experience is None
    assert profile.activity_level is None
    assert profile.region is None
    assert profile.emergency_number is None
    assert profile.medications == [] and profile.medications_other == []
    assert profile.conditions == [] and profile.conditions_other == []
    assert profile.disciplines == []
    assert profile.language == "es"


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("header", "expected"),
    [("en-GB,en;q=0.9", "en"), ("es-ES,es;q=0.9", "es"), ("fr-FR,fr;q=0.9", "es"), ("", "es")],
)
def test_language_comes_from_accept_language_at_registration(header, expected):
    client = APIClient()
    resp = client.post(
        "/api/v1/auth/register",
        {"email": "n@b.com", "password": "pw-strong-123"},
        format="json",
        HTTP_ACCEPT_LANGUAGE=header,
    )
    assert resp.status_code == 201
    user = get_user_model().objects.get(email="n@b.com")
    email_verify(token=generate_email_verification_token(user))
    user.refresh_from_db()
    assert user.profile.language == expected


@pytest.mark.django_db
def test_patch_extended_profile(auth_client):
    resp = auth_client.patch(
        "/api/v1/me/profile",
        {
            "gender": "OTHER",
            "equation_sex": "female",
            "goal": "recomposition",
            "experience": "novice",
            "activity_level": "desk_training",
            "language": "en",
            "region": "es",
            "emergency_number": "112",
            "medications": ["beta_blocker"],
            "medications_other": ["ibuprofeno"],
            "conditions": ["hypertension"],
            "conditions_other": ["asma"],
            "disciplines": ["MMA", "BJJ"],
            "training_frequency": 4,
            "goal_weight_kg": "70.5",
            "goal_date": "2027-03-01",
            "weight_class": "Ligero (70,3 kg)",
            "weigh_in_at": "2027-03-01T09:00:00Z",
        },
        format="json",
    )
    assert resp.status_code == 200, resp.data
    data = auth_client.get("/api/v1/me/profile").data
    assert data["equation_sex"] == "female"
    assert data["goal"] == "recomposition"
    assert data["language"] == "en"
    assert data["region"] == "es"
    assert data["medications"] == ["beta_blocker"]
    assert data["medications_other"] == ["ibuprofeno"]
    assert data["conditions"] == ["hypertension"]
    assert data["disciplines"] == ["MMA", "BJJ"]
    assert data["training_frequency"] == 4
    assert data["goal_weight_kg"] == "70.50"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "payload",
    [
        {"equation_sex": "other"},  # las ecuaciones solo existen para female y male
        {"goal": "perder"},  # valores antiguos de flp_nutri_goal: se migran en el frontend
        {"experience": "beginner"},
        {"activity_level": "sedentary"},
        {"language": "fr"},
        {"region": "fr"},  # solo regiones con carpeta en el motor
        {"emergency_number": "1"},
        {"emergency_number": "1234567"},
        {"emergency_number": "11a"},
        {"medications": ["ibuprofeno"]},  # los tokens solo; el resto va en medications_other
        {"conditions": ["asma"]},
        {"training_frequency": 15},
    ],
)
def test_patch_rejects_invalid_values(auth_client, payload):
    resp = auth_client.patch("/api/v1/me/profile", payload, format="json")
    assert resp.status_code == 400, (payload, resp.data)


@pytest.mark.django_db
def test_screening_answers_are_not_profile_fields():
    """El cribado vive en `coaching.Screening`, no en el perfil."""
    names = {f.name for f in UserProfile._meta.get_fields()}
    assert "scoff_yes_count" not in names and "parq_any_yes" not in names
