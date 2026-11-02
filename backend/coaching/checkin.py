"""Check-in diario (spec §6.4, Task 5.1), con la semántica de `coach.checkins`: una fila por día;
un segundo check-in el mismo día rellena o pisa solo los campos que trae y suma sus notas.

El peso y la cintura (y, si el usuario los tiene, la FC en reposo y la VFC) van a
`BiometricsLog`, que es de donde lee el motor los pesajes. Con `no_weight_targets` el servidor no
acepta peso, cintura ni kcal (spec §8.3; el motor refusa el peso y, tras un cribado de TCA
positivo o con menos de 18 años, la cintura y las kcal) y no los devuelve.
"""
from datetime import date, datetime, time
from decimal import Decimal

from coach import checkins as coach_checkins
from coach.profile import ProfileIncomplete
from coach.safety import flags as coach_flags
from django.core.exceptions import ValidationError
from django.db import transaction

from profiles.models import BiometricsLog

from . import weekly
from .bridge.adapters import _tz, to_coach_profile
from .models import DailyCheckin, Screening

# Límites de plausibilidad del motor (`coach.checkins.RANGES`) y los propios de FightLab.
RANGES = coach_checkins.RANGES
SCORE_RANGE = (1, 5)
# convention (FightLab): control de entrada de la FC en reposo y la VFC, no una recomendación.
RESTING_HR_RANGE = (20, 250)
HRV_RANGE = (1, 400)
BP_RANGE = (30, 300)
# convention (FightLab): zonas de agujetas del check-in de bienestar del plan v1 §8.
SORENESS_ZONES = ("legs", "glutes", "back", "chest", "shoulders", "arms", "core", "neck")
PERIOD_STATUSES = (
    Screening.Menstrual.NORMAL,
    Screening.Menstrual.IRREGULAR_NEW,
    Screening.Menstrual.ABSENT,
)
SCORES = ("sleep_quality", "energy", "soreness", "stress", "mood")
BODY_FIELDS = ("weight_kg", "waist_cm", "intake_kcal")  # los que `no_weight_targets` cierra
LOG_FIELDS = ("weight_kg", "waist_cm", "resting_heart_rate", "hrv_ms")
CHECKIN_FIELDS = (
    "intake_kcal", "sleep_hours", *SCORES, "soreness_zones", "illness", "notes",
    "period_status", "hormonal_contraception", "bp_systolic", "bp_diastolic",
)
ALLOWED = (*LOG_FIELDS, *CHECKIN_FIELDS)
DECIMALS = {"weight_kg": 2, "waist_cm": 1}
LOG_HOUR = 8  # el peso del check-in es el de la mañana


class CheckinRefused(Exception):
    """El servidor no guarda estos campos (`no_weight_targets`). Nada se escribe."""

    def __init__(self, fields: list[str], code: str = "weight_targets_blocked"):
        super().__init__(f"{code}: {', '.join(fields)}")
        self.code = code
        self.fields = fields


def weight_tracking_blocked(user, today: date) -> bool:
    """`no_weight_targets` del motor. Ante un perfil que el motor no puede evaluar se cierra (es
    lo seguro)."""
    try:
        profile = to_coach_profile(user, today)
        return coach_flags(profile, today).no_weight_targets
    except (ProfileIncomplete, ValueError):
        return True


def _number(name: str, value, errors: dict, *, integer=False, low=None, high=None):
    if isinstance(value, bool):
        errors[name] = "must be a number"
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        errors[name] = "must be a number"
        return None
    if integer and number != int(number):
        errors[name] = "must be a whole number"
        return None
    if (low is not None and number < low) or (high is not None and number > high):
        errors[name] = f"{number:g} is outside {low:g}-{high:g}"
        return None
    return int(number) if integer else number


def clean_values(day: date, today: date, values: dict, user=None) -> dict:
    """Valida lo que trae el check-in y descarta lo nulo (en el motor, nulo = no dado)."""
    errors: dict[str, str] = {}
    if day > today:
        errors["date"] = "a check-in cannot be dated in the future"
    unknown = sorted(set(values) - set(ALLOWED))
    for name in unknown:
        errors[name] = f"unknown check-in field: {name}"
    clean: dict = {}
    for name, value in values.items():
        if name in unknown or value is None or value == "":
            continue
        if name in RANGES:
            low, high = RANGES[name]
            clean[name] = _number(name, value, errors, integer=name == "intake_kcal", low=low, high=high)
        elif name in SCORES:
            clean[name] = _number(name, value, errors, integer=True, low=SCORE_RANGE[0], high=SCORE_RANGE[1])
        elif name == "resting_heart_rate":
            clean[name] = _number(name, value, errors, integer=True, low=RESTING_HR_RANGE[0], high=RESTING_HR_RANGE[1])
        elif name == "hrv_ms":
            clean[name] = _number(name, value, errors, integer=True, low=HRV_RANGE[0], high=HRV_RANGE[1])
        elif name in ("bp_systolic", "bp_diastolic"):
            clean[name] = _number(name, value, errors, integer=True, low=BP_RANGE[0], high=BP_RANGE[1])
        elif name == "soreness_zones":
            zones = value if isinstance(value, list) else None
            if zones is None or any(z not in SORENESS_ZONES for z in zones):
                errors[name] = f"must be a list of: {', '.join(SORENESS_ZONES)}"
            else:
                clean[name] = list(dict.fromkeys(zones))
        elif name == "illness":
            if value not in DailyCheckin.Illness.values:
                errors[name] = f"must be one of: {', '.join(DailyCheckin.Illness.values)}"
            else:
                clean[name] = value
        elif name == "period_status":
            if value not in PERIOD_STATUSES:
                errors[name] = f"must be one of: {', '.join(PERIOD_STATUSES)}"
            else:
                clean[name] = value
        elif name == "hormonal_contraception":
            if not isinstance(value, bool):
                errors[name] = "must be true or false"
            else:
                clean[name] = value
        elif name == "notes":
            text = str(value).strip()
            if text:
                clean[name] = text
    if errors:
        raise ValidationError(errors)
    clean = {k: v for k, v in clean.items() if v is not None}
    if user is not None:
        weekly.validate(user, clean)
    return clean


