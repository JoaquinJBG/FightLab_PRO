"""Generador del plan de la semana por reglas (Task 6.4), siguiendo `plan/SKILL.md` del coach.

- Al menos 2 sesiones de cuerpo completo, cada una con un ejercicio de pierna, uno de empuje y
  uno de tirón ("Weekly baseline dose"), en rotación A, B que sigue desde la última sesión hecha
  sin recuperar las perdidas (convención del coach, `docs/conventions.md`).
- Rango de repeticiones 8-12 por defecto ("Double progression"), o el que ya usaba el plan
  anterior para ese ejercicio. Repeticiones en reserva de "Target reps in reserve", o las más
  conservadoras de "Starting point for novices" y "Effort limits for older adults and
  cardiovascular risk" cuando se aplican.
- Cargas de `coach.strength.progression` y nunca inventadas: un ejercicio sin registros va sin
  carga ("una carga con la que podrías hacer 2-3 repeticiones más"). Un ejercicio en pausa no
  progresa; sin carga (lesión sin evaluar) se cambia por otro del mismo patrón.
- Cardio desde "Weekly baseline dose" a intensidad moderada (la zona de `coach zones`), solo con
  las modalidades que `rules.MODALITY_INTENSITY` deja con los flags de hoy.
- Las sesiones de MMA registradas (o las que el usuario dice que tiene) ocupan su día, con el
  trabajo de combate que los flags permiten.
- Nutrición: los objetivos del motor (`targets.targets_data`), tal cual.

Con `no_training` no hay plan. El LLM solo escribe `narrative` (`plan_narrative.py`), después de
guardar los números, y no los puede cambiar.

Semana de descarga (F7, `plan/SKILL.md`, "Agreed changes"): si la revisión semanal aceptada pide
una descarga para la semana del plan, cada ejercicio va con las series recortadas según el
`volume_cut` del motor, las mismas cargas (nunca más que las de la última sesión) y el esfuerzo
parado a `stop_rir` repeticiones del fallo ("Deloads").
"""
import math
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

from coach import safety
from coach import strength as coach_strength
from coach.profile import ProfileIncomplete
from django.db import transaction
from django.utils import timezone

from activities.models import Activity

from . import rules, safety_state
from .bridge.adapters import _tz, set_records, to_coach_profile
from .bridge.muscle_map import muscle_map
from .bridge.reasons import Reason, parse_reason
from .combat import NO_CONTACT_RULE, RETURN_STEPS_RULE
from .models import WeeklyPlan, WeeklyReview
from .strength import WEEKLY_SETS_RULE, suggestion_for, suggestion_rule_key
from .targets import _key, reasons_data, rule_refs, targets_data, zones_data
from .views import engine_info

DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
SESSION_KEYS = ("A", "B")
PATTERNS = ("legs", "push", "pull")

# cardio-health.md: "Weekly baseline dose": at least 2 full-body strength sessions a week, and
# 150 min of moderate cardio as the minimum.
MIN_GYM_DAYS = 2
CARDIO_MODERATE_MIN = 150
# convention (FightLab): hasta 6 días de gimnasio; el día que queda es de descanso.
MAX_GYM_DAYS = 6
# convention (del coach, plan/SKILL.md): sin registros, 2-3 series de trabajo por ejercicio.
SETS_WITHOUT_LOG = 3
# convention (FightLab): las series por ejercicio se quedan entre 2 y 5.
MIN_SETS, MAX_SETS = 2, 5
# convention (FightLab): los minutos de cardio por día se redondean hacia arriba de 5 en 5.
CARDIO_STEP_MIN = 5
# convention (FightLab, F9): una sesión de cardio del plan dura al menos 20 min. Lo que falta hasta
# los 150 min se reparte en menos días si no llega a 20 por día, y si falta menos de 20 se propone
# una sola sesión de 20 (150 es un mínimo, no un tope). Sin esto salían «Cardio moderado · 5 min».
CARDIO_MIN_SESSION = 20
# convention (FightLab): un día es de MMA si hubo sesión ese día de la semana en 2 o más de las
# últimas 4 semanas, y los minutos de MMA cuentan como cardio moderado (el anexo E clasifica el
# trabajo de combate como moderado o vigoroso; contarlo como moderado es lo prudente).
MMA_LOOKBACK_DAYS = 28
MMA_DAY_MIN_WEEKS = 2
# convention (FightLab): ejercicios por defecto de cada patrón, de la biblioteca del gimnasio.
DEFAULT_EXERCISES = {
    "legs": ("Sentadilla", "Peso muerto rumano", "Prensa"),
    "push": ("Press banca", "Press militar", "Press inclinado"),
    "pull": ("Remo con barra", "Jalón al pecho", "Dominadas"),
}
# convention (FightLab): días por defecto, separados, sin pisar los de MMA.
DEFAULT_DAY_PAIRS = (
    ("mon", "thu"), ("tue", "fri"), ("wed", "sat"), ("mon", "fri"), ("tue", "sat"), ("wed", "sun"),
    ("thu", "sun"), ("mon", "wed"), ("tue", "thu"), ("wed", "fri"), ("thu", "sat"), ("fri", "sun"),
)

