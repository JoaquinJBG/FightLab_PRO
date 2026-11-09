"""Quién recibe cada aviso y cuándo (F11).

Cada aviso tiene su hora local, como en ParteDiario: pesarse a las 8, la revisión de la semana los
martes a las 10, la movilidad a las 18 y la víspera a las 22 (`TARGET_HOURS`). Vercel Cron llama
al backend ("tick") solo en las horas UTC de `TICK_HOURS_UTC`, que son las que caen en esas horas
en Europe/Madrid con y sin horario de verano: cada tick despierta el backend de Render free, y sus
horas gratis se comparten con el servicio de prueba. En el plan Hobby cada tick sale en cualquier
minuto de su hora, así que en España cada aviso llega dentro de su hora (de 22:00 a 22:59...).

A cada persona, cada aviso le sale en el tick más cercano a su hora local de entre los que caen
ese día en su zona (`tick_for`; si hay empate, el más tarde). En España es su hora exacta; en otra
zona llega antes o después, pero no se pierde. Cada aviso se apunta en `ReminderLog` y no se repite
ese día aunque el cron llegue dos veces.

- `eve` (víspera): "para mañana" si mañana hay tareas `eve` en el menú (o, mientras el menú no las
  traiga, "prepara lo de mañana" si mañana hay menú o entreno en el plan).
- `mobility`: si hoy no está marcada.
- `weigh`: si hoy no hay peso (y nunca con `no_weight_targets`).
- `review`: los martes, si la semana anterior aún no está revisada (como ParteDiario desde la
  v1.9.2: el lunes se cocina y el peso aún arrastra el fin de semana).
"""
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction
from django.utils import timezone

from coaching import checkin, today as days
from coaching.bridge.adapters import _tz
from coaching.models import WeeklyReview
from profiles.models import UserProfile

from . import push
from .models import PushSubscription, ReminderLog, ReminderPrefs

# convention (FightLab, las horas de ParteDiario): hora local de cada aviso.
TARGET_HOURS = {"weigh": 8, "review": 10, "mobility": 18, "eve": 22}
KINDS = tuple(TARGET_HOURS)
# Las horas UTC de los ticks: tienen que ser las mismas que las tareas de `frontend/vercel.json`
# (lo comprueba un test). Cubren las horas de arriba en Europe/Madrid en invierno (UTC+1) y en
# verano (UTC+2).
TICK_HOURS_UTC = (6, 7, 8, 9, 16, 17, 20, 21)
REVIEW_WEEKDAY = 1  # martes
URLS = {"eve": "/today", "mobility": "/today", "weigh": "/today#weight", "review": "/training/review"}
MAX_EVE_ITEMS = 3

TEXTS = {
    "es": {
        "eve_title": "Para mañana",
        "eve_tasks": "Deja hecho: {tasks}",
        "eve_generic_title": "Prepara lo de mañana",
        "defrost": "pasa {dish} del congelador a la nevera",
        "eve_generic": "Mañana: {summary}. Mira en Hoy si hay que dejar algo listo.",
        "mobility_title": "Movilidad",
        "mobility": "Si aún no la has hecho hoy, es buen momento. Márcala luego en Hoy.",
        "weigh_title": "Pésate",
        "weigh": "En ayunas, después de ir al baño y antes de comer o beber nada. Apúntalo en Hoy.",
        "review_title": "Revisión de la semana",
        "review": "La semana pasada ya está cerrada: abre la revisión semanal.",
        "test_title": "Avisos de FightLab",
        "test": "Los avisos funcionan en este dispositivo.",
        "menu": "menú",
        "gym": "gimnasio (sesión {session})",
        "cardio": "cardio ({minutes} min)",
        "mma": "MMA",
    },
    "en": {
        "eve_title": "For tomorrow",
        "eve_tasks": "Get ready: {tasks}",
        "eve_generic_title": "Get tomorrow ready",
        "defrost": "move {dish} from the freezer to the fridge",
        "eve_generic": "Tomorrow: {summary}. Check Today in case something needs doing tonight.",
        "mobility_title": "Mobility",
        "mobility": "If you haven't done it yet today, now's a good time. Tick it in Today afterwards.",
        "weigh_title": "Weigh yourself",
        "weigh": "Fasted, after the bathroom and before eating or drinking. Log it in Today.",
        "review_title": "Weekly review",
        "review": "Last week is closed: open the weekly review.",
        "test_title": "FightLab reminders",
        "test": "Reminders work on this device.",
        "menu": "menu",
        "gym": "gym (session {session})",
        "cardio": "cardio ({minutes} min)",
        "mma": "MMA",
    },
}


def texts(profile) -> dict:
    return TEXTS.get(getattr(profile, "language", "es"), TEXTS["es"])


def payload(kind: str, title: str, body: str) -> dict:
    return {"title": title, "body": body, "url": URLS.get(kind, "/today"), "tag": f"fightlab-{kind}"}


def test_payload(profile) -> dict:
    t = texts(profile)
    return {"title": t["test_title"], "body": t["test"], "url": "/profile/reminders", "tag": "fightlab-test"}


def prefs_for(profile) -> ReminderPrefs:
    return ReminderPrefs.objects.get_or_create(profile=profile)[0]


# ---------------------------------------------------------------- cada aviso


