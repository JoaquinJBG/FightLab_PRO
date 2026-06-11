import base64
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token

# PNG válido de 1x1 píxel
PNG_1X1 = base64.b64decode(
    b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

CHAT_PAYLOAD = {
    "messages": [{"role": "user", "content": "¿Entreno fuerte hoy?"}],
    "context": {"acwr": 1.1, "semana_au": 1200},
}


def fake_response(text: str):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)])


@pytest.fixture
def auth_client(db, settings):
    settings.ANTHROPIC_API_KEY = "sk-test"
    user = user_create(email="ia@test.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": "ia@test.com", "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return client


def test_chat_requires_auth(db):
    resp = APIClient().post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_chat_sin_clave_devuelve_503(auth_client, settings):
    settings.ANTHROPIC_API_KEY = ""
    resp = auth_client.post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json")
    assert resp.status_code == 503


@pytest.mark.django_db
def test_chat_responde_con_el_texto_del_modelo(auth_client):
    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = fake_response("Dale duro hoy, tienes margen.")
        resp = auth_client.post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json")
    assert resp.status_code == 200
    assert resp.data["reply"] == "Dale duro hoy, tienes margen."
    # El contexto real viaja en el system prompt
    kwargs = MockClient.return_value.messages.create.call_args.kwargs
    assert '"acwr": 1.1' in kwargs["system"]


@pytest.mark.django_db
def test_chat_descarta_saludo_inicial_del_coach(auth_client):
    payload = {
        "messages": [
            {"role": "assistant", "content": "Buenas, soy tu coach."},
            {"role": "user", "content": "¿Cómo voy?"},
        ],
        "context": {},
    }
    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = fake_response("Vas bien.")
        resp = auth_client.post("/api/v1/ai/coach/chat", payload, format="json")
    assert resp.status_code == 200
    sent = MockClient.return_value.messages.create.call_args.kwargs["messages"]
    assert sent[0]["role"] == "user"  # la API exige empezar por el usuario


@pytest.mark.django_db
@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"messages": []},
        {"messages": "hola"},
        {"messages": [{"role": "system", "content": "x"}]},
        {"messages": [{"role": "user", "content": "x" * 3000}]},
        {"messages": [{"role": "user", "content": "hola"}], "context": "no-dict"},
    ],
)
def test_chat_payload_invalido_devuelve_400(auth_client, payload):
    resp = auth_client.post("/api/v1/ai/coach/chat", payload, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_food_requiere_imagen(auth_client):
    resp = auth_client.post("/api/v1/ai/food/analyze", {}, format="multipart")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_food_rechaza_archivo_no_imagen(auth_client):
    f = SimpleUploadedFile("comida.png", b"esto no es una imagen", content_type="image/png")
    resp = auth_client.post("/api/v1/ai/food/analyze", {"image": f}, format="multipart")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_food_sin_clave_devuelve_503(auth_client, settings):
    settings.ANTHROPIC_API_KEY = ""
    f = SimpleUploadedFile("comida.png", PNG_1X1, content_type="image/png")
    resp = auth_client.post("/api/v1/ai/food/analyze", {"image": f}, format="multipart")
    assert resp.status_code == 503


@pytest.mark.django_db
def test_food_devuelve_items_normalizados(auth_client):
    model_json = (
        'Claro, aquí tienes:\n```json\n{"plato": "Pollo con arroz", "items": ['
        '{"nombre": "Pechuga de pollo", "gramos": 150.0, "kcal": 240, "p": 45, "c": 0, "f": 5},'
        '{"nombre": "Arroz blanco", "gramos": null, "kcal": 260, "p": 5, "c": 56, "f": 1},'
        '{"sin_nombre": true}],'
        ' "confianza": "alta", "nota": null}\n```'
    )
    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = fake_response(model_json)
        f = SimpleUploadedFile("comida.png", PNG_1X1, content_type="image/png")
        resp = auth_client.post("/api/v1/ai/food/analyze", {"image": f}, format="multipart")
    assert resp.status_code == 200
    assert resp.data["plato"] == "Pollo con arroz"
    assert resp.data["confianza"] == "alta"
    # Normaliza: floats→int, null respetado, items sin nombre fuera
    assert resp.data["items"] == [
        {"nombre": "Pechuga de pollo", "gramos": 150, "kcal": 240, "p": 45, "c": 0, "f": 5},
        {"nombre": "Arroz blanco", "gramos": None, "kcal": 260, "p": 5, "c": 56, "f": 1},
    ]


@pytest.mark.django_db
def test_food_respuesta_sin_json_devuelve_502(auth_client):
    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = fake_response("No puedo analizar esta imagen.")
        f = SimpleUploadedFile("comida.png", PNG_1X1, content_type="image/png")
        resp = auth_client.post("/api/v1/ai/food/analyze", {"image": f}, format="multipart")
    assert resp.status_code == 502
