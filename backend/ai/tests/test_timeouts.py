"""Presupuestos de tiempo de la IA y configuración de la caché de throttles."""
import re
from pathlib import Path

import pytest

from core import settings as project_settings

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROXY_ROUTE = BACKEND_DIR.parent / "frontend" / "app" / "api" / "proxy" / "[...path]" / "route.ts"


def test_timeout_del_proveedor_menor_que_bff_menor_que_gunicorn():
    s = project_settings
    worst_chat = s.AI_CHAT_TIMEOUT_S * (1 + s.AI_MAX_RETRIES)
    worst_vision = s.AI_VISION_TIMEOUT_S * (1 + s.AI_MAX_RETRIES)
    assert max(worst_chat, worst_vision) < s.BFF_REQUEST_DEADLINE_S < s.BFF_MAX_DURATION_S < s.GUNICORN_TIMEOUT_S


def test_gunicorn_timeout_coincide_con_el_dockerfile():
    dockerfile = (BACKEND_DIR / "Dockerfile").read_text(encoding="utf-8")
    match = re.search(r"--timeout (\d+)", dockerfile)
    assert match and int(match.group(1)) == project_settings.GUNICORN_TIMEOUT_S


def test_presupuesto_del_bff_coincide_con_el_proxy():
    if not PROXY_ROUTE.exists():  # imagen Docker: solo contiene backend/
        pytest.skip("frontend no disponible")
    route = PROXY_ROUTE.read_text(encoding="utf-8")
    max_duration = re.search(r"export const maxDuration = (\d+);", route)
    deadline = re.search(r"const DEADLINE_MS = ([\d_]+);", route)
    assert max_duration and int(max_duration.group(1)) == project_settings.BFF_MAX_DURATION_S
    assert deadline and int(deadline.group(1).replace("_", "")) == project_settings.BFF_REQUEST_DEADLINE_S * 1000


def test_cache_de_throttles_no_poda_contadores_vivos():
    options = project_settings.CACHES["default"].get("OPTIONS", {})
    assert options.get("MAX_ENTRIES", 300) >= 10_000
