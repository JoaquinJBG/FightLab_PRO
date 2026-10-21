"""Smoke contra la API real de Anthropic: comprueba que los ids de modelo
configurados (AI_MODEL_CHAT / AI_MODEL_VISION) responden. Opt-in: se salta sin
RUN_LIVE_SMOKE=1 (y ANTHROPIC_API_KEY): settings carga el .env en el entorno, así
que la clave sola no basta para evitar llamadas reales en un pytest normal."""
import os

import anthropic
import pytest
from django.conf import settings

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE_SMOKE") != "1" or not API_KEY,
    reason="smoke en vivo: requiere RUN_LIVE_SMOKE=1 y ANTHROPIC_API_KEY",
)


@pytest.mark.parametrize("setting_name", ["AI_MODEL_CHAT", "AI_MODEL_VISION"])
def test_configured_model_responds(setting_name):
    model = getattr(settings, setting_name)
    client = anthropic.Anthropic(api_key=API_KEY, timeout=30.0, max_retries=1)
    resp = client.messages.create(
        model=model,
        max_tokens=16,
        messages=[{"role": "user", "content": "Responde solo: ok"}],
    )
    assert resp.content, f"{setting_name}={model} no devolvió contenido"
