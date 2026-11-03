"""Revisión semanal (Tasks 7.1-7.4), siguiendo `review/SKILL.md` del coach.

- Adherencia: el plan de la fase 6 que estaba en vigor frente a lo registrado (sesiones de
  gimnasio, MMA y cardio de la semana, y la ingesta del check-in frente al objetivo).
- Peso: `coach.trend.weight_trend`. Con `no_weight_targets` no se dice nada de peso ni de kcal.
- Calorías: con 4 semanas de pesajes y la ingesta registrada, `coach.trend.recalibrate_tdee`. Un
  cambio solo se propone si el ritmo está fuera del rango que da la regla del objetivo
  (`maintenance` y `recomposition` no tienen rango, así que nunca), y lo calcula el motor
  (`energy.calorie_target(recalibrated=True)`), que baja de escalón en escalón
  (`RECALIBRATE_STEP_KCAL`). Con `no_deficit` o `hold_deficit` nunca se propone un déficit.
- Entrenamiento: series duras por músculo y la progresión de cada ejercicio (`coaching.strength`).
  Un ejercicio `stalled` cuenta como señal de estancamiento.
- Recuperación: `coach.strength.deload` con las 6 señales del formulario. Con `no_training` no
  hay consejos de entrenamiento, carga ni descarga.
- Aceptar: se guarda lo aceptado y, si se aceptó un cambio, se genera un `WeeklyPlan` nuevo con
  el generador de la fase 6 para la semana siguiente a la revisada. El TDEE de una revisión
  aceptada lo usa `coach/targets` (fase 4).
- Evidencia antigua (`coach.knowledge.stale_files`): solo para el admin.

El LLM solo escribe `narrative` (`review_narrative.py`), después de guardar los números.
"""
from collections import Counter
from dataclasses import asdict
from datetime import date, datetime, time, timedelta
from pathlib import Path
from statistics import fmean

from coach import energy, safety
from coach import knowledge as coach_knowledge
from coach import strength as coach_strength
from coach import trend as coach_trend
from coach.profile import Profile, ProfileIncomplete
from django.db import transaction
from django.utils import timezone

from activities.models import Activity

from . import plan as plans
from . import strength, trend
from .bridge.adapters import _tz, set_records, to_coach_profile
from .bridge.muscle_map import muscle_map
from .bridge.reasons import Reason, parse_reason
from .knowledge_loader import NOT_RULE_FILES
from .models import DailyCheckin, WeeklyPlan, WeeklyReview
from .targets import _key, reasons_data, rule_refs, targets_data
from .views import engine_info

# Las 6 señales del paso 1 de `review/SKILL.md` (las que acepta `coach strength deload`).
SIGNS = ("performance_stall", "joint_aches", "poor_sleep", "low_motivation", "drop_despite_rest", "low_mood")
STALL_SIGN = "performance_stall"
PROPOSAL_KINDS = ("calories", "deload")
WEEK_DAYS = 7
# convention (FightLab): se puede revisar una semana que acabó hace como mucho 8 semanas (el
# `MAX_WINDOW_DAYS` de la tendencia del motor).
MAX_PAST_DAYS = coach_trend.MAX_WINDOW_DAYS

SCALE_RULE = 'nutrition.md: "Read the scale with weekly averages"'
STALLS_RULE = coach_strength.STALLS
READINESS_RULE = 'recovery-habits.md: "Simple readiness monitoring"'
# Rango de ritmo de cada objetivo, en % del peso por semana, tal como lo da su regla (la pérdida
# es negativa, como el `rate_pct_week` del motor).
RATE_RULES = {
    # nutrition.md: "Rate of loss for lean, trained clients": about 0.5-1% of body weight per week.
    "fat_loss": ('nutrition.md: "Rate of loss for lean, trained clients"', (-1.0, -0.5)),
    # nutrition.md: "Surplus size for muscle gain": about 0.25-0.5% of body weight per week.
    "muscle_gain": ('nutrition.md: "Surplus size for muscle gain"', (0.25, 0.5)),
}
ALWAYS_RULES = (energy.RECALIBRATE_RULE, SCALE_RULE, STALLS_RULE, READINESS_RULE)

