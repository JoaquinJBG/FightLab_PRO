"""Smoke contra la API real de Anthropic: comprueba que los ids de modelo
configurados (AI_MODEL_CHAT / AI_MODEL_VISION) responden. Opt-in: se salta sin
ANTHROPIC_API_KEY en el entorno, así que no corre en el CI por defecto."""
import os

import anthropic
import pytest
from django.conf import settings

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

pytestmark = pytest.mark.skipif(not API_KEY, reason="ANTHROPIC_API_KEY no definida")


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