# strength-hypertrophy.md: "Target reps in reserve": about 1-3 RIR for hypertrophy.
TARGET_RIR = 'strength-hypertrophy.md: "Target reps in reserve"'
RIR_DEFAULT = (1, 3)
# strength-hypertrophy.md: "Starting point for novices" (2-3 RIR) and "Effort limits for older
# adults and cardiovascular risk" (over about 60, hypertension or cardiovascular risk: start at
# about 2-3 RIR). With two rules, the more conservative one wins (plan/SKILL.md).
NOVICES = 'strength-hypertrophy.md: "Starting point for novices"'
EFFORT_LIMITS = 'strength-hypertrophy.md: "Effort limits for older adults and cardiovascular risk"'
RIR_CONSERVATIVE = (2, 3)
EFFORT_LIMITS_AGE = 60
CARDIOVASCULAR_CONDITIONS = {"hypertension", "heart_disease"}

FULL_BODY = 'strength-hypertrophy.md: "Full-body versus split"'
DELOADS = coach_strength.DELOADS
HOW_LONG_HABITS = 'recovery-habits.md: "How long habits take"'


class PlanBlocked(Exception):
    """`no_training`: no se genera ni se aplica un plan."""

    def __init__(self, reasons: list[Reason]):
        self.reasons = reasons
        super().__init__("no_training")


