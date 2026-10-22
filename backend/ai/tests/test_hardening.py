"""Endurecimiento de los endpoints de IA y cuota en la tabla AIUsage."""
import base64
import copy
import datetime
import inspect
import json
import os
import random
import struct
import subprocess
import sys
import threading
from io import BytesIO
from pathlib import Path
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
from profiles.image_processing import UnsupportedImageError, load_bounded, process_progress_photo, webp_size
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token

BACKEND_DIR = Path(__file__).resolve().parents[2]
FOOD_OK ='{"plato": "Pollo", "items": [{"nombre": "pollo", "gramos": 150, "kcal": 240, "p": 45, "c": 0, "f": 5}], "confianza": "alta", "nota": null}'


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
    resp = _post_food(client, _png((3500, 3500), mode="1"))  # 12,25 MP > 12 MP (tope sin draft)
    assert resp.status_code == 400
    assert "demasiados píxeles" in resp.data["detail"]


def _webp(size, mode="RGB", **kwargs) -> bytes:
    buf = BytesIO()
    Image.new(mode, size).save(buf, format="WEBP", **kwargs)
    return buf.getvalue()


def _vp8x_header(width: int, height: int) -> bytes:
    payload = b"\x00" * 4 + (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(3, "little")
    chunk = b"VP8X" + len(payload).to_bytes(4, "little") + payload
    body = b"WEBP" + chunk + b"\x00" * 64
    return b"RIFF" + len(body).to_bytes(4, "little") + body


@pytest.mark.parametrize(
    "mode,kwargs",
    [("RGB", {}), ("RGB", {"lossless": True}), ("RGBA", {}), ("RGBA", {"lossless": True})],
    ids=["vp8", "vp8l", "vp8x", "vp8l-alpha"],
)
@pytest.mark.parametrize("size", [(1, 1), (37, 23), (16383, 2)])
def test_cabecera_webp_coincide_con_pillow(size, mode, kwargs):
    data = _webp(size, mode, **kwargs)
    assert webp_size(data[:30]) == size == Image.open(BytesIO(data)).size


def test_webp_gigante_se_rechaza_por_cabecera_sin_abrirlo():
    with patch("profiles.image_processing.Image.open") as open_spy, pytest.raises(UnsupportedImageError):
        load_bounded(BytesIO(_vp8x_header(13000, 13000)), max_side=1568)
    open_spy.assert_not_called()


def test_webp_con_cabecera_desconocida_se_rechaza_sin_abrirlo():
    data = b"RIFF" + (100).to_bytes(4, "little") + b"WEBPVP8 " + b"\x00" * 40
    with patch("profiles.image_processing.Image.open") as open_spy, pytest.raises(UnsupportedImageError):
        load_bounded(BytesIO(data), max_side=1568)
    open_spy.assert_not_called()


@pytest.mark.django_db
@pytest.mark.parametrize("url", ["/api/v1/ai/food/analyze", "/api/v1/me/photos"])
def test_webp_gigante_da_400_en_los_dos_endpoints(user_and_client, url):
    user, client = user_and_client
    f = SimpleUploadedFile("bomba.webp", _vp8x_header(13000, 13000), content_type="image/webp")
    resp = client.post(url, {"image": f}, format="multipart")
    assert resp.status_code == 400
    usage = _usage(user, "food")
    assert usage is None or usage.count == 0


@pytest.mark.django_db
def test_webp_normal_se_acepta(user_and_client):
    _, client = user_and_client
    f = SimpleUploadedFile("c.webp", _webp((800, 600)), content_type="image/webp")
    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = fake_response(FOOD_OK)
        resp = client.post("/api/v1/ai/food/analyze", {"image": f}, format="multipart")
    assert resp.status_code == 200


# Pico de memoria medido en un proceso limpio: dentro de pytest el pico ya está inflado.
_MEMORY_PROBE = r"""
import ctypes, sys

def peak_mb():
    if sys.platform == "win32":
        from ctypes import wintypes

        class PMC(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in (
                    "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
                    "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")
            ]

        pmc = PMC()
        pmc.cb = ctypes.sizeof(PMC)
        kernel32 = ctypes.windll.kernel32
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi = ctypes.windll.psapi
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
        psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb)
        return pmc.PeakPagefileUsage / 2**20  # memoria comprometida: cuenta también lo no tocado
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024

from profiles.image_processing import UnsupportedImageError, load_bounded

before = peak_mb()
try:
    with open(sys.argv[1], "rb") as f:
        load_bounded(f, max_side=1568)
    outcome = "accepted"
except UnsupportedImageError:
    outcome = "rejected"
print(outcome, round(peak_mb() - before))
"""


def run_memory_probe(path, pythonpath=BACKEND_DIR) -> tuple[str, int]:
    env = {**os.environ, "PYTHONPATH": str(pythonpath)}
    out = subprocess.run(
        [sys.executable, "-c", _MEMORY_PROBE, str(path)],
        cwd=pythonpath,  # con -c el directorio actual va antes que PYTHONPATH en sys.path
        env=env,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    return out[0], int(out[1])


@pytest.mark.parametrize("kwargs", [{}, {"lossless": True}], ids=["vp8", "vp8l"])
def test_webp_real_de_25_megapixeles_se_rechaza_sin_reservar_memoria(tmp_path, kwargs):
    path = tmp_path / "grande.webp"
    path.write_bytes(_webp((5000, 5000), **kwargs))  # decodificado serían >= 75 MB
    outcome, growth_mb = run_memory_probe(path)
    assert outcome == "rejected"
    assert growth_mb < 32


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
        '{"items": [{"nombre": "\\ud800", "kcal": 1}]}',  # solo un surrogate: no queda nombre
        '{"items": [{"nombre": "pollo", "kcal": ' + "9" * 400 + "}]}",
        '{"items": [{"nombre": "pollo", "kcal": ' + "9" * 5000 + "}]}",
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


_FUZZ_ATOMS = [
    None, True, False, 0, -1, 1.5, 1e308, 10**400, "9" * 400, "", "x", "\ud800", "240 kcal", "-3", "NaN",
    [], {}, [1], {"a": 1},
]


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
    assert chat_kwargs["timeout"].read == settings.AI_CHAT_TIMEOUT_S
    assert food_kwargs["timeout"].read == settings.AI_VISION_TIMEOUT_S
    for kwargs in (chat_kwargs, food_kwargs):
        assert kwargs["timeout"].connect == kwargs["timeout"].pool == settings.AI_CONNECT_TIMEOUT_S
        assert kwargs["timeout"].write == settings.AI_WRITE_TIMEOUT_S
    assert chat_kwargs["max_retries"] == food_kwargs["max_retries"] == settings.AI_MAX_RETRIES


@pytest.mark.django_db
@pytest.mark.parametrize("exc", [struct.error("unpack"), IndexError("x"), TypeError("x"), KeyError("x")])
def test_errores_raros_de_pillow_dan_400_no_500(user_and_client, exc):
    _, client = user_and_client
    with patch("ai.views.load_bounded", side_effect=exc):
        resp = _post_food(client, PNG_1X1)
    assert resp.status_code == 400
    assert resp.data["detail"] == "El archivo no es una imagen válida."


@pytest.mark.django_db
def test_error_inesperado_tras_reservar_devuelve_la_unidad(user_and_client):
    user, client = user_and_client
    client.raise_request_exception = False
    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.side_effect = RuntimeError("boom")
        chat = client.post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json")
        food = _post_food(client, PNG_1X1)
    assert chat.status_code == food.status_code == 500
    assert _usage(user, "chat").count == 0
    assert _usage(user, "food").count == 0


@pytest.mark.django_db
def test_surrogate_suelto_del_modelo_no_rompe_la_respuesta(user_and_client):
    user, client = user_and_client
    food_text = '{"plato": "Po\\ud800llo", "items": [{"nombre": "a\\ud800b", "kcal": 1}], "nota": "\\udfff"}'
    with patch("ai.services.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = fake_response("Va\ud800le.")
        chat = client.post("/api/v1/ai/coach/chat", CHAT_PAYLOAD, format="json")
        MockClient.return_value.messages.create.return_value = fake_response(food_text)
        food = _post_food(client, PNG_1X1)
    assert chat.status_code == 200
    assert chat.json()["reply"] == "Vale."
    assert food.status_code == 200
    body = food.json()
    assert (body["plato"], body["items"][0]["nombre"], body["nota"]) == ("Pollo", "ab", None)
    assert _usage(user, "chat").count == _usage(user, "food").count == 1


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