# Qué registro cuenta como hecho para cada tipo de día del plan. convention (FightLab): el cardio
# del plan se cumple con cualquier deporte registrado (correr, bici, nadar…).
DONE_KIND = {"gym": Activity.Kind.GYM, "mma": Activity.Kind.MMA, "cardio": Activity.Kind.SPORT}

ANNEX_DIR = Path(__file__).resolve().parents[1] / "knowledge_fightlab"
STALE_MONTHS = Profile.research_reminder_months  # 6, el del coach (`docs/conventions.md`)


class ReviewInvalid(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class ReviewConflict(Exception):
    def __init__(self, code: str, reasons: list[Reason] | None = None):
        self.code = code
        self.reasons = reasons or []
        super().__init__(code)


def _reason_dict(reason: Reason) -> dict:
    return asdict(reason)


def _reasons(texts) -> list[dict]:
    return [_reason_dict(parse_reason(t)) for t in dict.fromkeys(texts)]


# ---------------------------------------------------------------- adherencia


def plan_in_force(user, week_end: date) -> WeeklyPlan | None:
    """El último plan aplicado (Mi rutina) cuya semana empieza antes del final de la revisada."""
    return (
        WeeklyPlan.objects.filter(profile=user.profile, week_start__lte=week_end, applied_at__isnull=False)
        .exclude(status=WeeklyPlan.Status.DRAFT)
        .order_by("-applied_at")
        .first()
    )


def _activities(user, start: date, end: date) -> list[tuple[date, str]]:
    tz = _tz(user.profile)
    since = datetime.combine(start, time.min, tzinfo=tz)
    until = datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz)
    return [
        (at.astimezone(tz).date(), kind)
        for at, kind in Activity.objects.filter(
            profile=user.profile, started_at__gte=since, started_at__lt=until
        ).values_list("started_at", "kind")
    ]


def _intakes(user, start: date, end: date) -> list[int]:
    return list(
        DailyCheckin.objects.filter(profile=user.profile, date__gte=start, date__lte=end, intake_kcal__isnull=False)
        .values_list("intake_kcal", flat=True)
    )


def adherence_data(user, start: date, end: date, plan: WeeklyPlan | None, target_kcal: int | None,
                   kcal_blocked: bool) -> dict:
    done = _activities(user, start, end)
    done_days = {(day, kind) for day, kind in done}
    counts = Counter(kind for _, kind in done)
    entries = []
    if plan is not None:
        dates = {plans.DAYS[(start + timedelta(days=i)).weekday()]: start + timedelta(days=i) for i in range(WEEK_DAYS)}
        for e in plan.training_schedule:
            day = dates[e["day"]]
            entries.append({
                "day": e["day"],
                "date": day.isoformat(),
                "kind": e["kind"],
                "session": e.get("session"),
                "done": (day, DONE_KIND[e["kind"]]) in done_days,
            })
    planned = Counter(e["kind"] for e in entries)
    sessions = {
        kind: {"planned": planned[kind] if plan is not None else None, "done": counts[DONE_KIND[kind]]}
        for kind in DONE_KIND
    }
    if kcal_blocked:
        nutrition = {"blocked": True, "days_logged": 0, "mean_kcal": None, "target_kcal": None, "diff_kcal": None}
    else:
        intakes = _intakes(user, start, end)
        mean = round(fmean(intakes)) if intakes else None
        nutrition = {
            "blocked": False,
            "days_logged": len(intakes),
            "mean_kcal": mean,
            "target_kcal": target_kcal,
            "diff_kcal": mean - target_kcal if mean is not None and target_kcal is not None else None,
        }
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "plan_id": plan.id if plan else None,
        "plan_week_start": plan.week_start.isoformat() if plan else None,
        "planned_total": sum(planned.values()) if plan is not None else None,
        "done_planned": sum(1 for e in entries if e["done"]) if plan is not None else None,
        "sessions": sessions,
        "entries": entries,
        "nutrition": nutrition,
    }


