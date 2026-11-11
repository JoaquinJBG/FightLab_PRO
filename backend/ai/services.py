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
from dataclasses import dataclass, field

import anthropic
import httpx
from django.conf import settings

from coaching import citations as chat_tools
from coaching.bridge import reason_texts


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


# El prompt base se escribe una vez, en inglés, y lleva la instrucción de idioma.
COACH_SYSTEM = """You are the coach of FightLab Pro, a high-performance coach for MMA and combat-sport athletes. Talk like a corner coach: direct, close, short sentences, no filler, about 120 words at most. {language_instruction}

Strict rules:
- Use ONLY the data in the "Athlete context" and what the tools return. If a piece of data is missing, say so and suggest logging it in the app. NEVER invent numbers or trends, and never do your own arithmetic: quote numbers only from the context or from a tool result.
- Every claim or recommendation about training, nutrition, recovery or health must rest on a rule of the evidence base. Look for it with search_rules, read it with get_rule, and cite it in the text as [[regla:key]], using exactly the key a tool returned this turn. Never cite a key the tools did not return, and never write a threshold, dose or "safe range" from memory. If no rule covers the question, say so plainly instead of improvising.
- The training-load figures in the context (weekly load, the week against the 4-week average, ACWR, monotony...) are descriptive FightLab data. Report the week as a percentage above or below the athlete's own 4-week average, next to how they feel. Do not call a value safe or risky, do not give thresholds and do not claim they predict injury: load-ratio research comes from team sports and has barely been tested in combat sports. With under 28 days of history there is no ratio yet: say how many days are missing.
- Safety comes first, before any load, intensity or readiness advice. If the athlete mentions pain, an injury, a knock to the head, dizziness, fainting, chest pain, breathlessness, palpitations or a fever, never tell them to train hard, push through or that they have room, whatever the load and recovery data say. Apply the same rule as the app's check-in and screening: after a possible head knock, no training today and no contact until a clinician has assessed them; with chest symptoms, dizziness or fainting, stop and see a doctor; with a fever, no training; with new pain or an injury, do not load that area, and stop and see a doctor if it is sharp, getting worse or comes with numbness or weakness. Find that rule with the tools and cite it.
- You are not a doctor and you give no medical advice: with pain or symptoms, recommend a health professional. For weight cuts before a weigh-in give only general information, never a prescription, and point to a professional team.
- No markdown and no lists: plain prose, one to three sentences per idea."""

LANGUAGE_NAMES = {"es": "Spanish", "en": "English"}
DEFAULT_LANGUAGE = "es"
# Vueltas máximas de herramientas por respuesta (cada una es una llamada más al modelo)
MAX_TOOL_ROUNDS = 4

# Preferencias de tono (memoria persistente del atleta, ver `sanitize_coach_memory`):
# instrucción breve que se añade al system prompt para cada valor.
_TONE_INSTRUCTIONS = {
    "directo": "The athlete wants you to be DIRECT: very short sentences, no beating around the bush, no frills, get to the point.",
    "motivador": "The athlete wants a MOTIVATING tone: warm, openly encouraging, while staying honest with the data.",
    "tecnico": "The athlete wants a TECHNICAL tone: when it helps, briefly explain the physiological why (load, recovery) behind the advice.",
}
_FREQUENCY_INSTRUCTIONS = {
    "alta": "The athlete wants frequent warnings: do not hold back from pointing out anything relevant, even if minor.",
    "media": "The athlete wants a normal frequency of warnings: point out what matters without overwhelming them.",
    "baja": "The athlete wants to be bothered as little as possible: mention ONLY what really matters (injury, symptoms, an upcoming weigh-in); skip minor warnings.",
}

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


def with_deferral_line(text: str, language: str | None) -> str:
    """Termina la respuesta con la línea de derivación de `docs/safety.md`, literal, en el idioma
    del usuario. La añade el backend, no el modelo (spec §7.4)."""
    code = (language or "").split("-")[0]
    line = reason_texts.DEFERRAL_LINE[code if code in reason_texts.LANGUAGES else reason_texts.DEFAULT_LANGUAGE]
    return text if line in text else f"{text}\n\n{line}"


# Bloqueos de combate que pone el servidor (`coaching/combat.py`, E.5), con la regla del anexo.
NO_CONTACT_NOTE = (
    "The athlete reported a blow to the head with symptoms and has not confirmed a clinician's "
    "clearance (no_contact). Do not suggest sparring, clinch, partner drills, live grappling or any "
    "contact work; say that a clinician decides the return to contact; never state a diagnosis, a "
    "number of days or that they are probably fine. For the warning signs, point to the official "
    "Concussion Recognition Tool 6. This comes before any load, intensity or readiness advice and "
    "before anything else they ask: the day of the blow, no training at all; until a clinician "
    "clears them, no contact and no hard training, only light activity that does not clearly "
    "worsen the symptoms. The return to contact goes step by step and a clinician authorises the "
    "contact steps. Cite [[regla:combat-sports/a-head-blow-with-symptoms-sets-no-contact-and-refers]] and "
    "[[regla:combat-sports/return-to-contact-follows-a-graded-clinician-supervised-plan]]."
)
NO_CONTACT_RULES = (
    "combat-sports/a-head-blow-with-symptoms-sets-no-contact-and-refers",
    "combat-sports/return-to-contact-follows-a-graded-clinician-supervised-plan",
)
INJURY_RULE = "recovery-habits/some-pain-during-exercise-is-acceptable-in-chronic-assessed-pain"


