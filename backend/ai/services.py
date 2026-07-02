"""Servicios de IA (Anthropic Claude): chat del coach y análisis de fotos de comida.

La clave vive en el backend (ANTHROPIC_API_KEY); el frontend nunca la ve.
Si no está configurada, los servicios lanzan AIUnavailable y las vistas
responden 503 para que el frontend degrade a su modo por reglas/simulado.
"""
import base64
import json

import anthropic
from django.conf import settings


class AIUnavailable(Exception):
    """La IA no está configurada (falta ANTHROPIC_API_KEY)."""


class AIBadResponse(Exception):
    """El modelo respondió algo que no se pudo interpretar."""


def _client(timeout: float) -> anthropic.Anthropic:
    if not settings.ANTHROPIC_API_KEY:
        raise AIUnavailable("ANTHROPIC_API_KEY no configurada")
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=timeout, max_retries=1)


COACH_SYSTEM = """Eres el coach de FightLab Pro, un entrenador de alto rendimiento para \
atletas de MMA y deportes de combate. Hablas en español, de tú, directo y cercano, \
como un coach de esquina: frases cortas, sin relleno, máximo ~120 palabras.

Reglas estrictas:
- Usa SOLO los datos del "Contexto del atleta". Si un dato no está, dilo y sugiere \
registrarlo en la app. NUNCA inventes números ni tendencias.
- ACWR: zona segura 0.8–1.3; por encima, riesgo de lesión (recomienda bajar volumen); \
por debajo con semana activa, hay margen para apretar.
- Si la recuperación está en "cuidado", prioriza técnica suave o descanso aunque la \
carga dé margen.
- Cortes de peso: prudencia siempre; nada de cortes agresivos de agua/sodio sin equipo \
profesional. No eres médico y no das consejo médico: ante dolor o síntomas, recomienda \
profesional sanitario.
- No uses markdown ni listas: responde en texto corrido, 1–3 frases por idea."""


def coach_chat(*, messages: list[dict], context: dict) -> str:
    """Chat del coach con el contexto real del atleta. Devuelve el texto de respuesta."""
    client = _client(timeout=30.0)

    # La API exige que el primer mensaje sea del usuario: descarta saludos previos del coach
    cleaned = [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str) and m["content"].strip()
    ]
    while cleaned and cleaned[0]["role"] != "user":
        cleaned.pop(0)
    if not cleaned:
        raise AIBadResponse("Sin mensajes de usuario")

    system = (
        COACH_SYSTEM
        + "\n\nContexto del atleta (datos reales de la app, hoy):\n"
        + json.dumps(context, ensure_ascii=False)
    )
    resp = client.messages.create(
        model=settings.AI_MODEL_CHAT,
        max_tokens=500,
        system=system,
        messages=cleaned,
    )
    text = "".join(block.text for block in resp.content if block.type == "text").strip()
    if not text:
        raise AIBadResponse("Respuesta vacía del modelo")
    return text


FOOD_SYSTEM = """Eres un nutricionista deportivo experto en estimar comidas a partir de fotos. \
Identifica los alimentos del plato y estima raciones en gramos, kcal y macros (proteína, \
carbohidratos, grasa) por componente. Sé realista con los tamaños de ración visibles.

Responde SOLO con un JSON válido, sin texto adicional ni markdown, con esta forma exacta:
{"plato": "nombre corto del plato", "items": [{"nombre": "alimento", "gramos": 150, \
"kcal": 240, "p": 45, "c": 0, "f": 5}], "confianza": "alta|media|baja", "nota": null}

- "gramos" puede ser null si no aplica (p. ej. bebidas, salsas difusas).
- "p"/"c"/"f" son gramos enteros de proteína/carbohidratos/grasa.
- Si en la foto NO hay comida reconocible, devuelve {"plato": null, "items": [], \
"confianza": "baja", "nota": "explica brevemente qué ves"}."""


def food_photo_analyze(*, image_bytes: bytes, media_type: str) -> dict:
    """Analiza una foto de comida y devuelve {plato, items[], confianza, nota}."""
    client = _client(timeout=60.0)
    resp = client.messages.create(
        model=settings.AI_MODEL_VISION,
        max_tokens=1000,
        system=FOOD_SYSTEM,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": base64.b64encode(image_bytes).decode(),
                        },
                    },
                    {"type": "text", "text": "Analiza este plato y devuelve el JSON."},
                ],
            }
        ],
    )
    text = "".join(block.text for block in resp.content if block.type == "text")
    return _parse_food_json(text)


def _parse_food_json(text: str) -> dict:
    """Extrae y valida el JSON del modelo (tolera vallas de código y texto alrededor)."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise AIBadResponse("La IA no devolvió JSON")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise AIBadResponse("JSON inválido de la IA") from exc

    items = []
    for it in data.get("items") or []:
        if not isinstance(it, dict) or not it.get("nombre"):
            continue
        gramos = it.get("gramos")
        items.append(
            {
                "nombre": str(it["nombre"])[:80],
                "gramos": int(gramos) if isinstance(gramos, (int, float)) and gramos > 0 else None,
                "kcal": max(0, int(it.get("kcal") or 0)),
                "p": max(0, int(it.get("p") or 0)),
                "c": max(0, int(it.get("c") or 0)),
                "f": max(0, int(it.get("f") or 0)),
            }
        )
    confianza = data.get("confianza")
    return {
        "plato": str(data["plato"])[:80] if data.get("plato") else None,
        "items": items,
        "confianza": confianza if confianza in ("alta", "media", "baja") else "media",
        "nota": str(data["nota"])[:200] if data.get("nota") else None,
    }