# ---------------------------------------------------------------- peso y calorías


def _trend_copy(result) -> dict:
    return {
        "status": result.status,
        "rate_kg_week": result.rate_kg_week,
        "rate_pct_week": result.rate_pct_week,
        "weight_kg": result.weight_kg,
        "points": result.points,
        "days": result.days,
        "start": result.start.isoformat() if result.start else None,
        "end": result.end.isoformat() if result.end else None,
        "can_recalibrate": result.can_recalibrate,
        "min_points": coach_trend.MIN_POINTS,
        "min_days": coach_trend.MIN_DAYS,
        "rule_key": trend.TREND_RULE,
        "reasons": [
            _reason_dict(r if r.rule_key else Reason(r.code, trend.TREND_RULE, r.params, r.original_text))
            for r in (parse_reason(n) for n in result.notes)
        ],
    }


def _current_kcal(user, today: date, plan: WeeklyPlan | None) -> int | None:
    """El objetivo en vigor: el del plan aplicado o, sin plan, el de `coach/targets`."""
    if plan is not None and plan.target_kcal is not None:
        return plan.target_kcal
    try:
        return targets_data(user, today, "en")["kcal"]
    except ProfileIncomplete:
        return None


def calories_data(user, profile, flags, today: date, week_end: date, current_kcal: int | None):
    """`(trend, calories, recalibrated_tdee, proposal | None)`. Sin nada de peso ni de kcal si los
    flags lo bloquean."""
    policy, result = trend.compute(user, week_end)
    if result is None or flags.no_weight_targets:
        reasons = [_reason_dict(r) for r in policy.reasons] or _reasons([safety.weight_block_reason(flags)])
        return {"status": "disabled", "blocked": True, "reasons": reasons}, {"status": "blocked"}, None, None
    trend_out = {**_trend_copy(result), "blocked": False}
    if flags.no_calorie_targets:
        return trend_out, {"status": "blocked", "reasons": _reasons([safety.calorie_block_reason(flags)])}, None, None

    goal = profile.goal
    rate_rule = RATE_RULES.get(goal)
    calories = {
        "status": "insufficient_data",
        "goal": goal,
        "rate_rule_key": _key(rate_rule[0]) if rate_rule else None,
        "range_pct": list(rate_rule[1]) if rate_rule else None,
        "in_range": None,
        "tdee_status": None,
        "tdee_kcal": None,
        "intake_days": 0,
        "intake_mean_kcal": None,
        "recalibrate_rule_key": _key(energy.RECALIBRATE_RULE),
        "current_kcal": current_kcal,
        "proposal": False,
        "reasons": [],
    }
    if result.status != "ok":
        return trend_out, calories, None, None
    if rate_rule:
        low, high = rate_rule[1]
        calories["in_range"] = low <= result.rate_pct_week <= high
        calories["status"] = "in_range" if calories["in_range"] else "out_of_range"
    else:
        calories["status"] = "no_rate_rule"

    tdee = None
    if not result.can_recalibrate:
        calories["tdee_status"] = "wait"
    else:
        intakes = _intakes(user, result.start, result.end)
        calories["intake_days"] = len(intakes)
        if not intakes:
            calories["tdee_status"] = "no_intake"
        else:
            calories["intake_mean_kcal"] = round(fmean(intakes))
            tdee = coach_trend.recalibrate_tdee(result, fmean(intakes))
            calories["tdee_status"] = "ok"
    calories["tdee_kcal"] = round(tdee) if tdee is not None else None

    proposal = None
    if calories["in_range"] is False and tdee is not None and current_kcal is not None:
        target = energy.calorie_target(
            profile, flags, today=today, tdee_kcal=tdee, current_kcal=current_kcal, recalibrated=True
        )
        no_deficit = bool(energy.deficit_blockers(profile, flags, today)) or flags.hold_deficit
        calories["reasons"] = _reasons(target.notes)
        if target.kcal != current_kcal and not (no_deficit and target.deficit > 0):
            proposal = {
                "kind": "calories",
                "kcal": target.kcal,
                "current_kcal": current_kcal,
                "change_kcal": target.kcal - current_kcal,
                "tdee_kcal": round(tdee),
                "deficit_kcal": target.deficit,
                "in_deficit": target.deficit > 0,
                "stepped": any(r["code"] == "recalibrate_step" for r in calories["reasons"]),
                "rule_key": _key(energy.RECALIBRATE_RULE),
                "reasons": calories["reasons"],
            }
            calories["proposal"] = True
    return trend_out, calories, tdee, proposal


