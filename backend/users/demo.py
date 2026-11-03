"""Usuario de demostración para un entorno de prueba (`manage.py seed_demo`). NUNCA en producción.

Solo actúa con `DEMO_USER_EMAIL` y `DEMO_USER_PASSWORD` en el entorno. Crea (o actualiza) esa
cuenta, activa y verificada, y le pone datos inventados para que la app no esté vacía: perfil,
cribado limpio, 4 semanas de check-ins con pesajes, sesiones de MMA, deportes y gimnasio (con
series), un plan semanal aplicado, una revisión y un menú de la semana (con el proveedor simulado).

- Idempotente: cada bloque de datos solo se crea si la cuenta aún no lo tiene.
- Una cuenta con ese email que no creó este comando (sin `DemoAccount`) no se toca nunca.
- La contraseña no sale nunca en la salida ni en el log.
- Entra aunque `BETA_ALLOWED_EMAILS` no la incluya: esa lista solo se mira al registrarse.
"""
import logging
import os
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from .models import DemoAccount

logger = logging.getLogger(__name__)

EMAIL_ENV = "DEMO_USER_EMAIL"
PASSWORD_ENV = "DEMO_USER_PASSWORD"

PROFILE = {
    "date_of_birth": date(1994, 3, 12),
    "gender": "MALE",
    "height_cm": 178,
    "dominant_stance": "ORTHODOX",
    "timezone": "Europe/Madrid",
    "goal": "fat_loss",
    "experience": "intermediate",
    "activity_level": "desk_training",
    "language": "es",
    "region": "es",
    "disciplines": ["MMA"],
    "training_frequency": 5,
}
# Cribado sin nada que señalar (SCOFF 0, PAR-Q+ todo "no", sin síntomas cardíacos)
SCREENING = {
    "scoff_yes_count": 0, "scoff_positive": False, "parq_any_yes": False,
    "parq_followup_yes": False, "cardiac_symptoms": False,
}
CHECKIN_DAYS = 28
START_WEIGHT_KG = 82.0
WEEKLY_LOSS_KG = 0.5  # unos -0,6 % a la semana: dentro del rango de pérdida de la revisión


@dataclass
class SeedResult:
    status: str  # "skipped" | "refused" | "created" | "updated"
    message: str
    sections: dict[str, str] = field(default_factory=dict)


def seed_demo(today: date | None = None, env=os.environ) -> SeedResult:
    email = (env.get(EMAIL_ENV) or "").strip().lower()
    password = env.get(PASSWORD_ENV) or ""
    if not email or not password:
        return SeedResult("skipped", f"sin {EMAIL_ENV} y {PASSWORD_ENV}: no se crea ningún usuario de demostración")

    User = get_user_model()
    user = User.objects.filter(email__iexact=email).first()
    if user is not None and not DemoAccount.objects.filter(user=user).exists():
        return SeedResult("refused", f"ya existe una cuenta {email} que no es de demostración: no se toca")

    with transaction.atomic():
        created = user is None
        if created:
            user = User.objects.create_user(email=email, password=password)
            DemoAccount.objects.create(user=user)
        else:
            user.set_password(password)  # la de la variable manda (se puede cambiar en el panel)
        user.is_active = True
        user.is_email_verified = True
        user.save()

    from profiles.models import UserProfile

    # La misma instancia que `user.profile` (la crea la señal de alta): los servicios la usan
    try:
        profile = user.profile
    except UserProfile.DoesNotExist:
        profile = UserProfile.objects.create(user=user)
    for name, value in PROFILE.items():
        setattr(profile, name, value)
    profile.save()

    today = today or timezone.localdate()
    sections = {}
    for name, step in (
        ("cribado", _screening), ("check-ins", _checkins), ("actividades", _activities),
        ("plan", _plan), ("revisión", _review), ("menú", _menu),
    ):
        try:
            with transaction.atomic():
                sections[name] = step(user, today)
        except Exception as exc:  # un bloque que falla no impide los demás ni el arranque
            logger.exception("seed_demo: no se pudo crear '%s'", name)
            sections[name] = f"error ({type(exc).__name__})"
    return SeedResult("created" if created else "updated", f"usuario de demostración {email}", sections)


def _screening(user, today: date) -> str:
    from coaching.services import screening_get, screening_update

    if screening_get(user.profile).scoff_yes_count is not None:
        return "ya estaba"
    screening_update(user.profile, SCREENING, origin="onboarding")
    return "creado"


