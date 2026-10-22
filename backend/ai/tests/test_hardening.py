"""Endurecimiento de los endpoints de IA y cuota en la tabla AIUsage."""
import base64
import copy
import datetime
import inspect
import json
import random
import threading
from io import BytesIO
from unittest.mock import patch

import anthropic
import httpx
import pytest
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from PIL import Image, ImageFile
from rest_framework.test import APIClient

from ai import quota, services, views
from ai.models import AIUsage
from ai.tests.test_api import CHAT_PAYLOAD, PNG_1X1, fake_response
from profiles.image_processing import process_progress_photo
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token

FOOD_OK = '{"plato": "Pollo", "items": [{"nombre": "pollo", "gramos": 150, "kcal": 240, "p": 45, "c": 0, "f": 5}], "confianza": "alta", "nota": null}'


@pytest.fixture
def user_and_client(db, settings):
    settings.ANTHROPIC_API_KEY = "sk-test"
    user = user_create(email="wp05@test.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": "wp05@test.com", "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return user, client


def _png(size, mode="RGB") -> bytes:
    buf = BytesIO()
    Image.new(mode, size).save(buf, format="PNG")
    return buf.getvalue()


def _post_food(client, data: bytes, name="comida.png"):
    f = SimpleUploadedFile(name, data, content_type="image/png")
    return client.post("/api/v1/ai/food/analyze", {"image": f}, format="multipart")


def _usage(user, kind):
    return AIUsage.objects.filter(user=user, kind=kind).first()


def _timeout_error() -> anthropic.APITimeoutError:
    return anthropic.APITimeoutError(request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))


# --- Bomba de descompresión ---


@pytest.mark.django_db
def test_png_de_169_megapixeles_se_rechaza_sin_decodificar(user_and_client):
    user, client = user_and_client
    data = _png((13000, 13000), mode="1")
    assert len(data) < 4 * 1024 * 1024
    with patch.object(ImageFile.ImageFile, "load", autospec=True) as load, patch(
        "ai.services.anthropic.Anthropic"
    ) as MockClient:
        resp = _post_food(client, data)
    assert resp.status_code == 400
    assert "demasiados píxeles" in resp.data["detail"]
    load.assert_not_called()
    MockClient.assert_not_called()
    usage = _usage(user, "food")
    assert usage is None or usage.count == 0


@pytest.mark.django_db
def test_png_por_encima_del_tope_no_jpeg_se_rechaza(user_and_client):
    _, client = user_and_client
    resp = _post_food(client, _png((5000, 5000), mode="1"))  # 25 MP > 24 MP (tope sin draft)
    assert resp.status_code == 400
    assert "demasiados píxeles" in resp.data["detail"]


def _jpeg_with_orientation(size, orientation: int) -> bytes:
    img = Image.new("RGB", size, color=(200, 10, 10))
    exif = Image.Exif()
    exif[0x0112] = orientation
    buf = BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def test_la_orientacion_exif_se_aplica_tras_reducir():
    data, _, width, height = process_progress_photo(BytesIO(_jpeg_with_orientation((3200, 1600), 6)))
    assert (width, height) == (800, 1600)  # girada 90° y reducida al lado largo
    with Image.open(BytesIO(data)) as out:
        assert out.size == (800, 1600)
        assert out.getexif() == {}


@pytest.mark.django_db
def test_foto_de_comida_llega_a_la_ia_reorientada(user_and_client):
    _, client = user_and_client
    f = SimpleUploadedFile("c.jpg", _jpeg_with_orientation((400, 200), 6), content_type="image/jpeg")
    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = fake_response(FOOD_OK)
        resp = client.post("/api/v1/ai/food/analyze", {"image": f}, format="multipart")
    assert resp.status_code == 200
    sent = MockClient.return_value.messages.create.call_args.kwargs["messages"][0]["content"][0]["source"]["data"]
    with Image.open(BytesIO(base64.b64decode(sent))) as img:
        assert img.size == (200, 400)


# --- Parser de la foto de comida ---


@pytest.mark.parametrize(
    "text",
    [
        "[]",
        "[{\"nombre\": \"x\"}]",
        '{"items": "x"}',
        '{"kcal": "240 kcal"}',
        '{"plato": "x"}',
        '{"items": [{"nombre": "pollo", "kcal": "mucho"}]}',
        '{"items": [{"nombre": "pollo", "kcal": true}]}',
        '{"items": [{"nombre": "pollo", "kcal": [1]}]}',
        '{"items": [{"nombre": "pollo", "kcal": NaN}]}',
        '{"items": [{"nombre": "pollo", "p": Infinity}]}',
        '{"items": [1, "x", null]}',
        "nada de json",
        "{roto",
    ],
)
def test_parser_rechaza_formas_invalidas_con_aibadresponse(text):
    with pytest.raises(services.AIBadResponse):
        services._parse_food_json(text)


