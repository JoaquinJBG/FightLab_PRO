"""El texto del plan de la semana (`WeeklyPlan.narrative`, Task 6.4).

El LLM solo redacta. Recibe el plan ya guardado y escribe unas frases en el idioma del usuario;
no puede cambiar ningún número, porque los números ya están en sus campos y aquí no se tocan.
Además, si el texto trae un número que no está en el plan, se descarta entero: es la regla del
coach de citar solo números calculados ("never from the model's own arithmetic").

Sin `ANTHROPIC_API_KEY` no se llama a nada y el plan va sin texto.
"""
import json
import logging
import re

from django.conf import settings

logger = logging.getLogger(__name__)

NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)?")
MAX_TOKENS = 500

SYSTEM = (
    "You write a short, friendly summary (3 to 5 sentences) of an athlete's training week for the "
    "FightLab app. The plan is given as JSON and was computed by an evidence-based engine. Do not "
    "add, change, round or compute any number: mention a number only if it appears in the JSON, "
    "exactly as written. Do not add exercises, sessions, advice or medical claims that are not in "
    "the plan. If there are safety reasons, mention that the plan respects them, without "
    "diagnosing. Plain text, no lists, no markdown."
)


def _numbers(value, out: set[str]) -> set[str]:
    if isinstance(value, bool) or value is None:
        return out
    if isinstance(value, (int, float)):
        text = f"{value:g}" if isinstance(value, float) else str(value)
        out.update({text, text.replace(".", ",")})
        if isinstance(value, float) and value.is_integer():
            out.add(str(int(value)))
    elif isinstance(value, str):
        for n in NUMBER_RE.findall(value):
            out.update({n, n.replace(",", "."), n.replace(".", ",")})
    elif isinstance(value, dict):
        for v in value.values():
            _numbers(v, out)
    elif isinstance(value, (list, tuple)):
        for v in value:
            _numbers(v, out)
    return out


def numbers_ok(text: str, plan: dict) -> bool:
    """Todos los números del texto están en el plan (con punto o coma decimal)."""
    allowed = _numbers(plan, set())
    return all(n in allowed for n in NUMBER_RE.findall(text))


def _payload(plan: dict) -> dict:
    """Lo que ve el LLM: el plan sin ids, fechas internas ni el texto anterior."""
    return {k: v for k, v in plan.items() if k not in ("id", "created_at", "applied_at", "narrative", "engine_sha")}


def narrate(system: str, payload: dict, lang: str, what: str) -> str:
    """Unas frases del LLM sobre `payload` en `lang`, o `""`. Se descartan si traen un número que
    no está en `payload`. Sin `ANTHROPIC_API_KEY` no se llama a nada."""
    if not settings.ANTHROPIC_API_KEY:
        return ""
    from ai.services import AIUnavailable, _client, language_instruction

    try:
        resp = _client(timeout=30).messages.create(
            model=settings.AI_MODEL_CHAT,
            max_tokens=MAX_TOKENS,
            system=f"{system}\n{language_instruction(lang)}",
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
    except AIUnavailable:
        return ""
    except Exception:  # se guarda igual, sin texto
        logger.exception("%s: el LLM no ha podido escribir el texto", what)
        return ""
    text = "".join(getattr(b, "text", "") for b in resp.content).strip()
    if not numbers_ok(text, payload):
        logger.warning("%s: texto del LLM descartado porque trae números que no están en los datos", what)
        return ""
    return text


def write_narrative(plan: dict, lang: str) -> str:
    return narrate(SYSTEM, _payload(plan), lang, "plan")