# ---------------------------------------------------------------- entrenamiento y descarga


def training_data(user, profile, flags, week_end: date) -> dict:
    records = set_records(user, until=week_end)
    start, end = strength.week_bounds(records, week_end, week_end)
    mapped = muscle_map()
    week = [s for s in records if start <= s.date <= end]
    sets = coach_strength.weekly_hard_sets(week, mapped)
    by_name = strength._by_exercise(records)
    recent = week_end - timedelta(days=strength.PROGRESS_LOOKBACK_DAYS)
    lifts = []
    for name in sorted({s.exercise for s in records if s.date > recent}):
        suggestion = strength.suggestion_for(name, by_name[name], week_end, flags, profile)
        reasons = [parse_reason(t) for t in dict.fromkeys(suggestion.reasons)]
        lifts.append({
            "exercise": name,
            "action": suggestion.action,
            "load_kg": suggestion.load_kg,
            "rep_range": list(suggestion.rep_range),
            "rule_key": strength.suggestion_rule_key(suggestion, reasons),
            "reasons": [_reason_dict(r) for r in reasons],
        })
    return {
        "week": {"start": start.isoformat(), "end": end.isoformat()},
        "sets": {muscle: round(value, 2) for muscle, value in sorted(sets.items())},
        "unmapped": coach_strength.unmapped_exercises(week, mapped),
        "reference_sets_per_week": coach_strength.WEEKLY_SETS_REFERENCE,
        "sets_rule_key": _key(strength.WEEKLY_SETS_RULE),
        "lifts": lifts,
        "stalled": [lift["exercise"] for lift in lifts if lift["action"] == "stalled"],
    }


def deload_data(signs: set[str], flags) -> tuple[dict, dict | None]:
    """`(estado, propuesta | None)` de `coach.strength.deload` con las señales marcadas."""
    if flags.no_training:
        return {"status": "no_training", "rule_key": _key(coach_strength.DELOADS)}, None
    if not signs:  # sin señales no se llama al motor (`review/SKILL.md` paso 6)
        return {"status": "no_signs", "rule_key": _key(coach_strength.DELOADS)}, None
    result = coach_strength.deload(signs)
    if result is None:
        return {"status": "not_indicated", "rule_key": _key(coach_strength.DELOADS)}, None
    proposal = {
        "kind": "deload",
        "volume_cut": list(result.volume_cut),
        "stop_rir": result.stop_rir,
        "extra_rest_days": list(result.extra_rest_days),
        "rule_key": _key(coach_strength.DELOADS),
        "reasons": _reasons(result.reasons),
    }
    return {"status": "indicated", "rule_key": proposal["rule_key"]}, proposal


# ---------------------------------------------------------------- generar y aceptar


def default_week_end(today: date) -> date:
    return today


def check_week_end(week_end: date, today: date) -> None:
    if week_end > today:
        raise ReviewInvalid("week_end_future")
    if (today - week_end).days > MAX_PAST_DAYS:
        raise ReviewInvalid("week_end_too_old")


