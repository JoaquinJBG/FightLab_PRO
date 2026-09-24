"""Servicios de IA (Anthropic Claude): chat del coach y análisis de fotos de comida.

La clave vive en el backend (ANTHROPIC_API_KEY); el frontend nunca la ve.
Si no está configurada, los servicios lanzan AIUnavailable y las vistas
responden 503 para que el frontend degrade a su modo por reglas/simulado.
"""
import base64
import json
import re

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
- ACWR: no hay una zona segura universal igual para todos; interprétalo SIEMPRE frente \
al rango habitual de ESTE atleta (su propia media/tendencia reciente), nunca frente a un \
umbral fijo válido para toda la población. Si sube muy por encima de su rango habitual, hay \
más riesgo de lesión (recomienda bajar volumen); si está claramente por debajo con semana \
activa, hay margen para apretar.
- Si la recuperación está en "cuidado", prioriza técnica suave o descanso aunque la \
carga dé margen.
- Cortes de peso: prudencia siempre; nada de cortes agresivos de agua/sodio sin equipo \
profesional. No eres médico y no das consejo médico: ante dolor o síntomas, recomienda \
profesional sanitario.
- No uses markdown ni listas: responde en texto corrido, 1–3 frases por idea."""

# Preferencias de tono (memoria persistente del atleta, ver `sanitize_coach_memory`):
# instrucción breve que se añade al system prompt para cada valor.
_TONE_INSTRUCTIONS = {
    "directo": "El atleta prefiere que le hables DIRECTO: frases muy cortas, sin rodeos ni adornos, ve al grano.",
    "motivador": "El atleta prefiere un tono MOTIVADOR: cercano, que anime explícitamente, sin dejar de ser honesto con los datos.",
    "tecnico": "El atleta prefiere un tono TÉCNICO: cuando aporte algo, explica brevemente el porqué fisiológico (carga, recuperación) detrás del consejo.",
}
_FREQUENCY_INSTRUCTIONS = {
    "alta": "El atleta quiere avisos frecuentes: no te cortes en señalar cualquier cosa relevante, aunque sea menor.",
    "media": "El atleta quiere una frecuencia de avisos normal: señala lo relevante sin saturar.",
    "baja": "El atleta quiere que le molestes lo mínimo: menciona SOLO lo que de verdad importa (riesgo, lesión, pesaje próximo); omite avisos menores.",
}


def coach_chat(*, messages: list[dict], context: dict, memory: dict | None = None) -> str:
    """Chat del coach con el contexto real del atleta. Devuelve el texto de respuesta.

    `memory` es la memoria persistente del atleta (P0.3), ya sanitizada por
    `sanitize_coach_memory` — lesión activa, fase, fecha de la pelea, objetivo
    de peso y preferencias de tono/frecuencia. Se lee en el servidor a partir
    de `UserState` (clave `coach_memory`), no del cuerpo que manda el cliente.
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
        COACH_SYSTEM
        + "\n\nContexto del atleta (datos reales de la app, hoy):\n"
        + json.dumps(context, ensure_ascii=False)
    )
    if memory:
        system += (
            "\n\nLo que el atleta te ha contado de sí mismo, para que lo recuerdes entre "
            "conversaciones (puede estar incompleto o desactualizado; no lo repitas literal, "
            "úsalo para adaptar tus avisos y tu tono):\n" + json.dumps(memory, ensure_ascii=False)
        )
        tone_note = _TONE_INSTRUCTIONS.get(memory.get("tono"))
        if tone_note:
            system += "\n" + tone_note
        freq_note = _FREQUENCY_INSTRUCTIONS.get(memory.get("frecuencia_avisos"))
        if freq_note:
            system += "\n" + freq_note

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


# --- Memoria persistente del coach (P0.3) ---

_FECHA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TONOS_VALIDOS = frozenset(_TONE_INSTRUCTIONS)
_FRECUENCIAS_VALIDAS = frozenset(_FREQUENCY_INSTRUCTIONS)
MAX_LESION_CHARS = 200
MAX_FASE_CHARS = 120


def sanitize_coach_memory(raw) -> dict:
    """Acota y valida la memoria persistente del atleta antes de meterla en el prompt.

    Se lee del modelo `UserState` (clave `coach_memory`, ver `userstate` app),
    escrito por el propio atleta desde `coach/page.tsx`. Es contenido de
    usuario que llega al system prompt, así que solo se aceptan estos campos
    concretos con sus propios límites de tamaño/formato — nada de texto libre
    sin acotar, para no abrir una vía de inyección de instrucciones al modelo.
    """
    if not isinstance(raw, dict):
        return {}
    out: dict = {}

    lesion = raw.get("lesion")
    if isinstance(lesion, str) and lesion.strip():
        out["lesion"] = lesion.strip()[:MAX_LESION_CHARS]

    fase = raw.get("fase")
    if isinstance(fase, str) and fase.strip():
        out["fase"] = fase.strip()[:MAX_FASE_CHARS]

    fecha_pelea = raw.get("fecha_pelea")
    if isinstance(fecha_pelea, str) and _FECHA_RE.match(fecha_pelea):
        out["fecha_pelea"] = fecha_pelea

    objetivo_peso_kg = raw.get("objetivo_peso_kg")
    if isinstance(objetivo_peso_kg, (int, float)) and not isinstance(objetivo_peso_kg, bool) and 0 < objetivo_peso_kg < 400:
        out["objetivo_peso_kg"] = round(float(objetivo_peso_kg), 1)

    tono = raw.get("tono")
    if tono in _TONOS_VALIDOS:
        out["tono"] = tono

    frecuencia_avisos = raw.get("frecuencia_avisos")
    if frecuencia_avisos in _FRECUENCIAS_VALIDAS:
        out["frecuencia_avisos"] = frecuencia_avisos

    return out


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
