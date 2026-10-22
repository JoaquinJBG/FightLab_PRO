"""Servicios de IA (Anthropic Claude): chat del coach y análisis de fotos de comida.

La clave vive en el backend (ANTHROPIC_API_KEY); el frontend nunca la ve.
Si no está configurada, los servicios lanzan AIUnavailable y las vistas
responden 503 para que el frontend degrade a su modo por reglas/simulado.
"""
import base64
import json
import math
import re
from collections.abc import Callable

import anthropic
import httpx
from django.conf import settings


class AIUnavailable(Exception):
    """La IA no está configurada (falta ANTHROPIC_API_KEY)."""


class AIBadResponse(Exception):
    """El modelo respondió algo que no se pudo interpretar."""


UsageSink = Callable[[int, int], None]


def _client(timeout: float) -> anthropic.Anthropic:
    if not settings.ANTHROPIC_API_KEY:
        raise AIUnavailable("ANTHROPIC_API_KEY no configurada")
    phase_timeouts = httpx.Timeout(
        connect=settings.AI_CONNECT_TIMEOUT_S,
        write=settings.AI_WRITE_TIMEOUT_S,
        read=timeout,
        pool=settings.AI_CONNECT_TIMEOUT_S,
    )
    return anthropic.Anthropic(
        api_key=settings.ANTHROPIC_API_KEY, timeout=phase_timeouts, max_retries=settings.AI_MAX_RETRIES
    )


def _clean_text(value: str) -> str:
    # Un surrogate suelto en la respuesta del modelo rompe el renderer JSON de DRF ya facturado.
    return value.encode("utf-8", "ignore").decode("utf-8")


def _report_usage(resp, on_usage: UsageSink | None) -> None:
    """Pasa los tokens facturados a ``on_usage`` antes de interpretar la respuesta:
    una respuesta inválida también se paga."""
    usage = getattr(resp, "usage", None)
    if on_usage is None or usage is None:
        return
    on_usage(int(getattr(usage, "input_tokens", 0) or 0), int(getattr(usage, "output_tokens", 0) or 0))


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


def coach_chat(
    *, messages: list[dict], context: dict, memory: dict | None = None, on_usage: UsageSink | None = None
) -> str:
    """Chat del coach con el contexto real del atleta. Devuelve el texto de respuesta.

    `memory` es la memoria persistente del atleta (P0.3), ya sanitizada por
    `sanitize_coach_memory` — lesión activa, fase, fecha de la pelea, objetivo
    de peso y preferencias de tono/frecuencia. Se lee en el servidor a partir
    de `UserState` (clave `coach_memory`), no del cuerpo que manda el cliente.
    """
    client = _client(timeout=settings.AI_CHAT_TIMEOUT_S)

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
    _report_usage(resp, on_usage)
    text = _clean_text("".join(block.text for block in resp.content if block.type == "text")).strip()
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


def food_photo_analyze(*, image_bytes: bytes, media_type: str, on_usage: UsageSink | None = None) -> dict:
    """Analiza una foto de comida y devuelve {plato, items[], confianza, nota}."""
    client = _client(timeout=settings.AI_VISION_TIMEOUT_S)
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
    _report_usage(resp, on_usage)
    text = "".join(block.text for block in resp.content if block.type == "text")
    return _parse_food_json(text)


# Topes de cordura por alimento: por encima es una alucinación o un valor roto.
_MAX_ITEM_GRAMS = 5000
_MAX_ITEM_KCAL = 10000
_MAX_ITEM_MACRO = 1000
_LEADING_NUMBER_RE = re.compile(r"^\s*(-?\d+(?:[.,]\d+)?)")


def _coerce_number(value, *, field: str, cap: int, nullable: bool = False) -> int | None:
    """Entero acotado a ``[0, cap]`` a partir de lo que mande el modelo.

    Acepta números y textos que empiezan por número ("240 kcal", "12,5 g").
    Ausente/``null`` es 0 (o ``None`` si ``nullable``); cualquier otra cosa
    (booleanos, NaN, texto sin número, listas) es ``AIBadResponse``.
    """
    if value is None:
        return None if nullable else 0
    if isinstance(value, bool):
        raise AIBadResponse(f"Valor no numérico en '{field}'")
    if isinstance(value, (int, float)):
        try:
            number = float(value)
        except OverflowError as exc:
            raise AIBadResponse(f"Valor fuera de rango en '{field}'") from exc
    elif isinstance(value, str):
        match = _LEADING_NUMBER_RE.match(value)
        if match is None:
            raise AIBadResponse(f"Valor no numérico en '{field}'")
        number = float(match.group(1).replace(",", "."))
    else:
        raise AIBadResponse(f"Valor no numérico en '{field}'")
    if not math.isfinite(number):
        raise AIBadResponse(f"Valor no finito en '{field}'")
    if nullable and number <= 0:
        return None
    return min(cap, max(0, round(number)))


def _parse_food_json(text: str) -> dict:
    """Extrae y valida el JSON del modelo (tolera vallas de código y texto alrededor).

    Cualquier forma inesperada acaba en ``AIBadResponse`` (502 con mensaje),
    nunca en una excepción sin capturar (500).
    """
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise AIBadResponse("La IA no devolvió JSON")
    try:
        data = json.loads(text[start : end + 1])
    except (ValueError, RecursionError) as exc:  # ValueError: también el tope de dígitos de int
        raise AIBadResponse("JSON inválido de la IA") from exc
    if not isinstance(data, dict):
        raise AIBadResponse("La IA no devolvió un objeto JSON")
    raw_items = data.get("items")
    if not isinstance(raw_items, list):
        raise AIBadResponse("Falta la lista 'items'")

    items = []
    for it in raw_items:
        if not isinstance(it, dict) or not isinstance(it.get("nombre"), str):
            continue
        nombre = _clean_text(it["nombre"]).strip()[:80]
        if not nombre:
            continue
        items.append(
            {
                "nombre": nombre,
                "gramos": _coerce_number(it.get("gramos"), field="gramos", cap=_MAX_ITEM_GRAMS, nullable=True),
                "kcal": _coerce_number(it.get("kcal"), field="kcal", cap=_MAX_ITEM_KCAL),
                "p": _coerce_number(it.get("p"), field="p", cap=_MAX_ITEM_MACRO),
                "c": _coerce_number(it.get("c"), field="c", cap=_MAX_ITEM_MACRO),
                "f": _coerce_number(it.get("f"), field="f", cap=_MAX_ITEM_MACRO),
            }
        )
    if raw_items and not items:
        raise AIBadResponse("Ningún alimento válido en 'items'")
    plato, nota, confianza = data.get("plato"), data.get("nota"), data.get("confianza")
    return {
        "plato": (_clean_text(plato).strip()[:80] or None) if isinstance(plato, str) else None,
        "items": items,
        "confianza": confianza if confianza in ("alta", "media", "baja") else "media",
        "nota": (_clean_text(nota).strip()[:200] or None) if isinstance(nota, str) else None,
    }
