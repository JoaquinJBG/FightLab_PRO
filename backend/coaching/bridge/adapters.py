"""Modelos de FightLab → objetos del motor `coach` (spec §6.8).

El puente solo llama a funciones puras del motor. Los nulos del cribado se omiten en lugar
de convertirse en `False`: para el coach, *sin contestar* no es *contestado con NO*.
"""
from dataclasses import dataclass
from datetime import date
from statistics import fmean
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from coach import profile as coach_profile
from coach.profile import Profile

from coaching.bridge.energy_athletes import BodyFat
from coaching.models import Screening

GENDER_TO_SEX = {"MALE": "male", "FEMALE": "female"}
INJURY_FIELDS = tuple(coach_profile.INJURY_KEYS)


def _tz(profile) -> ZoneInfo:
    try:
        return ZoneInfo(profile.timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def weigh_ins(user) -> list[tuple[date, float]]:
    """Pesajes de `BiometricsLog`, con la fecha en la zona horaria del perfil (más antiguo primero)."""
    profile = user.profile
    tz = _tz(profile)
    logs = profile.biometrics.filter(weight_kg__isnull=False).order_by("timestamp")
    return [(log.timestamp.astimezone(tz).date(), float(log.weight_kg)) for log in logs]


def daily_weights(user) -> list[tuple[date, float, int]]:
    """El peso de cada día: la media de los pesajes de ese día, con cuántos hubo (F28).

    Criterio de FightLab para dos pesajes el mismo día (el de Hoy por la mañana y otro de
    Biometría, por ejemplo): cuenta la media del día, que es como la tendencia del motor lee la
    báscula (`coach.trend`, medias diarias). Biometría, Hoy y la tendencia usan este mismo
    criterio. Más antiguo primero."""
    by_day: dict[date, list[float]] = {}
    for day, kg in weigh_ins(user):
        by_day.setdefault(day, []).append(kg)
    return [(day, fmean(values), len(values)) for day, values in sorted(by_day.items())]


def latest_weight(user, today: date | None = None) -> tuple[float, date] | None:
    """El peso del último día con pesaje (hasta `today`), la media de ese día, y su fecha, para
    avisar si es antiguo."""
    points = [(d, kg) for d, kg, _ in daily_weights(user) if today is None or d <= today]
    if not points:
        return None
    day, kg = points[-1]
    return kg, day


def latest_body_fat(user, today: date | None = None) -> BodyFat | None:
    """La última medida de grasa corporal (hasta `today`), con cómo se midió (U04)."""
    profile = user.profile
    tz = _tz(profile)
    for log in profile.biometrics.filter(body_fat_pct__isnull=False).order_by("-timestamp"):
        day = log.timestamp.astimezone(tz).date()
        if today is None or day <= today:
            weight = float(log.weight_kg) if log.weight_kg is not None else None
            return BodyFat(float(log.body_fat_pct), log.body_fat_method or None, day, weight)
    return None


def latest_resting_hr(user, today: date | None = None) -> tuple[int, date] | None:
    """La última frecuencia cardiaca en reposo registrada (hasta `today`) y su fecha."""
    profile = user.profile
    tz = _tz(profile)
    for log in profile.biometrics.filter(resting_heart_rate__isnull=False).order_by("-timestamp"):
        day = log.timestamp.astimezone(tz).date()
        if today is None or day <= today:
            return log.resting_heart_rate, day
    return None


@dataclass(frozen=True)
class SetRecord:
    """Una serie con los atributos que lee `coach.strength` (los de `ExerciseSet`)."""

    exercise: str
    date: date
    set_type: str
    weight_kg: float | None
    reps: int | None
    rir: float | None
    rpe: float | None


def _float(value) -> float | None:
    return float(value) if value is not None else None


def set_records(user, since: date | None = None, until: date | None = None) -> list[SetRecord]:
    """Series de gimnasio (`SetLog`) de `user`, con la fecha de la sesión en la zona horaria del
    perfil, de la más antigua a la más reciente."""
    from activities.models import SetLog

    profile = user.profile
    tz = _tz(profile)
    logs = (
        SetLog.objects.filter(activity__profile=profile)
        .select_related("activity")
        .order_by("activity__started_at", "activity_id", "exercise_index", "set_index")
    )
    out = []
    for log in logs:
        day = log.activity.started_at.astimezone(tz).date()
        if (since and day < since) or (until and day > until):
            continue
        out.append(SetRecord(log.exercise, day, log.set_type, _float(log.weight_kg), log.reps,
                             _float(log.rir), _float(log.rpe)))
    return out


def _sex(profile) -> str | None:
    return profile.equation_sex or GENDER_TO_SEX.get(profile.gender or "")


def _screening(profile) -> dict:
    screening = Screening.objects.filter(profile=profile).first()
    if screening is None:
        return {}
    values = {key: getattr(screening, key) for key in coach_profile.SCREENING_KEYS}
    return {key: value for key, value in values.items() if value is not None}


def _injuries(profile) -> list[dict]:
    out = []
    for injury in profile.injuries.order_by("created_at", "id"):
        data = {field: getattr(injury, field) for field in INJURY_FIELDS}
        out.append({k: v for k, v in data.items() if v not in (None, [])})
    return out


def to_coach_profile(user, today: date | None = None) -> Profile:
    """El perfil del usuario como lo vería el coach (`data/profile.yaml`).

    Valida con las mismas reglas que `coach.profile.save_profile`. Esa validación es la
    función privada `_validate` (sugerencia U01); `test_bridge_contract.py` avisa si cambia.
    """
    profile = user.profile
    weight = latest_weight(user, today)
    data = {
        "sex": _sex(profile),
        "birth_date": profile.date_of_birth,
        "height_cm": profile.height_cm,
        "weight_kg": weight[0] if weight else None,
        "goal": profile.goal,
        "experience": profile.experience,
        "activity_level": profile.activity_level,
        "language": profile.language,
        "region": profile.region,
        "emergency_number": profile.emergency_number,
        "medications": [*profile.medications, *profile.medications_other],
        "conditions": [*profile.conditions, *profile.conditions_other],
        "screening": _screening(profile),
        "injuries": _injuries(profile),
    }
    data = {k: v for k, v in data.items() if v not in (None, [], {})}
    coach_profile._validate(data)
    return Profile(**data)
