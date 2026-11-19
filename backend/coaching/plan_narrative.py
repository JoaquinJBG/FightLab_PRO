"""El texto del plan de la semana (`WeeklyPlan.narrative`, Task 6.4).

El LLM solo redacta. Recibe el plan ya guardado y escribe unas frases en el idioma del usuario;
no puede cambiar ningún número, porque los números ya están en sus campos y aquí no se tocan.
Además, si el texto trae un número que no está en el plan, se descarta entero: es la regla del
coach de citar solo números calculados ("never from the model's own arithmetic").

Cuesta dinero, así que va apagado por defecto (`PLAN_NARRATIVE_ENABLED`, regla del proyecto: el
servidor no hace llamadas de pago salvo que se encienda a propósito). Apagado, o sin
`ANTHROPIC_API_KEY`, no se llama a nada y el plan va sin texto (la app enseña solo lo calculado por
reglas). Encendido, cada texto:
- gasta una unidad de la cuota diaria del chat (`ai.quota`, se devuelve si la llamada falla);
- suma sus tokens al presupuesto global (`AI_GLOBAL_DAILY_TOKEN_BUDGET`) y no se pide si ya se pasó;
- pasa por un throttle propio (`plan-narrative`, 10/h por usuario).
Se llama fuera de `transaction.atomic`: el plan o la revisión ya están guardados (`attach`).
"""
import json
import logging
import re
from types import SimpleNamespace

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle

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


class NarrativeThrottle(SimpleRateThrottle):
    """Throttle de ámbito `plan-narrative` por usuario, sin vista: se usa desde el servicio. La
    tasa se lee en caliente de los settings (como `ai.views.LiveScopedRateThrottle`)."""

    scope = "plan-narrative"

    def __init__(self):  # la tasa se lee en `allow`, no al instanciar
        pass

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}

    def allow(self, user) -> bool:
        rates = (getattr(settings, "REST_FRAMEWORK", None) or {}).get("DEFAULT_THROTTLE_RATES", {})
        self.rate = rates.get(self.scope)
        self.num_requests, self.duration = self.parse_rate(self.rate)
        return self.allow_request(SimpleNamespace(user=user), None)


def narrate(system: str, payload: dict, lang: str, what: str, user=None) -> str:
    """Unas frases del LLM sobre `payload` en `lang`, o `""`. Se descartan si traen un número que
    no está en `payload`. Apagado (`PLAN_NARRATIVE_ENABLED`), sin `ANTHROPIC_API_KEY` o sin `user`
    (no hay a quién cobrar la cuota) no se llama a nada."""
    if not settings.PLAN_NARRATIVE_ENABLED or not settings.ANTHROPIC_API_KEY or user is None:
        return ""
    from ai import quota
    from ai.models import AIUsage
    from ai.services import AIUnavailable, _client, _report_usage, language_instruction

    if quota.global_budget_exceeded():
        logger.info("%s: presupuesto global de tokens agotado, sin texto", what)
        return ""
    if not NarrativeThrottle().allow(user):
        logger.info("%s: throttle del texto del LLM, sin texto", what)
        return ""
    reservation = quota.reserve(user=user, kind=AIUsage.Kind.CHAT)
    if reservation is None:  # cuota del chat agotada: el plan sale igual, sin texto
        return ""

    def record(input_tokens: int, output_tokens: int) -> None:
        quota.record_tokens(reservation, input_tokens=input_tokens, output_tokens=output_tokens)

    try:
        resp = _client(timeout=30).messages.create(
            model=settings.AI_MODEL_CHAT,
            max_tokens=MAX_TOKENS,
            system=f"{system}\n{language_instruction(lang)}",
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
    except AIUnavailable:
        quota.refund(reservation)
        return ""
    except Exception:  # se guarda igual, sin texto
        quota.refund(reservation)
        logger.exception("%s: el LLM no ha podido escribir el texto", what)
        return ""
    _report_usage(resp, record)  # una respuesta descartada también se paga
    text = "".join(getattr(b, "text", "") for b in resp.content).strip()
    if not numbers_ok(text, payload):
        logger.warning("%s: texto del LLM descartado porque trae números que no están en los datos", what)
        return ""
    return text


def write_narrative(plan: dict, lang: str, user=None) -> str:
    return narrate(SYSTEM, _payload(plan), lang, "plan", user)


def attach(obj, data: dict, lang: str, narrate_fn, user) -> None:
    """Escribe `obj.narrative` con `narrate_fn(data, lang, user)` y lo guarda. Va FUERA de
    `transaction.atomic` (la llamada al LLM tarda segundos): `obj` ya está guardado y, si el texto
    no llega, se queda sin él."""
    text = narrate_fn(data, lang, user)
    if text:
        obj.narrative = text
        obj.save(update_fields=["narrative"])