def _checkins(user, today: date) -> str:
    from coaching.checkin import checkin_upsert

    if user.profile.checkins.exists():
        return "ya estaban"
    for i in range(CHECKIN_DAYS):
        day = today - timedelta(days=CHECKIN_DAYS - 1 - i)
        weight = START_WEIGHT_KG - WEEKLY_LOSS_KG * i / 7 + (0.3 if i % 3 == 0 else 0)  # con su ruido diario
        checkin_upsert(user, day, {
            "weight_kg": round(weight, 1),
            "sleep_hours": 7 + (i % 3) * 0.5,
            "sleep_quality": 4 if i % 4 else 3,
            "energy": 4 if i % 5 else 3,
            "soreness": 2 if i % 2 else 3,
            "stress": 2,
            "mood": 4,
            "intake_kcal": 2250 + (i % 4) * 50,
            "resting_heart_rate": 54 + i % 3,
            "hrv_ms": 70 + i % 6,
        }, today)
    return f"{CHECKIN_DAYS} días"


# (días atrás, tipo, título, minutos, RPE, series de gimnasio [(ejercicio, kg, reps, series)])
SESSIONS = [
    (27, "GYM", "Pierna", 60, 7, [("Sentadilla", 90, 6, 4), ("Peso muerto rumano", 70, 8, 3)]),  # 28 días de historial: ya hay ratio
    (25, "MMA", "Técnica de striking", 75, 6, None),
    (23, "SPORT", "Carrera suave", 40, 5, None),
    (22, "MMA", "Sparring ligero", 60, 8, None),
    (19, "GYM", "Torso", 60, 7, [("Press banca", 70, 8, 4), ("Remo con barra", 65, 8, 3)]),
    (18, "MMA", "Grappling", 75, 7, None),
    (16, "SPORT", "Bici", 50, 5, None),
    (15, "MMA", "Técnica de striking", 75, 6, None),
    (12, "GYM", "Pierna", 60, 8, [("Sentadilla", 92.5, 6, 4), ("Peso muerto rumano", 72.5, 8, 3)]),
    (11, "MMA", "Sparring ligero", 60, 8, None),
    (9, "SPORT", "Carrera suave", 45, 5, None),
    (8, "MMA", "Grappling", 75, 7, None),
    (5, "GYM", "Torso", 60, 7, [("Press banca", 72.5, 8, 4), ("Remo con barra", 67.5, 8, 3)]),
    (4, "MMA", "Técnica de striking", 75, 6, None),
    (2, "SPORT", "Bici", 50, 5, None),
    (1, "MMA", "Sparring ligero", 60, 8, None),
]


def _activities(user, today: date) -> str:
    from activities.models import Activity
    from activities.sets import set_logs_for_new_activity

    profile = user.profile
    if profile.activities.exists():
        return "ya estaban"
    tz = timezone.get_current_timezone()
    for n, (days_ago, kind, title, minutes, rpe, lifts) in enumerate(SESSIONS):
        started = timezone.make_aware(datetime.combine(today - timedelta(days=days_ago), time(19, 0)), tz)
        sets, exercises = [], []
        for ei, (name, kg, reps, count) in enumerate(lifts or []):
            exercises.append({"name": name, "sets": [{"kg": kg, "reps": reps}] * count})
            sets += [{"exercise": name, "exercise_index": ei, "set_index": si, "weight_kg": kg, "reps": reps}
                     for si in range(count)]
        detail = {"focus": title, "volume_kg": sum(s["weight_kg"] * s["reps"] for s in sets), "exercises": exercises} if lifts else None
        activity = Activity.objects.create(
            profile=profile, source=Activity.Source.MANUAL, external_id=f"demo-{n}", kind=kind, title=title,
            started_at=started, duration_sec=minutes * 60, rpe=rpe, detail=detail,
        )
        if sets:
            set_logs_for_new_activity(activity, sets)
    return f"{len(SESSIONS)} sesiones"


def _plan(user, today: date) -> str:
    from coaching import plan
    from coaching.models import WeeklyPlan

    if WeeklyPlan.objects.filter(profile=user.profile, status=WeeklyPlan.Status.ACTIVE).exists():
        return "ya estaba"
    draft = plan.generate(user, today, plan.PlanRequest(), lang="es")
    plan.apply(user, draft, today)
    return "aplicado"


def _review(user, today: date) -> str:
    from coaching import review
    from coaching.models import WeeklyReview

    if WeeklyReview.objects.filter(profile=user.profile).exists():
        return "ya estaba"
    review.generate(user, today, review.default_week_end(today), set(), lang="es")
    return "creada"


def _menu(user, today: date) -> str:
    from coaching import menus
    from coaching.menu_llm import FakeMenuProposer
    from coaching.models import MealPlan

    if MealPlan.objects.filter(profile=user.profile).exists():
        return "ya estaba"
    # Siempre el proveedor simulado: el seed nunca llama a un LLM
    menus.generate(user, today, menus.MenuRequest(start_date=today, days=menus.MAX_DAYS), "es", FakeMenuProposer())
    return f"{menus.MAX_DAYS} días"
