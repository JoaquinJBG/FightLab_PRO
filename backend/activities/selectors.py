"""Selectores de actividades y motor de carga (port 1:1 de frontend/lib/load.ts).

Invariantes del port (¡no romper la paridad con el motor local!):
- Solo cuentan las actividades CON rpe (el frontend filtra load > 0).
- Carga por sesión = round(duration_sec/60 × rpe), redondeada ANTES de sumar.
- Bucket por día LOCAL del tz pedido (el frontend usa el día local del navegador).
- history_days = días desde la primera actividad con rpe (toda la historia), +1, cap 28.
- ACWR solo con history_days ≥ 10 y semana > 0; ventana crónica = últimos
  history_days días (incluida la semana aguda); provisional hasta 28 días.
- Monotonía con history_days ≥ 7 y carga en la semana; SD=0 → sin_variacion.
- band: port 1:1 de computeLoadBand (frontend/lib/load.ts) — mismas ventanas
  móviles de 7 días, mismo suelo de anchura (10% de mu) y mismos umbrales.
"""
import math
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db.models import F
from django.utils import timezone

from .models import Activity

LoadBandStatus = str  # "descarga" | "sostenible" | "elevada" | "alta"


# Math.round de JS = floor(x + 0.5) para CUALQUIER real (round() de Python es
# half-even y además redondea negativos hacia cero, no hacia +∞: diverge en
# ambos casos de Math.round).
def _js_round(x: float) -> int:
    return math.floor(x + 0.5)


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


def compute_load_band(daily28: list[int], week_au: int, history_days: int) -> dict | None:
    """Banda de carga tipo Strava: sitúa la carga de la semana en curso dentro
    del rango de las semanas previas del propio atleta. Port 1:1 de
    computeLoadBand (frontend/lib/load.ts): mismas ventanas, mismo suelo de
    anchura y mismos umbrales. None si no hay al menos una semana de baseline
    antes de la semana actual."""
    if history_days < 14:
        return None

    # Ventanas móviles de 7 días que terminan ANTES de la semana en curso
    # (índices 21..27), acotadas al historial real.
    d0 = 28 - history_days  # primer índice con datos reales
    first_end = max(6, d0 + 6)  # primer día-fin con ventana completa dentro del historial
    samples: list[float] = []
    for e in range(first_end, 21):  # e en firstEnd..20 inclusive
        samples.append(sum(daily28[e - 6:e + 1]))
    if not samples:
        return None

    mu = sum(samples) / len(samples)
    if mu <= 0:
        return None  # baseline sin carga: nada que comparar

    variance = sum((v - mu) ** 2 for v in samples) / len(samples)
    sigma = variance ** 0.5
    sigma_eff = max(sigma, 0.1 * mu)  # suelo de anchura (estabilidad visual, no umbral de seguridad)

    low = mu - sigma_eff
    high = mu + sigma_eff
    overreach = mu + 2 * sigma_eff

    status: LoadBandStatus
    if week_au < low:
        status = "descarga"
    elif week_au <= high:
        status = "sostenible"
    elif week_au <= overreach:
        status = "elevada"
    else:
        status = "alta"

    return {
        "week_au": _js_round(week_au),
        "low": max(0, _js_round(low)),
        "high": _js_round(high),
        "overreach": _js_round(overreach),
        "status": status,
        "provisional": history_days < 28,
    }


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
        "band": None,
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

    band = compute_load_band(daily28, week_au, history_days)

    return {
        "week_au": week_au, "daily7": daily7, "acwr": acwr, "provisional": provisional,
        "monotonia": monotonia, "tension": tension, "sin_variacion": sin_variacion,
        "history_days": history_days, "band": band,
    }
