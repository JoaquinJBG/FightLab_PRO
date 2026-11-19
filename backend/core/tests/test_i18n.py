import pytest
from django.utils import translation
from rest_framework.test import APIClient

from core import messages


@pytest.fixture
def client():
    return APIClient()


def _register_invalid(client, lang):
    headers = {"HTTP_ACCEPT_LANGUAGE": lang} if lang else {}
    resp = client.post(
        "/api/v1/auth/register",
        {"email": "not-an-email", "password": "pw-strong-123"},
        format="json",
        **headers,
    )
    assert resp.status_code == 400
    return resp.json()["email"][0]


@pytest.mark.django_db
def test_drf_validation_error_in_english(client):
    assert _register_invalid(client, "en") == "Enter a valid email address."


@pytest.mark.django_db
def test_drf_validation_error_in_spanish(client):
    assert "válida" in _register_invalid(client, "es")


@pytest.mark.django_db
def test_default_language_is_spanish(client):
    assert "válida" in _register_invalid(client, None)


@pytest.mark.django_db
def test_own_message_follows_accept_language(client):
    from django.contrib.auth import get_user_model

    user = get_user_model().objects.create_user(email="x@y.com", password="pw-strong-123")
    client.force_authenticate(user)
    en = client.post("/api/v1/ai/coach/chat", {"messages": "x"}, format="json", HTTP_ACCEPT_LANGUAGE="en")
    es = client.post("/api/v1/ai/coach/chat", {"messages": "x"}, format="json", HTTP_ACCEPT_LANGUAGE="es")
    assert en.status_code == es.status_code == 400
    assert en.json()["detail"] == "Invalid message format."
    assert es.json()["detail"] == "Formato de mensajes inválido."


def test_catalogue_has_same_keys_in_both_languages():
    assert set(messages.MESSAGES["es"]) == set(messages.MESSAGES["en"])


def test_msg_formats_params_and_falls_back_to_spanish():
    with translation.override("en"):
        assert "5" in messages.msg("sync_max_items", n=5)
    with translation.override("fr"):
        assert messages.msg("ai_not_configured") == messages.MESSAGES["es"]["ai_not_configured"]