def build(user, today: date, week_end: date, signs: set[str]) -> dict:
    """Los campos de la revisión (sin guardar). Todo sale del motor o de una regla; nada del LLM."""
    check_week_end(week_end, today)
    if signs - set(SIGNS):
        raise ReviewInvalid("signs_invalid")
    profile = to_coach_profile(user, today)
    flags = safety.flags(profile, today)
    if not flags.screened:
        raise ProfileIncomplete("screening.scoff_yes_count")

    start = week_end - timedelta(days=WEEK_DAYS - 1)
    plan = plan_in_force(user, week_end)
    kcal_blocked = flags.no_weight_targets or flags.no_calorie_targets
    current = None if kcal_blocked else _current_kcal(user, today, plan)
    trend_out, calories, tdee, cal_proposal = calories_data(user, profile, flags, today, week_end, current)
    adherence = adherence_data(user, start, week_end, plan, current, kcal_blocked)

    training = None if flags.no_training else training_data(user, profile, flags, week_end)
    derived = {STALL_SIGN} if training and training["stalled"] else set()
    all_signs = set(signs) | derived
    deload, deload_proposal = deload_data(all_signs, flags)
    proposals = [p for p in (cal_proposal, deload_proposal) if p]

    safety_reasons = _reasons(flags.reasons)
    keys = {_key(r) for r in ALWAYS_RULES}
    if calories.get("rate_rule_key"):
        keys.add(calories["rate_rule_key"])
    if all_signs or deload_proposal:
        keys.add(_key(coach_strength.DELOADS))
    if training:
        keys.add(training["sets_rule_key"])
        for lift in training["lifts"]:
            keys.add(lift["rule_key"])
            keys.update(r["rule_key"] for r in lift["reasons"])
    for group in (trend_out.get("reasons", []), calories.get("reasons", []), safety_reasons,
                  *(p["reasons"] for p in proposals)):
        keys.update(r["rule_key"] for r in group)
    if kcal_blocked:  # con el peso bloqueado no se cita nada de peso ni de calorías
        keys -= {_key(energy.RECALIBRATE_RULE), _key(SCALE_RULE)}

    return {
        "week_end": week_end,
        "goal": profile.goal or "",
        "adherence": adherence,
        "trend": trend_out,
        "recalibrated_tdee": tdee,
        "current_kcal": current,
        "calories": calories,
        "training": training,
        "signs": [s for s in SIGNS if s in all_signs],
        "deload": {**deload, "signs_given": [s for s in SIGNS if s in signs], "signs_derived": sorted(derived)},
        "proposals": proposals,
        "safety_reasons": safety_reasons,
        "rules_used": sorted(k for k in keys if k),
        "engine_sha": engine_info()["sha_full"],
    }


@transaction.atomic
def generate(user, today: date, week_end: date, signs: set[str], lang: str = "es", narrate=None) -> WeeklyReview:
    """Genera y guarda la revisión (pendiente). `narrate(review_data, lang) -> str` solo escribe
    `narrative`, después de guardar los números."""
    fields = build(user, today, week_end, signs)
    WeeklyReview.objects.filter(
        profile=user.profile, week_end=week_end, status=WeeklyReview.Status.PENDING
    ).delete()
    review = WeeklyReview.objects.create(profile=user.profile, **fields)
    if narrate is not None:
        text = narrate(review_data(review, lang), lang)
        if text:
            review.narrative = text
            review.save(update_fields=["narrative"])
    return review


def latest(user) -> WeeklyReview | None:
    return WeeklyReview.objects.filter(profile=user.profile).order_by("-week_end", "-created_at").first()


def next_plan_week(review: WeeklyReview, today: date) -> date:
    """La semana del plan que sale de la revisión: la que sigue a la revisada (o la actual)."""
    return max(plans.week_start_for(review.week_end + timedelta(days=1)), plans.week_start_for(today))


