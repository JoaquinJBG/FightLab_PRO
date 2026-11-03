"""Pesaje en la BD y sus bloqueos (spec §6.2 y §8.3, Tasks 4.4 y 4.5).

El pesaje (peso objetivo, fecha del pesaje, categoría y cuenta atrás) vive en `UserProfile`.
Los bloqueos se aplican aquí, en el servidor: la UI solo se adapta a lo que devuelve.

- `no_weight_targets` (menor de 18, cribado de TCA positivo, embarazo; y cribado sin contestar):
  no se devuelve nada de pesaje, tampoco en `/me/profile`, y no se guarda.
- `no_deficit`, `hold_deficit`, `prescriber_owns_weight` (y los 65+ sin obesidad, que no es un
  flag sino una regla de `energy.deficit_blockers`): sigue la cuenta atrás, pero no la distancia
  a la categoría ("a X kg"), y no se acepta un peso objetivo por debajo del actual.
"""
from dataclasses import dataclass, field
from datetime import date, datetime

from coach import energy, safety
from coach.profile import ProfileIncomplete

from .bridge.adapters import _tz, latest_weight, to_coach_profile
from .bridge.reasons import Reason, parse_reason

WEIGH_FIELDS = ("goal_weight_kg", "goal_date", "weight_class", "weigh_in_at")
# convention (FightLab): control de entrada de un peso objetivo, no una recomendación.
MIN_GOAL_KG, MAX_GOAL_KG = 20, 300


@dataclass
class Policy:
    blocked: bool  # no_weight_targets (o cribado sin contestar): nada de pesaje
    deficit_blocked: bool  # no se ofrece perder peso
    reasons: list[Reason] = field(default_factory=list)


def _is_deficit_reason(text: str) -> bool:
    return text.startswith((safety.GLP1_RULE, safety.MENSTRUAL, safety.PREGNANCY_NUTRITION))


def policy_for(user, today: date) -> Policy:
    """Qué se puede ver y guardar del pesaje. Ante un perfil que el motor no puede evaluar, el
    pesaje se cierra (es lo seguro)."""
    try:
        profile = to_coach_profile(user, today)
        flags = safety.flags(profile, today)
    except (ProfileIncomplete, ValueError):
        return Policy(blocked=True, deficit_blocked=True)
    if not flags.screened:
        return Policy(blocked=True, deficit_blocked=True)
    reasons = []
    blocked = flags.no_weight_targets
    if blocked:
        reasons.append(parse_reason(safety.weight_block_reason(flags)))
    deficit_blocked = flags.no_deficit or flags.hold_deficit or flags.prescriber_owns_weight
    if not deficit_blocked:
        try:
            older = energy.deficit_blockers(profile, flags, today)
        except ProfileIncomplete:  # sin peso o altura aún: solo cuentan los flags
            older = []
        deficit_blocked = bool(older)
        reasons += [parse_reason(r) for r in older]
    elif not blocked:
        reasons += [parse_reason(r) for r in flags.reasons if _is_deficit_reason(r)]
    return Policy(blocked=blocked, deficit_blocked=deficit_blocked, reasons=reasons)


def hide_if_blocked(user, today: date, data: dict) -> dict:
    """`/me/profile` sin datos de pesaje si el flag lo bloquea."""
    if policy_for(user, today).blocked:
        return {**data, **dict.fromkeys(WEIGH_FIELDS)}
    return data


def check_write(user, today: date, fields: dict) -> tuple[int, dict] | None:
    """`(estado, cuerpo)` si el servidor rechaza guardar estos datos de pesaje; None si se puede."""
    touched = [name for name in WEIGH_FIELDS if name in fields]
    if not touched:
        return None
    policy = policy_for(user, today)
    if policy.blocked:
        return 403, {"code": "weight_targets_blocked", "fields": touched}
    goal = fields.get("goal_weight_kg")
    if policy.deficit_blocked and goal is not None:
        current = latest_weight(user, today)
        if current is not None and float(goal) < current[0]:
            return 400, {"code": "deficit_blocked", "fields": ["goal_weight_kg"]}
    return None


def _local_date(profile, moment: datetime | None) -> date | None:
    return moment.astimezone(_tz(profile)).date() if moment else None


def weigh_in_data(user, today: date, lang: str) -> dict:
    from .targets import reasons_data

    profile = user.profile
    policy = policy_for(user, today)
    base = {
        "blocked": policy.blocked,
        "deficit_blocked": policy.deficit_blocked,
        "reasons": reasons_data(policy.reasons, lang),
    }
    if policy.blocked:
        return {
            **base, "goal_weight_kg": None, "goal_date": None, "weigh_in_at": None, "weight_class": None,
            "days_left": None, "current_kg": None, "to_go_kg": None,
        }
    goal = float(profile.goal_weight_kg) if profile.goal_weight_kg is not None else None
    weigh_day = _local_date(profile, profile.weigh_in_at)
    goal_day = profile.goal_date or weigh_day
    current = latest_weight(user, today)
    current_kg = current[0] if current else None
    to_go = None
    if goal is not None and current_kg is not None and not policy.deficit_blocked:
        to_go = round(current_kg - goal, 1)
    return {
        **base,
        "goal_weight_kg": goal,
        "goal_date": goal_day.isoformat() if goal_day else None,
        "weigh_in_at": profile.weigh_in_at.isoformat() if profile.weigh_in_at else None,
        "weight_class": profile.weight_class,
        "days_left": (weigh_day - today).days if weigh_day else None,
        "current_kg": current_kg,
        "to_go_kg": to_go,
    }


def weigh_in_save(user, goal_weight_kg, weigh_in_at: datetime, weight_class: str | None) -> None:
    profile = user.profile
    profile.goal_weight_kg = goal_weight_kg
    profile.weigh_in_at = weigh_in_at
    profile.goal_date = _local_date(profile, weigh_in_at)
    profile.weight_class = weight_class or None
    profile.full_clean()
    profile.save()


def weigh_in_clear(user) -> None:
    profile = user.profile
    for name in WEIGH_FIELDS:
        setattr(profile, name, None)
    profile.save()