class PlanInvalid(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass
class PlanRequest:
    gym_days: list[str] | None = None
    mma_days: list[str] | None = None
    cardio_days: list[str] | None = None
    times: dict[str, str] = field(default_factory=dict)
    week_start: date | None = None  # la semana del plan (por defecto, la de `today`)


def week_start_for(today: date) -> date:
    """El lunes de la semana de `today` (convention: el plan es el de la semana en curso)."""
    return today - timedelta(days=today.weekday())


def _ordered(days) -> list[str]:
    return [d for d in DAYS if d in set(days)]


def _reason_dict(reason: Reason) -> dict:
    return asdict(reason)


def _age(birth: date | None, today: date) -> int | None:
    if birth is None:
        return None
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


# ---------------------------------------------------------------- días


def mma_days_detected(user, today: date) -> list[str]:
    """Los días de la semana con MMA en 2 o más de las últimas 4 semanas."""
    weeks_by_day: dict[str, set] = defaultdict(set)
    since = today - timedelta(days=MMA_LOOKBACK_DAYS)
    tz = _tz(user.profile)
    for act in Activity.objects.filter(profile=user.profile, kind=Activity.Kind.MMA, started_at__date__gt=since):
        day = act.started_at.astimezone(tz).date()
        weeks_by_day[DAYS[day.weekday()]].add(day.isocalendar()[:2])
    return [d for d in DAYS if len(weeks_by_day[d]) >= MMA_DAY_MIN_WEEKS]


def mma_minutes_per_week(user, today: date) -> int:
    since = today - timedelta(days=MMA_LOOKBACK_DAYS)
    total = sum(
        Activity.objects.filter(profile=user.profile, kind=Activity.Kind.MMA, started_at__date__gt=since)
        .values_list("duration_sec", flat=True)
    )
    return round(total / 60 / (MMA_LOOKBACK_DAYS / 7))


def default_gym_days(mma_days: list[str]) -> list[str]:
    taken = set(mma_days)
    for pair in DEFAULT_DAY_PAIRS:
        if not taken & set(pair):
            return list(pair)
    free = [d for d in DAYS if d not in taken]
    return (free + [d for d in DAYS if d in taken])[:MIN_GYM_DAYS]


def last_plan_session(user) -> str | None:
    """La última sesión del plan que se hizo (`detail.plan_session` de la sesión de gimnasio)."""
    for detail in (
        Activity.objects.filter(profile=user.profile, kind=Activity.Kind.GYM)
        .order_by("-started_at")
        .values_list("detail", flat=True)[:20]
    ):
        if isinstance(detail, dict) and detail.get("plan_session") in SESSION_KEYS:
            return detail["plan_session"]
    return None


# ---------------------------------------------------------------- ejercicios


def pattern_of(name: str) -> str | None:
    entry = coach_strength.lookup(name, muscle_map())
    if not entry:
        return None
    muscles = entry["muscles"]
    if entry.get("lower_body") or any(muscles.get(m) == 1 for m in ("quads", "glutes", "hamstrings")):
        return "legs"
    if any(muscles.get(m) == 1 for m in ("chest", "front_delts")):
        return "push"
    if muscles.get("back") == 1:
        return "pull"
    return None


def _candidates(records, since: date) -> dict[str, list[str]]:
    """Por patrón: lo que el usuario más ha registrado (sus nombres) y luego los de por defecto."""
    sessions = Counter()
    for name, day in {(s.exercise, s.date) for s in records if s.date > since and coach_strength.is_working(s)}:
        sessions[name] += 1
    mapped = muscle_map()
    out = {}
    for pattern in PATTERNS:
        logged = sorted((n for n in sessions if pattern_of(n) == pattern), key=lambda n: (-sessions[n], n))
        names = list(logged)
        for default in DEFAULT_EXERCISES[pattern]:
            if not any(coach_strength.named_in(default, [n], mapped) for n in names):
                names.append(default)
        out[pattern] = names
    return out


def _sets_per_session(history, since: date) -> int | None:
    per_day = Counter(s.date for s in history if s.date > since and coach_strength.is_working(s))
    if not per_day:
        return None
    return round(sum(per_day.values()) / len(per_day))


def _primary_muscle(name: str) -> str | None:
    entry = coach_strength.lookup(name, muscle_map()) or {}
    direct = [m for m, credit in entry.get("muscles", {}).items() if credit == 1]
    return direct[0] if direct else None


@dataclass
class _Context:
    today: date
    profile: object
    flags: object
    records_by_name: dict
    since: date
    weekly_sets: dict
    previous_ranges: dict
    goal: str | None


def _item(name: str, pattern: str, ctx: _Context) -> dict:
    mapped = muscle_map()
    rep_range = tuple(ctx.previous_ranges.get(name, coach_strength.REP_RANGE))
    history = ctx.records_by_name.get(name, [])
    pause = coach_strength.find_pause(name, ctx.flags.paused_exercises, mapped)
    if history:
        suggestion = suggestion_for(name, history, ctx.today, ctx.flags, ctx.profile, rep_range)
    elif pause:
        suggestion = coach_strength.Suggestion("paused", None, rep_range, list(pause.reasons))
    else:
        suggestion = coach_strength.Suggestion("no_data", None, rep_range, [])
    reasons = [parse_reason(t) for t in dict.fromkeys(suggestion.reasons)]

    logged_sets = _sets_per_session(history, ctx.since)
    if logged_sets is None:
        sets, sets_basis = SETS_WITHOUT_LOG, "coach_convention"
    else:
        sets, sets_basis = logged_sets, "log"
    grows = (
        ctx.goal == "muscle_gain"
        and logged_sets is not None
        and suggestion.action not in ("hold", "paused", "no_training")
        and not ctx.flags.hold_progression
        and ctx.weekly_sets.get(_primary_muscle(name), 0) < coach_strength.WEEKLY_SETS_REFERENCE
    )
    if grows:  # plan/SKILL.md: con muscle_gain, se añaden series poco a poco hacia la referencia
        sets, sets_basis = sets + 1, "weekly_sets"
    sets = max(MIN_SETS, min(MAX_SETS, sets))
    if logged_sets is not None and (ctx.flags.hold_progression or suggestion.action == "paused"):
        sets = min(sets, logged_sets)  # nunca más que lo que ya hacía

    rule_key = suggestion_rule_key(suggestion, reasons)
    if suggestion.action == "no_data":
        rule_key = _key(TARGET_RIR)
    return {
        "exercise": name,
        "pattern": pattern,
        "sets": sets,
        "sets_basis": sets_basis,
        "sets_rule_key": _key(WEEKLY_SETS_RULE) if sets_basis == "weekly_sets" else None,
        "rep_range": list(suggestion.rep_range),
        "load_kg": suggestion.load_kg,
        "action": suggestion.action,
        "rule_key": rule_key,
        "reasons": [_reason_dict(r) for r in reasons],
        "swapped_from": None,
    }


def _usable(item: dict) -> bool:
    """Un ejercicio en pausa sin carga (lesión sin evaluar) no se carga: se cambia por otro."""
    return not (item["action"] == "paused" and item["load_kg"] is None)


def _session(index: int, candidates: dict[str, list[str]], ctx: _Context) -> dict:
    items = []
    for pattern in PATTERNS:
        names = candidates[pattern]
        preferred = names[index % len(names)] if len(names) > index else names[0]
        order = [preferred] + [n for n in names if n != preferred]
        chosen = None
        for name in order:
            item = _item(name, pattern, ctx)
            if _usable(item):
                chosen = item
                break
        if chosen is None:  # todos en pausa: se queda el preferido, sin carga ni series
            chosen = _item(preferred, pattern, ctx) | {"sets": 0}
        if chosen["exercise"] != preferred:
            paused = _item(preferred, pattern, ctx)
            chosen["swapped_from"] = preferred
            chosen["reasons"] = paused["reasons"] + chosen["reasons"]
        items.append(chosen)
    return {"key": SESSION_KEYS[index], "kind": "gym", "items": items, "rule_key": _key(FULL_BODY)}


def _effort(profile, flags, today: date) -> dict:
    age = _age(profile.birth_date, today)
    cardiovascular = bool(CARDIOVASCULAR_CONDITIONS & set(profile.conditions)) or flags.cap_moderate
    if (age is not None and age > EFFORT_LIMITS_AGE) or cardiovascular:
        return {"rir": list(RIR_CONSERVATIVE), "rule_key": _key(EFFORT_LIMITS)}
    if profile.experience == "novice":
        return {"rir": list(RIR_CONSERVATIVE), "rule_key": _key(NOVICES)}
    return {"rir": list(RIR_DEFAULT), "rule_key": _key(TARGET_RIR)}


# ---------------------------------------------------------------- cardio y MMA


def _modality(key: str, state: safety_state.SafetyState) -> dict:
    m = rules.MODALITY_INTENSITY[key]
    return {
        "key": key,
        "intensity": m.intensity,
        "rule_key": _key(m.rule) if m.rule else None,
        "convention": m.convention,
        "blocked_by": state.blocked_by(key),
    }


# convention (del coach, plan/SKILL.md): el plan ofrece estas modalidades de cardio. Los sprints
# a tope, SIT y REHIT piden 4 semanas de cardio moderado regular sin síntomas, que la app no puede
# comprobar ("PAR-Q+ specific thresholds"), así que nunca se proponen solos.
CARDIO_OFFERED = ("walking_brisk", "continuous_moderate", "jump_rope", "hiit")
ALL_OUT = ("sprints", "sit", "rehit")


def cardio_split(needed: int, days: list[str]) -> tuple[list[str], int]:
    """Los días de cardio y los minutos de cada uno para cubrir `needed`, sin sesiones de menos de
    `CARDIO_MIN_SESSION` (F9). Los días que se usan quedan repartidos por la semana."""
    if needed <= 0 or not days:
        return [], 0
    count = max(1, min(len(days), needed // CARDIO_MIN_SESSION))
    per_day = max(CARDIO_MIN_SESSION, math.ceil(needed / count / CARDIO_STEP_MIN) * CARDIO_STEP_MIN)
    chosen = [days[(i * len(days)) // count] for i in range(count)]
    return chosen, per_day


def _cardio(user, state: safety_state.SafetyState, today: date, days: list[str], mma_minutes: int, lang: str) -> dict:
    needed = max(0, CARDIO_MODERATE_MIN - mma_minutes)
    days, per_day = cardio_split(needed, days)
    try:
        zone = next((z for z in zones_data(user, today, lang)["zones"] if z["name"] == "moderate"), None)
    except ProfileIncomplete:
        zone = None
    options, excluded = [], []
    for key in CARDIO_OFFERED:
        item = _modality(key, state)
        (excluded if item["blocked_by"] else options).append(item)
    for key in ALL_OUT:
        item = _modality(key, state)
        item["blocked_by"] = item["blocked_by"] or ["prerequisites"]
        excluded.append(item)
    return {
        "minutes_week": CARDIO_MODERATE_MIN,
        "mma_minutes": mma_minutes,
        "minutes_needed": needed,
        "days": days,
        "minutes_per_day": per_day,
        "min_session": CARDIO_MIN_SESSION,
        "min_session_convention": "fightlab",
        "intensity": rules.MODERATE,
        "zone": {"rpe": zone["rpe"], "bpm": zone["bpm"]} if zone else None,
        "rule_key": _key(rules.WEEKLY_BASELINE),
        "mma_convention": "fightlab" if mma_minutes else None,
        "options": options,
        "excluded": excluded,
    }


def _mma_entry(day: str, state: safety_state.SafetyState, time: str | None) -> dict:
    work = [_modality(k, state) for k in rules.COMBAT_WORK]
    return {
        "day": day,
        "time": time,
        "kind": "mma",
        "allowed": [w for w in work if not w["blocked_by"]],
        "excluded": [w for w in work if w["blocked_by"]],
    }


# ---------------------------------------------------------------- nutrición


def _nutrition(user, today: date) -> dict:
    try:
        data = targets_data(user, today, "en")
    except ProfileIncomplete as exc:
        return {"missing": exc.field}
    return {
        "blocked": data["blocked"],
        "kcal": data["kcal"],
        "in_deficit": data["in_deficit"],
        "macros": data["macros"],
        "rules": {name: [r["key"] for r in refs] for name, refs in data["rules"].items()},
        "reasons": [{"code": r["code"], "rule_key": r["rule_key"], "params": r["params"], "original_text": ""}
                    for r in data["reasons"]],
    }


# ---------------------------------------------------------------- generador


def _previous_plan(user) -> WeeklyPlan | None:
    return (
        WeeklyPlan.objects.filter(profile=user.profile)
        .exclude(status=WeeklyPlan.Status.DRAFT)
        .order_by("-week_start", "-created_at")
        .first()
    )


def _previous_ranges(plan: WeeklyPlan | None) -> dict[str, list[int]]:
    if plan is None:
        return {}
    return {i["exercise"]: i["rep_range"] for s in plan.sessions for i in s.get("items", [])}


def deload_for(user, week_start: date) -> dict | None:
    """La descarga que la revisión semanal aceptada pide para la semana `week_start`, o `None`."""
    review = (
        WeeklyReview.objects.filter(
            profile=user.profile, status=WeeklyReview.Status.ACCEPTED, plan_week_start=week_start
        )
        .order_by("-accepted_at")
        .first()
    )
    if review is None or "deload" not in review.accepted:
        return None
    d = next((p for p in review.proposals if p["kind"] == "deload"), None)
    if d is None:
        return None
    return {
        "review_id": review.id,
        "volume_cut": d["volume_cut"],
        "stop_rir": d["stop_rir"],
        "extra_rest_days": d["extra_rest_days"],
        "rule_key": _key(DELOADS),
        "sets_convention": "fightlab",
    }


def deload_sets(sets: int, volume_cut) -> int:
    """Series de la semana de descarga. convention (FightLab): `ceil(series × (1 − corte máximo))`,
    que con 2-5 series deja un recorte dentro del 30-50 % del motor ("Deloads")."""
    if sets <= 0:
        return sets
    return max(1, math.ceil(sets * (1 - volume_cut[1])))


def _last_load(history) -> float | None:
    """La carga más alta de trabajo de la última sesión registrada del ejercicio."""
    working = [s for s in history if coach_strength.is_working(s) and s.weight_kg is not None]
    if not working:
        return None
    last = max(s.date for s in working)
    return max(s.weight_kg for s in working if s.date == last)


def _apply_deload(sessions: list[dict], deload: dict, records_by_name: dict) -> None:
    """Semana de descarga: menos series, las mismas cargas y sin progresar."""
    for session in sessions:
        session["effort"] = {"rir": [deload["stop_rir"], deload["stop_rir"]], "rule_key": deload["rule_key"]}
        for item in session["items"]:
            if item["action"] in ("paused", "no_training") or item["sets"] <= 0:
                continue
            item["sets"] = deload_sets(item["sets"], deload["volume_cut"])
            item["sets_basis"] = "deload"
            item["sets_rule_key"] = deload["rule_key"]
            last = _last_load(records_by_name.get(item["exercise"], []))
            if item["load_kg"] is not None and last is not None:
                item["load_kg"] = min(item["load_kg"], last)
            elif last is not None:
                item["load_kg"] = last
            if item["action"] != "no_data":
                item["action"] = "deload"
                item["rule_key"] = deload["rule_key"]


def _validate_days(days, code: str) -> list[str]:
    if any(d not in DAYS for d in days):
        raise PlanInvalid(f"{code}_invalid")
    return _ordered(days)


def check_trainable(user, today: date):
    """Perfil del coach y flags, o `PlanBlocked` / `ProfileIncomplete` (spec §8.1)."""
    profile = to_coach_profile(user, today)
    flags = safety.flags(profile, today)
    if not flags.screened:
        raise ProfileIncomplete("screening.scoff_yes_count")
    if flags.no_training:
        raise PlanBlocked([parse_reason(t) for t in dict.fromkeys(flags.reasons)])
    return profile, flags


def defaults(user, today: date) -> dict:
    detected = mma_days_detected(user, today)
    previous = _previous_plan(user)
    gym = [e["day"] for e in previous.training_schedule if e["kind"] == "gym"] if previous else []
    return {
        "mma_days_detected": detected,
        "mma_days": detected,
        "gym_days": gym or default_gym_days(detected),
        "min_gym_days": MIN_GYM_DAYS,
        "max_gym_days": MAX_GYM_DAYS,
    }


def build(user, today: date, request: PlanRequest) -> dict:
    """Los campos del plan (sin guardar). Todo sale del motor o de una regla; nada del LLM."""
    profile, flags = check_trainable(user, today)
    state = safety_state.of(user.profile, today, flags)
    fight = state.fight

    mma_days = _validate_days(request.mma_days if request.mma_days is not None else mma_days_detected(user, today), "mma_days")
    previous = _previous_plan(user)
    gym_days = request.gym_days
    if gym_days is None:
        previous_gym = [e["day"] for e in previous.training_schedule if e["kind"] == "gym"] if previous else []
        gym_days = previous_gym or default_gym_days(mma_days)
    gym_days = _validate_days(gym_days, "gym_days")
    if len(gym_days) < MIN_GYM_DAYS:
        raise PlanInvalid("too_few_gym_days")
    if len(gym_days) > MAX_GYM_DAYS:
        raise PlanInvalid("too_many_gym_days")
    times = {d: t for d, t in (request.times or {}).items() if d in DAYS and t}

    records = set_records(user, until=today)
    since = today - timedelta(days=MMA_LOOKBACK_DAYS)
    by_name: dict[str, list] = defaultdict(list)
    for s in records:
        by_name[s.exercise].append(s)
    last_week_end = max((s.date for s in records), default=today)
    last_week = [s for s in records if last_week_end - timedelta(days=6) <= s.date <= last_week_end]
    ctx = _Context(
        today=today,
        profile=profile,
        flags=flags,
        records_by_name=by_name,
        since=since,
        weekly_sets=coach_strength.weekly_hard_sets(last_week, muscle_map()),
        previous_ranges=_previous_ranges(previous),
        goal=profile.goal,
    )
    candidates = _candidates(records, since)
    sessions = [_session(i, candidates, ctx) for i in range(len(SESSION_KEYS))]
    effort = _effort(profile, flags, today)
    for session in sessions:
        session["effort"] = effort
    week_start = request.week_start or week_start_for(today)
    deload = deload_for(user, week_start)
    if deload:
        _apply_deload(sessions, deload, by_name)

    last = last_plan_session(user)
    start = (SESSION_KEYS.index(last) + 1) % len(SESSION_KEYS) if last else 0
    schedule = []
    for i, day in enumerate(gym_days):
        schedule.append({
            "day": day,
            "time": times.get(day),
            "kind": "gym",
            "session": SESSION_KEYS[(start + i) % len(SESSION_KEYS)],
            "rule_key": _key(rules.WEEKLY_BASELINE),
            "rotation_convention": "coach",
        })
    for day in mma_days:
        schedule.append(_mma_entry(day, state, times.get(day)))

    cardio_days = request.cardio_days
    if cardio_days is None:
        cardio_days = [d for d in DAYS if d not in gym_days and d not in mma_days] or gym_days
    cardio_days = _validate_days(cardio_days, "cardio_days")
    cardio = _cardio(user, state, today, cardio_days, mma_minutes_per_week(user, today), "en")
    for day in cardio["days"]:
        schedule.append({"day": day, "time": times.get(day), "kind": "cardio",
                         "minutes": cardio["minutes_per_day"], "rule_key": cardio["rule_key"]})
    schedule.sort(key=lambda e: (DAYS.index(e["day"]), ("mma", "gym", "cardio").index(e["kind"])))

    nutrition = _nutrition(user, today)
    safety_reasons = [_reason_dict(parse_reason(t)) for t in dict.fromkeys(flags.reasons)]
    safety_reasons += [_reason_dict(r) for r in fight.reasons]

    keys = {effort["rule_key"], cardio["rule_key"], _key(FULL_BODY), _key(rules.WEEKLY_BASELINE)}
    if deload:
        keys.add(deload["rule_key"])
    for s in sessions:
        for item in s["items"]:
            keys.add(item["rule_key"])
            keys.add(item["sets_rule_key"])
            keys.update(r["rule_key"] for r in item["reasons"])
    for entry in schedule:
        for w in entry.get("allowed", []) + entry.get("excluded", []):
            keys.add(w["rule_key"])
    for w in cardio["options"] + cardio["excluded"]:
        keys.add(w["rule_key"])
    for refs in (nutrition.get("rules") or {}).values():
        keys.update(refs)
    keys.update(r["rule_key"] for r in safety_reasons)
    if last:
        keys.add(_key(HOW_LONG_HABITS))

    return {
        "week_start": week_start,
        "target_kcal": nutrition.get("kcal"),
        "in_deficit": bool(nutrition.get("in_deficit")),
        "training_schedule": schedule,
        "sessions": sessions,
        "cardio": cardio,
        "nutrition": nutrition,
        "safety_reasons": safety_reasons,
        "rules_used": sorted(k for k in keys if k),
        "engine_sha": engine_info()["sha_full"],
        "deload": deload,
    }


@transaction.atomic
def generate(user, today: date, request: PlanRequest, lang: str = "es", narrate=None) -> WeeklyPlan:
    """Genera y guarda un borrador. `narrate(plan_data, lang) -> str` escribe solo `narrative`."""
    fields = build(user, today, request)
    WeeklyPlan.objects.filter(
        profile=user.profile, week_start=fields["week_start"], status=WeeklyPlan.Status.DRAFT
    ).delete()
    plan = WeeklyPlan.objects.create(profile=user.profile, status=WeeklyPlan.Status.DRAFT, **fields)
    if narrate is not None:
        text = narrate(plan_data(plan, lang), lang)
        if text:
            plan.narrative = text
            plan.save(update_fields=["narrative"])
    return plan


@transaction.atomic
def apply(user, plan: WeeklyPlan, today: date) -> WeeklyPlan:
    """"Aplicar": el plan pasa a Mi rutina (`active`) y el anterior queda sustituido."""
    check_trainable(user, today)
    WeeklyPlan.objects.filter(profile=user.profile, status=WeeklyPlan.Status.ACTIVE).exclude(pk=plan.pk).update(
        status=WeeklyPlan.Status.SUPERSEDED
    )
    plan.status = WeeklyPlan.Status.ACTIVE
    plan.applied_at = timezone.now()
    plan.save(update_fields=["status", "applied_at"])
    return plan


# ---------------------------------------------------------------- seguridad de hoy (F26)


def live_safety(plan: WeeklyPlan, today: date) -> dict | None:
    """Los bloqueos de hoy aplicados a un plan ya hecho, sin rehacerlo (F26).

    Un golpe en la cabeza con síntomas (`no_contact`) o una lesión registrada después de preparar el
    plan cuentan al momento: el trabajo de combate de cada día de MMA se vuelve a calcular con los
    flags de hoy (y vuelve cuando un clínico da el alta, que es lo único que quita `no_contact`), y
    un ejercicio que ahora afecta una lesión pasa a «en pausa» con su motivo, sin carga si nadie la ha
    valorado ("Some pain during exercise is acceptable in chronic, assessed pain"). Lo demás del plan
    no se toca. Devuelve `None` si el motor no puede evaluar el perfil (se enseña el plan tal cual).
    """
    try:
        profile = to_coach_profile(plan.profile.user, today)
    except (ProfileIncomplete, ValueError):
        return None
    flags = safety.flags(profile, today)
    state = safety_state.of(plan.profile, today, flags)
    fight = state.fight
    changed = False

    schedule = []
    for entry in plan.training_schedule or []:
        if entry.get("kind") == "mma":
            fresh = _mma_entry(entry["day"], state, entry.get("time"))
            before = {w["key"]: w.get("blocked_by") for w in entry.get("excluded", [])}
            if before != {w["key"]: w["blocked_by"] for w in fresh["excluded"]}:
                changed = True
            entry = {**entry, "allowed": fresh["allowed"], "excluded": fresh["excluded"]}
        schedule.append(entry)

    # R3-3: las opciones de cardio también siguen el bloqueo de hoy (nada vigoroso tras el golpe)
    cardio = dict(plan.cardio or {})
    if cardio.get("options") is not None:
        offered = [*cardio.get("options", []), *[w for w in cardio.get("excluded", []) if w.get("key") in CARDIO_OFFERED]]
        before = {w["key"]: w.get("blocked_by") for w in cardio.get("excluded", [])}
        options, excluded = [], []
        for w in offered:
            fresh = _modality(w["key"], state)
            (excluded if fresh["blocked_by"] else options).append(fresh)
        for w in cardio.get("excluded", []):
            if w.get("key") in ALL_OUT:
                fresh = _modality(w["key"], state)
                fresh["blocked_by"] = fresh["blocked_by"] or ["prerequisites"]
                excluded.append(fresh)
        if before != {w["key"]: w["blocked_by"] for w in excluded}:
            changed = True
        cardio = {**cardio, "options": options, "excluded": excluded}

    mapped = muscle_map()
    sessions = []
    for session in plan.sessions or []:
        items = []
        for item in session.get("items", []):
            pause = coach_strength.find_pause(item["exercise"], flags.paused_exercises, mapped)
            if pause and item.get("action") not in ("paused", "no_training"):
                changed = True
                reasons = [_reason_dict(parse_reason(t)) for t in dict.fromkeys(pause.reasons)]
                item = {
                    **item,
                    "action": "paused",
                    "load_kg": item.get("load_kg") if pause.assessed else None,
                    "rule_key": reasons[0]["rule_key"] if reasons else item.get("rule_key"),
                    "reasons": reasons + list(item.get("reasons", [])),
                    "live": True,
                }
            items.append(item)
        sessions.append({**session, "items": items})

    saved = {(r["code"], r.get("rule_key")) for r in plan.safety_reasons or []}
    now = [_reason_dict(r) for r in fight.reasons] + [
        _reason_dict(parse_reason(t)) for t in dict.fromkeys(flags.reasons)
    ]
    new_reasons = [r for r in now if (r["code"], r["rule_key"]) not in saved]
    if new_reasons:
        changed = True
    keys = {r["rule_key"] for r in new_reasons}
    for session in sessions:
        for item in session["items"]:
            keys.update(r["rule_key"] for r in item.get("reasons") or [])
    if fight.no_contact:
        keys.update((NO_CONTACT_RULE, RETURN_STEPS_RULE))
    return {
        "training_schedule": schedule,
        "sessions": sessions,
        "cardio": cardio,
        "safety_reasons": new_reasons + list(plan.safety_reasons or []),
        "rules": sorted(k for k in keys if k),
        "status": {
            "changed": changed,
            "no_contact": fight.no_contact,
            "no_training": bool(flags.no_training),
            # La vuelta al contacto: por fases, la supervisa y la autoriza un clínico (la regla de
            # la tarjeta del golpe). Solo se enseña mientras dura el bloqueo.
            "return_rule_key": RETURN_STEPS_RULE if fight.no_contact else None,
        },
    }


# ---------------------------------------------------------------- lectura


def _reasons_out(raw: list[dict], lang: str) -> list[dict]:
    return reasons_data([Reason(**r) for r in raw], lang)


def plan_data(plan: WeeklyPlan, lang: str, today: date | None = None) -> dict:
    """El plan para la API, con los motivos y los títulos de las reglas en `lang`. Con `today`, con
    los bloqueos de seguridad de ese día ya aplicados (`live_safety`, F26)."""
    live = live_safety(plan, today) if today is not None else None
    raw_sessions = live["sessions"] if live else plan.sessions
    sessions = [
        {**s, "items": [{**i, "reasons": _reasons_out(i["reasons"], lang)} for i in s["items"]]}
        for s in raw_sessions
    ]
    nutrition = dict(plan.nutrition or {})
    if "reasons" in nutrition:
        nutrition["reasons"] = _reasons_out(nutrition["reasons"], lang)
    return {
        "id": plan.id,
        "week_start": plan.week_start.isoformat(),
        "status": plan.status,
        "target_kcal": plan.target_kcal,
        "in_deficit": plan.in_deficit,
        "training_schedule": live["training_schedule"] if live else plan.training_schedule,
        "sessions": sessions,
        "cardio": live["cardio"] if live else plan.cardio,
        "nutrition": nutrition,
        "safety_reasons": _reasons_out(live["safety_reasons"] if live else plan.safety_reasons, lang),
        "rules": rule_refs(sorted(set(plan.rules_used) | set(live["rules"] if live else [])), lang),
        "live": live["status"] if live else None,
        "engine_sha": plan.engine_sha[:7],
        "narrative": plan.narrative,
        "deload": plan.deload,
        "created_at": plan.created_at.isoformat(),
        "applied_at": plan.applied_at.isoformat() if plan.applied_at else None,
    }
