"""Preguntas semanales del check-in (Task 5.3, `checkin/SKILL.md` paso 4).

Solo se hacen si ningún check-in de los 7 últimos días naturales (hoy incluido) las registra. Antes
eran una nota de texto; ahora son campos de `DailyCheckin` y su efecto va a `Screening` (con su
`ScreeningEvent` de origen `checkin`), que es de donde los lee el motor:

- Ciclo (mujeres no embarazadas; `nutrition.md: "Menstrual dysfunction: stop and refer"`): cambios
  nuevos en un ciclo regular → `irregular_new`; sin regla 3 meses o más → `absent`. Una respuesta
  «normal» solo rellena el cribado si estaba en blanco: no borra un aviso anterior, eso lo decide
  un clínico. Se pregunta una vez por el anticonceptivo hormonal, que enmascara el ciclo.
- Tensión (con hipertensión; `recovery-habits.md: "Resting BP thresholds to defer or refer"`):
  la última lectura sentada tras 5 minutos de reposo.
"""
from datetime import date, timedelta

from coach import profile as coach_profile
from django.core.exceptions import ValidationError

from .bridge.adapters import GENDER_TO_SEX
from .models import DailyCheckin, Screening
from .services import screening_get, screening_set

WINDOW_DAYS = 7  # `checkin/SKILL.md`: «the 7 calendar days up to today»


def _female_and_not_pregnant(user) -> bool:
    profile = user.profile
    sex = profile.equation_sex or GENDER_TO_SEX.get(profile.gender or "")
    return sex == "female" and coach_profile.PREGNANT not in profile.conditions


def _recorded(user, today: date, *fields: str) -> bool:
    """¿Algún check-in de los últimos 7 días trae alguno de estos campos?"""
    since = today - timedelta(days=WINDOW_DAYS - 1)
    rows = user.profile.checkins.filter(date__gte=since, date__lte=today)
    return any(getattr(row, field) is not None for row in rows for field in fields)


def questions(user, today: date) -> list[dict]:
    """Las preguntas semanales que toca hacer hoy."""
    out = []
    if _female_and_not_pregnant(user) and not _recorded(user, today, "period_status"):
        asked_before = user.profile.checkins.filter(hormonal_contraception__isnull=False).exists()
        out.append({"code": "menstrual", "ask_contraception": not asked_before})
    if coach_profile.HYPERTENSION in user.profile.conditions and not _recorded(
        user, today, "bp_systolic", "bp_diastolic"
    ):
        out.append({"code": "bp"})
    return out


def validate(user, clean: dict) -> None:
    """El ciclo no se registra para quien la pregunta no aplica (un `absent` pararía el déficit)."""
    if "period_status" in clean and not _female_and_not_pregnant(user):
        raise ValidationError({"period_status": "the cycle question does not apply to this profile"})


def apply(user, clean: dict, day: date) -> None:
    """Escribe en el cribado lo que traen las preguntas semanales."""
    profile = user.profile
    status = clean.get("period_status")
    if status in (Screening.Menstrual.IRREGULAR_NEW, Screening.Menstrual.ABSENT):
        screening_set(profile, "menstrual", status, origin="checkin", actor=user)
    elif status == Screening.Menstrual.NORMAL and screening_get(profile).menstrual is None:
        screening_set(profile, "menstrual", status, origin="checkin", actor=user)
    for key in ("bp_systolic", "bp_diastolic"):
        if key in clean:
            screening_set(profile, key, clean[key], origin="checkin", actor=user)