def injury_note(areas: list[str]) -> str:
    """Nota de seguridad con las lesiones activas (las del perfil y la de la memoria del coach)."""
    return (
        "The athlete has an active injury, saved in the app: "
        + json.dumps(areas, ensure_ascii=False)
        + ". Whenever the question touches training, mention it before load advice. Limit only what "
        "loads that area: no progression there; if no professional has assessed it, no load on it "
        "until a GP or physiotherapist does; stop and see a doctor with sharp or worsening pain, "
        "numbness or weakness. Do not stop the rest of the training because of it. "
        f"Cite [[regla:{INJURY_RULE}]]."
    )
def readiness_note(level: str, blocked_by: list[str]) -> str:
    """R4-13: el estado de seguridad de hoy (`coaching.safety_state`) manda sobre la recuperación
    que manda la app: nunca «listo para entrenar» ni trabajo vigoroso si no toca."""
    if level == "stop":
        return (
            "Today's safety state is STOP (set by the server): the athlete should not train until a "
            "doctor reviews them. Never say they are ready to train, whatever the recovery data says."
        )
    return (
        "Today's safety state is CAUTION (set by the server"
        + (f": {', '.join(blocked_by)}" if blocked_by else "")
        + "). Never say they are ready to train hard and do not suggest vigorous or maximal work "
        "(hard sparring, HIIT, sprints, max lifts), whatever the recovery or load data says; "
        "light to moderate work only, within the limits above."
    )


NO_CUT_NOTE = (
    "The athlete is under 18. Give no weight-cut or rapid weight-loss information; say that "
    "sports-medicine consensus discourages weight making in young athletes and suggest a doctor or "
    "sports dietitian."
)


def coach_chat(
    *,
    messages: list[dict],
    context: dict,
    language: str | None = None,
    refer_gp: bool = False,
    safety_notes: tuple[str, ...] = (),
    memory: dict | None = None,
    on_usage: UsageSink | None = None,
    safety_rules: tuple[str, ...] = (),
) -> CoachReply:
    """Chat del coach con el contexto real del atleta y herramientas de evidencia.

    `language`: el idioma del perfil del usuario (`profile.language`). Las citas `[[regla:clave]]`
    se validan aquí: las que no existen o no salieron en una herramienta se quitan. Con `refer_gp`
    (flag del motor), la respuesta termina con la línea de derivación. `safety_notes`: los bloqueos
    que calcula el servidor (no los manda el cliente).

    `memory` es la memoria persistente del atleta (P0.3), ya sanitizada por
    `sanitize_coach_memory` — lesión activa, fase, fecha de la pelea, objetivo
    de peso y preferencias de tono/frecuencia. Se lee en el servidor a partir
    de `UserState` (clave `coach_memory`), no del cuerpo que manda el cliente.
    `on_usage` recibe los tokens de cada llamada al modelo (una por vuelta de herramientas).
    `safety_rules`: las reglas que pide una nota de seguridad del mensaje (F3, `chat_safety`); se dan
    por recuperadas en el turno para que el modelo las pueda citar sin buscarlas.
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
        COACH_SYSTEM.format(language_instruction=language_instruction(language))
        + "\n\nAthlete context (real app data, today):\n"
        + json.dumps(context, ensure_ascii=False)
    )
    if memory:
        system += (
            "\n\nWhat the athlete has told you about themselves, to remember between conversations "
            "(it may be incomplete or out of date; do not repeat it word for word, use it to adapt your "
            "warnings and your tone):\n" + json.dumps(memory, ensure_ascii=False)
        )
        tone_note = _TONE_INSTRUCTIONS.get(memory.get("tono"))
        if tone_note:
            system += "\n" + tone_note
        freq_note = _FREQUENCY_INSTRUCTIONS.get(memory.get("frecuencia_avisos"))
        if freq_note:
            system += "\n" + freq_note
    if safety_notes:
        system += "\n\nSafety (set by the server, always applies):\n" + "\n".join(f"- {n}" for n in safety_notes)
    retrieved: set[str] = set(safety_rules)
    convo = list(cleaned)
    for round_ in range(MAX_TOOL_ROUNDS + 1):
        resp = client.messages.create(
            model=settings.AI_MODEL_CHAT,
            max_tokens=500,
            system=system,
            messages=list(convo),
            tools=chat_tools.TOOLS,
        )
        _report_usage(resp, on_usage)
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
    text = _clean_text("".join(block.text for block in resp.content if block.type == "text")).strip()
    if not text:
        raise AIBadResponse("Respuesta vacía del modelo")
    text, citations = chat_tools.validate_citations(text, retrieved)
    if not text:
        raise AIBadResponse("Respuesta vacía tras quitar las citas inválidas")
    if refer_gp:
        text = with_deferral_line(text, language)
    return CoachReply(text=text, citations=citations)


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