def _log_moment(profile, day: date) -> datetime:
    return datetime.combine(day, time(LOG_HOUR), tzinfo=_tz(profile))


def _log_external_id(day: date) -> str:
    return f"checkin:{day.isoformat()}"


def _log_for(profile, day: date) -> BiometricsLog | None:
    return profile.biometrics.filter(
        source=BiometricsLog.Source.MANUAL, external_id=_log_external_id(day)
    ).first()


@transaction.atomic
def checkin_upsert(user, day: date, values: dict, today: date) -> DailyCheckin:
    """Rellena o pisa campo a campo el check-in de `day` y añade las notas (`append_checkin`).

    Lanza `ValidationError` (campos fuera de rango o desconocidos) o `CheckinRefused` (peso,
    cintura o kcal con `no_weight_targets`). En ambos casos no se escribe nada.
    """
    clean = clean_values(day, today, values, user)
    refused = [name for name in BODY_FIELDS if name in clean]
    if refused and weight_tracking_blocked(user, today):
        raise CheckinRefused(refused)

    profile = user.profile
    row, _ = DailyCheckin.objects.select_for_update().get_or_create(profile=profile, date=day)
    for name in CHECKIN_FIELDS:
        if name not in clean:
            continue
        if name == "notes" and row.notes:  # las notas se suman: un síntoma anotado antes se queda
            row.notes = f"{row.notes}; {clean[name]}"
        else:
            setattr(row, name, clean[name])
    row.full_clean()
    row.save()
    weekly.apply(user, clean, day)

    body = {name: clean[name] for name in LOG_FIELDS if name in clean}
    if body:
        log = _log_for(profile, day) or BiometricsLog(
            profile=profile,
            source=BiometricsLog.Source.MANUAL,
            external_id=_log_external_id(day),
            timestamp=_log_moment(profile, day),
        )
        for name, value in body.items():
            if name in DECIMALS:  # `BiometricsLog` guarda decimales: 5.2 y 5.1 cifras
                value = Decimal(str(round(value, DECIMALS[name])))
            setattr(log, name, value)
        log.full_clean()
        log.save()
    return row


def checkin_data(user, day: date, today: date) -> dict | None:
    """El check-in de `day` como lo ve la API, o None si no hay. Con `no_weight_targets` no
    devuelve peso, cintura ni kcal, aunque se guardaran antes de que el flag se activara."""
    row = user.profile.checkins.filter(date=day).first()
    if row is None:
        return None
    blocked = weight_tracking_blocked(user, today)
    log = _log_for(user.profile, day)

    def number(value):
        return float(value) if value is not None else None

    return {
        "date": day.isoformat(),
        "weight_kg": None if blocked or log is None else number(log.weight_kg),
        "waist_cm": None if blocked or log is None else number(log.waist_cm),
        "intake_kcal": None if blocked else row.intake_kcal,
        "resting_heart_rate": log.resting_heart_rate if log else None,
        "hrv_ms": log.hrv_ms if log else None,
        "sleep_hours": row.sleep_hours,
        **{name: getattr(row, name) for name in SCORES},
        "soreness_zones": row.soreness_zones,
        "illness": row.illness or None,
        "notes": row.notes,
        "period_status": row.period_status,
        "hormonal_contraception": row.hormonal_contraception,
        "bp_systolic": row.bp_systolic,
        "bp_diastolic": row.bp_diastolic,
    }


def checkin_mark(user, day: date, *, illness: str | None, red_flags: list[str]) -> DailyCheckin:
    """Anota en el check-in de `day` las señales de alarma marcadas (códigos, no texto)."""
    row, _ = DailyCheckin.objects.select_for_update().get_or_create(profile=user.profile, date=day)
    if illness:
        row.illness = illness
    row.red_flags = list(dict.fromkeys([*row.red_flags, *red_flags]))
    row.save()
    return row
