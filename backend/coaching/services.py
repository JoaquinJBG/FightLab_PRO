"""Servicios de la app `coaching`: cribado, lesiones y flags de seguridad (spec §6.3, §8.1)."""
from datetime import date

from coach import profile as coach_profile
from coach import safety
from django.core.exceptions import ValidationError
from django.db import transaction

from .models import Injury, Screening, ScreeningEvent


def screening_get(profile) -> Screening:
    screening, _ = Screening.objects.get_or_create(profile=profile)
    return screening


def _validate_screening_value(key: str, value) -> None:
    """Las comprobaciones de `coach.profile._validate` para una clave del cribado."""
    if key not in coach_profile.SCREENING_KEYS:
        raise ValidationError({key: f"unknown screening key: {key}"})
    if value is None:  # borra la respuesta (`coach profile set screening.KEY none`)
        return
    expected = coach_profile.SCREENING_KEYS[key]
    if not isinstance(value, expected) or (expected is int and isinstance(value, bool)):
        raise ValidationError({key: f"screening.{key} must be {expected.__name__}"})
    if key == "scoff_yes_count" and not 0 <= value <= coach_profile.SCOFF_ITEMS:
        raise ValidationError({key: f"screening.scoff_yes_count must be 0 to {coach_profile.SCOFF_ITEMS}"})
    if key == "menstrual" and value not in coach_profile.MENSTRUAL_STATES:
        states = ", ".join(coach_profile.MENSTRUAL_STATES)
        raise ValidationError({key: f"screening.menstrual must be one of {states}"})
    if key in ("bp_systolic", "bp_diastolic") and value <= 0:
        raise ValidationError({key: f"screening.{key} must be a positive reading in mmHg"})


@transaction.atomic
def screening_set(profile, key: str, value, origin: str, actor=None) -> Screening:
    """Guarda una respuesta del cribado y deja su `ScreeningEvent`.

    Como `coach profile set`: si cambia una respuesta del PAR-Q+, `vigorous_reviewed` se
    borra, porque la revisión cubría las respuestas anteriores.
    """
    _validate_screening_value(key, value)
    if origin not in ScreeningEvent.Origin.values:
        raise ValidationError({"origin": f"unknown origin: {origin}"})
    Screening.objects.get_or_create(profile=profile)
    screening = Screening.objects.select_for_update().get(profile=profile)
    old = getattr(screening, key)
    if old == value:
        return screening
    changes = [(key, old, value)]
    setattr(screening, key, value)
    if key in coach_profile.PARQ_ANSWERS and screening.vigorous_reviewed is not None:
        changes.append(("vigorous_reviewed", screening.vigorous_reviewed, None))
        screening.vigorous_reviewed = None
    screening.save()
    ScreeningEvent.objects.bulk_create(
        ScreeningEvent(profile=profile, actor=actor, key=k, old_value=o, new_value=n, origin=origin)
        for k, o, n in changes
    )
    return screening


@transaction.atomic
def screening_update(profile, values: dict, origin: str, actor=None) -> Screening:
    """Varias respuestas a la vez. Las del PAR-Q+ van primero: si no, cambiarlas después
    borraría la revisión del trabajo vigoroso que llega en la misma petición."""
    ordered = sorted(values.items(), key=lambda kv: kv[0] not in coach_profile.PARQ_ANSWERS)
    for key, value in ordered:
        screening_set(profile, key, value, origin=origin, actor=actor)
    return screening_get(profile)


def safety_for(user, today: date):
    """`coach.safety.flags(to_coach_profile(user))`: la única fuente de los flags (spec §8.1)."""
    from .bridge.adapters import to_coach_profile

    return safety.flags(to_coach_profile(user, today), today)


def injury_add(profile, **fields) -> Injury:
    injury = Injury(profile=profile, **fields)
    injury.full_clean()
    injury.save()
    return injury


def injury_update(injury: Injury, **fields) -> Injury:
    for name, value in fields.items():
        setattr(injury, name, value)
    injury.full_clean()
    injury.save()
    return injury
