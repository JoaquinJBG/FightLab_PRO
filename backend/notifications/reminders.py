"""Quién recibe cada aviso (F11). Lo llama el cron dos veces al día (dos tareas de Vercel Cron; en
Hobby cada una corre una vez al día, en cualquier minuto de su hora UTC); aquí se pasa a la hora
de cada persona (`timezone` del perfil) y se decide.

- `evening` (víspera): "para mañana" si mañana hay tareas `eve` en el menú (o, mientras el menú
  no las traiga, "prepara lo de mañana" si mañana hay menú o entreno en el plan), y movilidad si
  hoy no está marcada.
- `morning`: pesarse si hoy no hay peso, y la revisión de la semana los martes si la semana
  anterior aún no está revisada (como ParteDiario desde la v1.9.2: el lunes se cocina y el peso
  arrastra el fin de semana).

Cada tipo solo sale si la hora local cae en su ventana (`WINDOWS`): con una sola hora UTC, a
quien viva muy lejos no le llega un "para mañana" a las tres de la tarde. Cada aviso se apunta en
`ReminderLog` y no se repite ese día aunque el cron llegue dos veces.
"""
from datetime import datetime, timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from coaching import checkin, today as days
from coaching.bridge.adapters import _tz
from coaching.models import WeeklyReview
from profiles.models import UserProfile

from . import push
from .models import PushSubscription, ReminderLog, ReminderPrefs

SLOTS = ("evening", "morning")
KINDS = {"evening": ("eve", "mobility"), "morning": ("weigh", "review")}
# convention (FightLab): horas locales en que tiene sentido cada tanda, [desde, hasta).
WINDOWS = {"evening": (18, 24), "morning": (5, 12)}
REVIEW_WEEKDAY = 1  # martes
URLS = {"eve": "/today", "mobility": "/today", "weigh": "/today#weight", "review": "/training/review"}
MAX_EVE_ITEMS = 3

TEXTS = {
    "es": {
        "eve_title": "Para mañana",
        "eve_tasks": "Deja hecho: {tasks}",
        "eve_generic_title": "Prepara lo de mañana",
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
    tasks = [str(m["eve"]).strip() for m in (menu or {}).get("meals") or [] if m.get("eve")]
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


def _claim(profile, kind: str, day) -> ReminderLog | None:
    try:
        with transaction.atomic():
            return ReminderLog.objects.create(profile=profile, kind=kind, local_date=day)
    except IntegrityError:
        return None  # ya se envió hoy


def run(slot: str, now: datetime | None = None) -> dict:
    """Envía los avisos de `slot` a quien toque. Devuelve los recuentos (sin datos personales)."""
    if slot not in SLOTS:
        raise ValueError(slot)
    now = now or timezone.now()
    counts = {"profiles": 0, "sent": 0, "skipped": 0, "out_of_window": 0, "already_sent": 0, "failed": 0}
    if not push.configured():
        return {"enabled": False, **counts}
    start, end = WINDOWS[slot]
    profile_ids = PushSubscription.objects.values_list("profile_id", flat=True).distinct()
    for profile in UserProfile.objects.filter(pk__in=list(profile_ids)).select_related("user"):
        counts["profiles"] += 1
        local = timezone.localtime(now, _tz(profile))
        if not start <= local.hour < end:
            counts["out_of_window"] += 1
            continue
        prefs = prefs_for(profile)
        for kind in KINDS[slot]:
            if not getattr(prefs, kind):
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
                log.delete()  # no llegó a ningún navegador: otra llamada de hoy puede reintentarlo
                counts["failed"] += 1
    return {"enabled": True, **counts}
