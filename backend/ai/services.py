"""Servicios de IA (Anthropic Claude): chat del coach y análisis de fotos de comida.

La clave vive en el backend (ANTHROPIC_API_KEY); el frontend nunca la ve.
Si no está configurada, los servicios lanzan AIUnavailable y las vistas
responden 503 para que el frontend degrade a su modo por reglas/simulado.
"""
import base64
import json
from dataclasses import dataclass, field

import anthropic
from django.conf import settings

from coaching import citations as chat_tools


class AIUnavailable(Exception):
    """La IA no está configurada (falta ANTHROPIC_API_KEY)."""


class AIBadResponse(Exception):
    """El modelo respondió algo que no se pudo interpretar."""


def _client(timeout: float) -> anthropic.Anthropic:
    if not settings.ANTHROPIC_API_KEY:
        raise AIUnavailable("ANTHROPIC_API_KEY no configurada")
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=timeout, max_retries=1)


# El prompt base se escribe una vez, en inglés, y lleva la instrucción de idioma.
COACH_SYSTEM = """You are the coach of FightLab Pro, a high-performance coach for MMA and combat-sport athletes. Talk like a corner coach: direct, close, short sentences, no filler, about 120 words at most. {language_instruction}

Strict rules:
- Use ONLY the data in the "Athlete context" and what the tools return. If a piece of data is missing, say so and suggest logging it in the app. NEVER invent numbers or trends, and never do your own arithmetic: quote numbers only from the context or from a tool result.
- Every claim or recommendation about training, nutrition, recovery or health must rest on a rule of the evidence base. Look for it with search_rules, read it with get_rule, and cite it in the text as [[regla:key]], using exactly the key a tool returned this turn. Never cite a key the tools did not return, and never write a threshold, dose or "safe range" from memory. If no rule covers the question, say so plainly instead of improvising.
- The training-load figures in the context (weekly load, ACWR, monotony...) are descriptive FightLab data. Report them as this week's load against the athlete's own average. Do not call a value safe or risky, do not give thresholds and do not claim they predict injury.
- You are not a doctor and you give no medical advice: with pain or symptoms, recommend a health professional. For weight cuts before a weigh-in give only general information, never a prescription, and point to a professional team.
- No markdown and no lists: plain prose, one to three sentences per idea."""

LANGUAGE_NAMES = {"es": "Spanish", "en": "English"}
DEFAULT_LANGUAGE = "es"
# Vueltas máximas de herramientas por respuesta (cada una es una llamada más al modelo)
MAX_TOOL_ROUNDS = 4


def language_instruction(language: str | None) -> str:
    name = LANGUAGE_NAMES.get((language or "").split("-")[0], LANGUAGE_NAMES[DEFAULT_LANGUAGE])
    return f"Reply in {name}, whatever language the athlete writes in."


@dataclass
class CoachReply:
    text: str
    citations: list[dict] = field(default_factory=list)


def _block_to_param(block) -> dict:
    if block.type == "tool_use":
        return {"type": "tool_use", "id": block.id, "name": block.name, "input": block.input}
    return {"type": "text", "text": block.text}


def coach_chat(*, messages: list[dict], context: dict, language: str | None = None) -> CoachReply:
    """Chat del coach con el contexto real del atleta y herramientas de evidencia.

    `language`: el idioma del usuario (hoy el de la petición, que fija `LocaleMiddleware`;
    pasará a ser `profile.language` cuando llegue en la fase 3). Las citas `[[regla:clave]]`
    se validan aquí: las que no existen o no salieron en una herramienta se quitan.
    """
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
        COACH_SYSTEM.format(language_instruction=language_instruction(language))
        + "\n\nAthlete context (real app data, today):\n"
        + json.dumps(context, ensure_ascii=False)
    )
    retrieved: set[str] = set()
    convo = list(cleaned)
    for round_ in range(MAX_TOOL_ROUNDS + 1):
        resp = client.messages.create(
            model=settings.AI_MODEL_CHAT,
            max_tokens=500,
            system=system,
            messages=list(convo),
            tools=chat_tools.TOOLS,
        )
        if getattr(resp, "stop_reason", None) != "tool_use":
            break
        if round_ == MAX_TOOL_ROUNDS:
            raise AIBadResponse("Demasiadas vueltas de herramientas")
        convo.append({"role": "assistant", "content": [_block_to_param(b) for b in resp.content]})
        convo.append(
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": b.id,
                        "content": chat_tools.run_tool(b.name, b.input, retrieved),
                    }
                    for b in resp.content
                    if b.type == "tool_use"
                ],
            }
        )
    text = "".join(block.text for block in resp.content if block.type == "text").strip()
    if not text:
        raise AIBadResponse("Respuesta vacía del modelo")
    text, citations = chat_tools.validate_citations(text, retrieved)
    if not text:
        raise AIBadResponse("Respuesta vacía tras quitar las citas inválidas")
    return CoachReply(text=text, citations=citations)


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