def test_parser_coacciona_textos_numericos_negativos_y_topes():
    out = services._parse_food_json(
        '{"plato": "  Pollo  ", "items": [{"nombre": "pollo", "gramos": "150 g", "kcal": "240 kcal", '
        '"p": "12,6", "c": -5, "f": 1e9}, {"nombre": "agua", "gramos": -1}], "confianza": "rara", "nota": 3}'
    )
    assert out["plato"] == "Pollo"
    assert out["items"][0] == {"nombre": "pollo", "gramos": 150, "kcal": 240, "p": 13, "c": 0, "f": 1000}
    assert out["items"][1] == {"nombre": "agua", "gramos": None, "kcal": 0, "p": 0, "c": 0, "f": 0}
    assert out["confianza"] == "media"
    assert out["nota"] is None


def test_parser_acepta_plato_sin_comida():
    out = services._parse_food_json('{"plato": null, "items": [], "confianza": "baja", "nota": "Es un gato"}')
    assert out == {"plato": None, "items": [], "confianza": "baja", "nota": "Es un gato"}


_FUZZ_ATOMS = [None, True, False, 0, -1, 1.5, 1e308, "", "x", "240 kcal", "-3", "NaN", [], {}, [1], {"a": 1}]


def _random_value(rng: random.Random, depth: int = 0):
    if depth > 2 or rng.random() < 0.5:
        return copy.deepcopy(rng.choice(_FUZZ_ATOMS))
    if rng.random() < 0.5:
        return [_random_value(rng, depth + 1) for _ in range(rng.randint(0, 3))]
    keys = ["plato", "items", "nombre", "gramos", "kcal", "p", "c", "f", "confianza", "nota", "zz"]
    return {k: _random_value(rng, depth + 1) for k in rng.sample(keys, rng.randint(0, len(keys)))}


@pytest.mark.parametrize("seed", range(300))
def test_parser_fuzz_nunca_lanza_otra_excepcion(seed):
    rng = random.Random(seed)
    data = _random_value(rng)
    if isinstance(data, dict) and rng.random() < 0.7:
        # Fuerza ítems con nombre para llegar a la coerción de números.
        data["items"] = [
            {**v, "nombre": "x"} if isinstance(v, dict) else v for v in (_random_value(rng, 1) for _ in range(3))
        ]
    text = json.dumps(data)
    try:
        out = services._parse_food_json(text)
    except services.AIBadResponse:
        return
    assert set(out) == {"plato", "items", "confianza", "nota"}
    for item in out["items"]:
        assert all(isinstance(item[k], int) and item[k] >= 0 for k in ("kcal", "p", "c", "f"))


@pytest.mark.django_db
@pytest.mark.parametrize("text", ["[]", '{"items":"x"}', '{"kcal":"240 kcal"}'])
def test_respuesta_rara_del_modelo_da_502_devuelve_cuota_y_guarda_tokens(user_and_client, text):
    user, client = user_and_client
    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = fake_response(text, input_tokens=900, output_tokens=40)
        resp = _post_food(client, PNG_1X1)
    assert resp.status_code == 502
    assert resp.data["detail"].startswith("La IA no devolvió un análisis válido")
    usage = _usage(user, "food")
    assert usage.count == 0
    assert (usage.input_tokens, usage.output_tokens) == (900, 40)


# --- Timeouts del proveedor y reserva/devolución ---


@pytest.mark.django_db
def test_timeout_del_proveedor_da_504_y_no_consume_cuota(user_and_client):
    user, client = user_and_client
    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.side_effect = _timeout_error()
        resp = client.post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json")
    assert resp.status_code == 504
    assert _usage(user, "chat").count == 0


@pytest.mark.django_db
def test_cliente_usa_timeout_y_reintentos_de_settings(user_and_client, settings):
    _, client = user_and_client
    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = fake_response("Vale.")
        client.post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json")
        MockClient.return_value.messages.create.return_value = fake_response(FOOD_OK)
        _post_food(client, PNG_1X1)
    chat_kwargs, food_kwargs = (c.kwargs for c in MockClient.call_args_list)
    assert chat_kwargs["timeout"] == settings.AI_CHAT_TIMEOUT_S
    assert food_kwargs["timeout"] == settings.AI_VISION_TIMEOUT_S
    assert chat_kwargs["max_retries"] == food_kwargs["max_retries"] == settings.AI_MAX_RETRIES


@pytest.mark.django_db
def test_rechazo_de_imagen_no_consume_cuota(user_and_client):
    user, client = user_and_client
    resp = _post_food(client, b"esto no es un PNG")
    assert resp.status_code == 400
    usage = _usage(user, "food")
    assert usage is None or usage.count == 0


def _run_concurrently(n: int, fn) -> list:
    barrier = threading.Barrier(n)
    results: list = [None] * n

    def worker(i):
        try:
            barrier.wait()
            results[i] = fn()
        except Exception as exc:  # noqa: BLE001 - el test inspecciona el resultado
            results[i] = exc
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


@pytest.mark.django_db(transaction=True)
def test_20_reservas_concurrentes_en_limite_menos_uno_admiten_exactamente_una(settings):
    settings.AI_DAILY_QUOTA_CHAT = 5
    user = get_user_model().objects.create_user(email="race@test.com", password="pw-strong-123")
    AIUsage.objects.create(user=user, kind="chat", date=quota.today(), count=4)

    results = _run_concurrently(20, lambda: quota.reserve(user=user, kind="chat"))

    assert not [r for r in results if isinstance(r, Exception)], results
    assert sum(r is not None for r in results) == 1
    assert AIUsage.objects.get(user=user, kind="chat").count == 5


