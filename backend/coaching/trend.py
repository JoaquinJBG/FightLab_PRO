"""`GET /coach/trend` (spec §6.8, Task 5.4): la tendencia de peso del motor sobre los pesajes de
`BiometricsLog`.

`coach.trend.weight_trend` compara medias semanales, nunca pesajes sueltos: pide al menos 7 pesajes
que cubran 14 días y, antes, dice "insuficiente" (`nutrition.md: "Read the scale with weekly
averages"`). La EWMA de la gráfica de Biometría es solo visual: el ritmo semanal que se muestra
sale de aquí. Con `no_weight_targets` no se devuelve nada (spec §8.3).
"""
import dataclasses
from datetime import date

from coach import trend as coach_trend
from coach.safety import flags as coach_flags

from .bridge.adapters import to_coach_profile, weigh_ins
from .bridge.reasons import parse_reason
from .keys import rule_key
from .models import KnowledgeRule
from .targets import reasons_data
from .weigh_in import policy_for

TREND_RULE = rule_key("nutrition.md", "Read the scale with weekly averages")


def _grade() -> str | None:
    return KnowledgeRule.objects.filter(key=TREND_RULE).values_list("grade", flat=True).first()


def _empty(status: str, *, blocked: bool, reasons: list) -> dict:
    return {
        "status": status,
        "blocked": blocked,
        "rate_kg_week": None,
        "rate_pct_week": None,
        "weight_kg": None,
        "points": 0,
        "days": 0,
        "start": None,
        "end": None,
        "can_recalibrate": False,
        "min_points": coach_trend.MIN_POINTS,
        "min_days": coach_trend.MIN_DAYS,
        "rule_key": TREND_RULE,
        "grade": _grade(),
        "reasons": reasons,
    }


def trend_data(user, today: date, lang: str) -> dict:
    policy = policy_for(user, today)
    if policy.blocked:
        return _empty("disabled", blocked=True, reasons=reasons_data(policy.reasons, lang))
    profile = to_coach_profile(user, today)
    points = [(day, kg) for day, kg in weigh_ins(user) if day <= today]
    result = coach_trend.weight_trend(points, coach_flags(profile, today))
    reasons = [parse_reason(note) for note in result.notes]
    # El motor no cita la regla en estas notas (la cita en el comentario de la constante).
    reasons = [dataclasses.replace(r, rule_key=r.rule_key or TREND_RULE) for r in reasons]
    return {
        **_empty(result.status, blocked=False, reasons=reasons_data(reasons, lang)),
        "rate_kg_week": result.rate_kg_week,
        "rate_pct_week": result.rate_pct_week,
        "weight_kg": result.weight_kg,
        "points": result.points,
        "days": result.days,
        "start": result.start.isoformat() if result.start else None,
        "end": result.end.isoformat() if result.end else None,
        "can_recalibrate": result.can_recalibrate,
    }
