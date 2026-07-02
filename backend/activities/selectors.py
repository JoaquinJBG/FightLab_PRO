"""Selectores de actividades y motor de carga (port 1:1 de frontend/lib/load.ts).

Invariantes del port (¡no romper la paridad con el motor local!):
- Solo cuentan las actividades CON rpe (el frontend filtra load > 0).
- Carga por sesión = round(duration_sec/60 × rpe), redondeada ANTES de sumar.
- Bucket por día LOCAL del tz pedido (el frontend usa el día local del navegador).
- history_days = días desde la primera actividad con rpe (toda la historia), +1, cap 28.
- ACWR solo con history_days ≥ 10 y semana > 0; ventana crónica = últimos
  history_days días (incluida la semana aguda); provisional hasta 28 días.
- Monotonía con history_days ≥ 7 y carga en la semana; SD=0 → sin_variacion.
"""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db.models import F
from django.utils import timezone

from .models import Activity

# Math.round de JS para positivos (half-up); round() de Python es half-even
def _js_round(x: float) -> int:
    return int(x + 0.5)


def activity_list(*, user, kind: str | None = None, limit: int = 50):
    qs = Activity.objects.filter(profile=user.profile)
    if kind:
        qs = qs.filter(kind=kind)
    return qs[:limit]


def _resolve_tz(user, tzname: str | None) -> ZoneInfo:
    for candidate in (tzname, getattr(user.profile, "timezone", None), "UTC"):
        if not candidate:
            continue
        try:
            return ZoneInfo(candidate)
        except Exception:
            continue
    return ZoneInfo("UTC")


def load_metrics(*, user, tzname: str | None = None) -> dict:
    tz = _resolve_tz(user, tzname)
    today_local = timezone.now().astimezone(tz).date()

    # Solo sesiones con carga > 0 (el frontend filtra load > 0): con redondeo
    # half-up, round(sec/60×rpe) ≥ 1 equivale a sec×rpe ≥ 30
    base = (
        Activity.objects.filter(profile=user.profile, rpe__isnull=False)
        .annotate(_load_prod=F("duration_sec") * F("rpe"))
        .filter(_load_prod__gte=30)
    )

    first_started = base.order_by("started_at").values_list("started_at", flat=True).first()
    empty = {
        "week_au": 0, "daily7": [0] * 7, "acwr": None, "provisional": True,
        "monotonia": None, "tension": None, "sin_variacion": False, "history_days": 0,
    }
    if first_started is None:
        return empty

    first_local = first_started.astimezone(tz).date()
    history_days = min(28, max(1, (today_local - first_local).days + 1))

    # Ventana de 28 días desde la MEDIANOCHE LOCAL (una sesión a las 00:30 locales
    # cae en su día local aunque en UTC sea el día anterior)
    window_start = datetime.combine(today_local - timedelta(days=27), time.min, tzinfo=tz)
    daily28 = [0] * 28
    for started, dur, rpe in base.filter(started_at__gte=window_start).values_list(
        "started_at", "duration_sec", "rpe"
    ):
        idx = 27 - (today_local - started.astimezone(tz).date()).days
        if 0 <= idx < 28:
            daily28[idx] += _js_round(dur / 60 * rpe)

    daily7 = daily28[-7:]
    week_au = sum(daily7)

    acwr = None
    provisional = True
    if history_days >= 10 and week_au > 0:
        chronic_window = daily28[-history_days:]
        chronic_avg = sum(chronic_window) / history_days
        if chronic_avg > 0:
            acwr = round(week_au / 7 / chronic_avg, 3)
            provisional = history_days < 28

    monotonia = None
    tension = None
    sin_variacion = False
    if history_days >= 7 and any(v > 0 for v in daily7):
        mean_daily = week_au / 7
        sd = (sum((v - mean_daily) ** 2 for v in daily7) / 7) ** 0.5
        if sd > 0:
            monotonia = round(mean_daily / sd, 2)
            tension = _js_round(week_au * mean_daily / sd)
        else:
            sin_variacion = True  # cero variación = monotonía máxima (riesgo), no "sin datos"

    return {
        "week_au": week_au, "daily7": daily7, "acwr": acwr, "provisional": provisional,
        "monotonia": monotonia, "tension": tension, "sin_variacion": sin_variacion,
        "history_days": history_days,
    }