@pytest.mark.django_db(transaction=True)
def test_20_reservas_concurrentes_sin_fila_previa_crean_una_sola_fila(settings):
    settings.AI_DAILY_QUOTA_FOOD = 1
    user = get_user_model().objects.create_user(email="race2@test.com", password="pw-strong-123")

    results = _run_concurrently(20, lambda: quota.reserve(user=user, kind="food"))

    assert not [r for r in results if isinstance(r, Exception)], results
    assert sum(r is not None for r in results) == 1
    assert AIUsage.objects.filter(user=user, kind="food").count() == 1
    assert AIUsage.objects.get(user=user, kind="food").count == 1


@pytest.mark.django_db(transaction=True)
def test_reservas_y_devoluciones_concurrentes_cuadran(settings):
    settings.AI_DAILY_QUOTA_CHAT = 100
    user = get_user_model().objects.create_user(email="race3@test.com", password="pw-strong-123")

    def reserve_then_refund():
        r = quota.reserve(user=user, kind="chat")
        quota.refund(r)
        return r

    results = _run_concurrently(20, reserve_then_refund)

    assert all(isinstance(r, quota.Reservation) for r in results), results
    assert AIUsage.objects.get(user=user, kind="chat").count == 0


@pytest.mark.django_db
def test_devolucion_va_a_la_fila_reservada_aunque_cambie_el_dia(settings, monkeypatch):
    user = get_user_model().objects.create_user(email="midnight@test.com", password="pw-strong-123")
    r = quota.reserve(user=user, kind="chat")
    monkeypatch.setattr(quota, "today", lambda: datetime.date.today() + datetime.timedelta(days=1))
    quota.reserve(user=user, kind="chat")
    quota.refund(r)
    counts = dict(AIUsage.objects.filter(user=user).values_list("date", "count"))
    assert sorted(counts.values()) == [0, 1]


def test_las_cuotas_no_usan_la_cache():
    for module in (quota, views, services):
        assert "django.core.cache" not in inspect.getsource(module)


# --- Tokens y freno global ---


@pytest.mark.django_db
def test_cada_llamada_con_exito_guarda_los_tokens(user_and_client):
    user, client = user_and_client
    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = fake_response("Vale.", input_tokens=300, output_tokens=50)
        client.post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json")
        client.post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json")
    usage = _usage(user, "chat")
    assert (usage.count, usage.input_tokens, usage.output_tokens) == (2, 600, 100)


@pytest.mark.django_db
def test_freno_global_devuelve_503_y_se_reinicia_al_dia_siguiente(user_and_client, settings, monkeypatch):
    user, client = user_and_client
    settings.AI_GLOBAL_DAILY_TOKEN_BUDGET = 1000
    otro = get_user_model().objects.create_user(email="otro@test.com", password="pw-strong-123")
    AIUsage.objects.create(user=otro, kind="chat", date=quota.today(), count=3, input_tokens=900, output_tokens=100)

    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = fake_response("Vale.")
        chat = client.post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json")
        food = _post_food(client, PNG_1X1)
        assert chat.status_code == food.status_code == 503
        assert chat.data["code"] == food.data["code"] == "budget_daily"
        assert "límite diario del servicio" in chat.data["detail"]
        MockClient.return_value.messages.create.assert_not_called()

        monkeypatch.setattr(quota, "today", lambda: datetime.date.today() + datetime.timedelta(days=1))
        manana = client.post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json")
    assert manana.status_code == 200
    assert _usage(user, "chat").count == 1


def test_admin_muestra_gasto_por_usuario_y_dia():
    model_admin = admin.site._registry[AIUsage]
    assert {"date", "user", "input_tokens", "output_tokens"} <= set(model_admin.list_display)
    assert "date" in model_admin.list_filter


# --- Cuota visible para el cliente ---


@pytest.mark.django_db
def test_endpoint_de_cuota_y_codigo_estable_en_429(user_and_client, settings):
    _, client = user_and_client
    settings.AI_DAILY_QUOTA_CHAT = 2
    settings.AI_DAILY_QUOTA_FOOD = 0  # sin límite
    before = client.get("/api/v1/ai/quota")
    assert before.status_code == 200
    assert before.data["coach"] == {"limit": 2, "used": 0, "remaining": 2}
    assert before.data["photo"] == {"limit": None, "used": 0, "remaining": None}

    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = fake_response("Vale.")
        for _ in range(2):
            assert client.post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json").status_code == 200
        blocked = client.post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json")
    assert blocked.status_code == 429
    assert blocked.data["code"] == "quota_daily"
    assert client.get("/api/v1/ai/quota").data["coach"] == {"limit": 2, "used": 2, "remaining": 0}


def test_endpoint_de_cuota_requiere_auth(db):
    assert APIClient().get("/api/v1/ai/quota").status_code == 401