@transaction.atomic
def accept(user, review: WeeklyReview, kinds: list[str], today: date, lang: str = "es", narrate=None) -> WeeklyReview:
    """Acepta las propuestas `kinds` (o ninguna: solo se registra el TDEE). Con algún cambio
    aceptado se genera un `WeeklyPlan` nuevo (borrador) para la semana siguiente."""
    if review.status == WeeklyReview.Status.ACCEPTED:
        raise ReviewConflict("already_accepted")
    newest = latest(user)
    if newest is not None and newest.pk != review.pk:
        raise ReviewConflict("superseded")
    offered = {p["kind"]: p for p in review.proposals}
    if set(kinds) - set(offered):
        raise ReviewInvalid("accept_invalid")
    profile = to_coach_profile(user, today)
    flags = safety.flags(profile, today)
    if "calories" in kinds and (flags.no_weight_targets or flags.no_calorie_targets):
        raise ReviewConflict("calories_blocked", [parse_reason(t) for t in dict.fromkeys(flags.reasons)])
    if "deload" in kinds and flags.no_training:
        raise ReviewConflict("no_training", [parse_reason(t) for t in dict.fromkeys(flags.reasons)])

    review.accepted = [k for k in PROPOSAL_KINDS if k in kinds]
    review.status = WeeklyReview.Status.ACCEPTED
    review.accepted_at = timezone.now()
    if "calories" in kinds:
        review.target_kcal = offered["calories"]["kcal"]
        review.in_deficit = offered["calories"]["in_deficit"]
    if review.accepted:
        review.plan_week_start = next_plan_week(review, today)
    review.save()

    if review.accepted:
        try:
            plan = plans.generate(
                user, today, plans.PlanRequest(week_start=review.plan_week_start), lang, narrate=narrate
            )
        except plans.PlanBlocked:  # con `no_training` no hay plan; lo aceptado queda guardado
            plan = None
        if plan is not None:
            review.plan = plan
            review.save(update_fields=["plan"])
    return review


# ---------------------------------------------------------------- evidencia antigua (admin)


def is_admin(user) -> bool:
    return bool(user.is_staff or user.is_superuser or getattr(user, "role", None) == "ADMIN")


def stale_knowledge(today: date, months: int = STALE_MONTHS) -> dict:
    """Archivos de evidencia cuya fecha "Evidence checked on" tiene más de `months` meses
    (`coach knowledge stale`), del coach y del anexo de combate de FightLab."""
    files = [
        {"file": f, "checked": d.isoformat() if d else None, "origin": "upstream"}
        for f, d in coach_knowledge.stale_files(months, today)
    ]
    if ANNEX_DIR.is_dir():
        files += [
            {"file": f, "checked": d.isoformat() if d else None, "origin": "fightlab"}
            for f, d in coach_knowledge.stale_files(months, today, ANNEX_DIR)
            if f not in NOT_RULE_FILES
        ]
    return {"months": months, "files": files}


# ---------------------------------------------------------------- lectura


def _reasons_out(raw: list[dict], lang: str) -> list[dict]:
    return reasons_data([Reason(**r) for r in raw], lang)


def review_data(review: WeeklyReview, lang: str) -> dict:
    """La revisión para la API, con los motivos y los títulos de las reglas en `lang`."""
    trend_out = dict(review.trend)
    if "reasons" in trend_out:
        trend_out["reasons"] = _reasons_out(trend_out["reasons"], lang)
    calories = dict(review.calories)
    if "reasons" in calories:
        calories["reasons"] = _reasons_out(calories["reasons"], lang)
    training = None
    if review.training is not None:
        training = {
            **review.training,
            "lifts": [{**lift, "reasons": _reasons_out(lift["reasons"], lang)} for lift in review.training["lifts"]],
        }
    proposals = [{**p, "reasons": _reasons_out(p["reasons"], lang)} for p in review.proposals]
    return {
        "id": review.id,
        "week_end": review.week_end.isoformat(),
        "status": review.status,
        "goal": review.goal or None,
        "adherence": review.adherence,
        "trend": trend_out,
        "calories": calories,
        "training": training,
        "signs": review.signs,
        "deload": review.deload,
        "proposals": proposals,
        "accepted": review.accepted,
        "accepted_at": review.accepted_at.isoformat() if review.accepted_at else None,
        "target_kcal": review.target_kcal,
        "plan_id": review.plan_id,
        "plan_week_start": review.plan_week_start.isoformat() if review.plan_week_start else None,
        "safety_reasons": _reasons_out(review.safety_reasons, lang),
        "rules": rule_refs(review.rules_used, lang),
        "engine_sha": review.engine_sha[:7],
        "narrative": review.narrative,
        "created_at": review.created_at.isoformat(),
    }