def _eve(user, local: datetime) -> dict | None:
    t = texts(user.profile)
    tomorrow = local.date() + timedelta(days=1)
    _, menu = days.menu_day(user, tomorrow)
    # Fase 12: las tareas `eve` del menú (una lista por comida), las de la sesión de batch de mañana
    # y pasar a la nevera lo congelado que se come mañana (`coaching.batch.eve_tasks`).
    tasks = [x.get("text") or t["defrost"].format(dish=x.get("dish") or "") for x in days.tonight(user, local.date())["tasks"]]
    tasks = [x for x in tasks if x]
    if tasks:
        shown = "; ".join(tasks[:MAX_EVE_ITEMS]) + ("…" if len(tasks) > MAX_EVE_ITEMS else "")
        return payload("eve", t["eve_title"], t["eve_tasks"].format(tasks=shown))
    parts = []
    plan = days.plan_for(user, tomorrow)
    for entry in (plan or {}).get("entries") or []:
        if entry["kind"] == "gym":
            parts.append(t["gym"].format(session=entry.get("session") or "?"))
        elif entry["kind"] == "cardio":
            parts.append(t["cardio"].format(minutes=entry.get("minutes") or 0))
        elif entry["kind"] == "mma":
            parts.append(t["mma"])
    if menu:
        parts.append(t["menu"])
    if not parts:
        return None  # mañana no hay nada que preparar
    return payload("eve", t["eve_generic_title"], t["eve_generic"].format(summary=", ".join(parts)))


def _mobility(user, local: datetime) -> dict | None:
    row = user.profile.day_logs.filter(date=local.date()).first()
    if row is not None and row.mobility:
        return None
    t = texts(user.profile)
    return payload("mobility", t["mobility_title"], t["mobility"])


def _weigh(user, local: datetime) -> dict | None:
    day = local.date()
    if checkin.weight_tracking_blocked(user, day):
        return None
    data = checkin.checkin_data(user, day, day)
    if data and data["weight_kg"] is not None:
        return None
    t = texts(user.profile)
    return payload("weigh", t["weigh_title"], t["weigh"])


def _review(user, local: datetime) -> dict | None:
    day = local.date()
    if day.weekday() != REVIEW_WEEKDAY:
        return None
    last_sunday = day - timedelta(days=day.weekday() + 1)
    if WeeklyReview.objects.filter(profile=user.profile, week_end=last_sunday).exists():
        return None
    t = texts(user.profile)
    return payload("review", t["review_title"], t["review"])


BUILDERS = {"eve": _eve, "mobility": _mobility, "weigh": _weigh, "review": _review}


# ---------------------------------------------------------------- la tanda


def tick_for(day: date, hour: int, tz: ZoneInfo) -> datetime | None:
    """El tick (una hora UTC en punto de `TICK_HOURS_UTC`) más cercano a las `hour` locales de
    `day`, de entre los que caen ese día en la zona `tz`. Si hay empate, el más tarde."""
    due = datetime.combine(day, time(hour), tzinfo=tz)
    candidates = [
        instant
        for d in (day - timedelta(days=1), day, day + timedelta(days=1))
        for h in TICK_HOURS_UTC
        if (instant := datetime.combine(d, time(h), tzinfo=UTC)).astimezone(tz).date() == day
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda i: (abs(i - due), -i.timestamp()))


def current_tick(now: datetime) -> datetime:
    """El tick al que pertenece `now`: Vercel Hobby lo lanza en cualquier minuto de su hora."""
    return now.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


def _claim(profile, kind: str, day) -> ReminderLog | None:
    try:
        with transaction.atomic():
            return ReminderLog.objects.create(profile=profile, kind=kind, local_date=day)
    except IntegrityError:
        return None  # ya se envió hoy


def run(now: datetime | None = None) -> dict:
    """Envía los avisos a los que les toca en este tick. Devuelve los recuentos (sin datos
    personales)."""
    now = now or timezone.now()
    tick = current_tick(now)
    counts = {"profiles": 0, "sent": 0, "skipped": 0, "not_due": 0, "already_sent": 0, "failed": 0}
    if not push.configured():
        return {"enabled": False, "tick": tick.isoformat(), **counts}
    profile_ids = PushSubscription.objects.values_list("profile_id", flat=True).distinct()
    for profile in UserProfile.objects.filter(pk__in=list(profile_ids)).select_related("user"):
        counts["profiles"] += 1
        tz = _tz(profile)
        local = timezone.localtime(now, tz)
        prefs = prefs_for(profile)
        for kind in KINDS:
            if not getattr(prefs, kind):
                continue
            if tick_for(local.date(), TARGET_HOURS[kind], tz) != tick:
                counts["not_due"] += 1
                continue
            message = BUILDERS[kind](profile.user, local)
            if message is None:
                counts["skipped"] += 1
                continue
            log = _claim(profile, kind, local.date())
            if log is None:
                counts["already_sent"] += 1
                continue
            result = push.send_to_profile(profile, message)
            if result["ok"]:
                counts["sent"] += 1
            else:
                log.delete()  # no llegó a ningún navegador: otro tick de hoy puede reintentarlo
                counts["failed"] += 1
    return {"enabled": True, "tick": tick.isoformat(), **counts}
