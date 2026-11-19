"""Readiness a partir del check-in de bienestar (Task 5.5; plan v1 §8).

Dos reglas de `recovery-habits.md`:

- "Simple readiness monitoring": 5 puntuaciones de 1 a 5 (sueño, energía, agujetas, estrés, ánimo),
  cada persona contra su propia línea base. Una bajada en 2 o más puntos durante 3 o más días
  significa mantener o reducir la carga. La regla avisa de que esos umbrales son pragmáticos, no
  validados: aquí se aplican tal cual y se muestran como tales.
- "HRV is optional": no se exige. Con VFC registrada, solo cuenta su propia tendencia de 7 días,
  junto a un bienestar subjetivo malo, para mantener la sesión suave. Nunca decide sola.
"""
from datetime import date, timedelta
from statistics import fmean

from .bridge.adapters import _tz
from .checkin import SCORES
from .keys import rule_key
from .models import KnowledgeRule

READINESS_RULE = rule_key("recovery-habits.md", "Simple readiness monitoring")
HRV_RULE = rule_key("recovery-habits.md", "HRV is optional")

# recovery-habits.md: "Simple readiness monitoring": «a drop on 2 or more items for 3 or more days».
DROP_ITEMS = 2
WINDOW_DAYS = 3
# convention (FightLab): línea base de 14 días anteriores a la ventana, con al menos 3 valores por
# ítem, y una "bajada" de 1 punto o más sobre ella (la regla no fija cuánto es una bajada).
BASELINE_DAYS = 14
MIN_BASELINE_VALUES = 3
DROP_POINTS = 1
# recovery-habits.md: "HRV is optional": «only their own 7-day rolling trend». La comparación es con
# los 21 días anteriores; la caída del 10 % es la que ya usa el "Estado de hoy" (convention).
HRV_RECENT_DAYS = 7
HRV_BASELINE_DAYS = 21
HRV_MIN_VALUES = 4
HRV_DROP_PCT = 10


def _scores(row) -> dict[str, int]:
    return {name: getattr(row, name) for name in SCORES if getattr(row, name) is not None}


def _baselines(rows, window_start: date) -> dict[str, float]:
    since = window_start - timedelta(days=BASELINE_DAYS)
    out = {}
    for name in SCORES:
        values = [
            getattr(r, name) for r in rows if since <= r.date < window_start and getattr(r, name) is not None
        ]
        if len(values) >= MIN_BASELINE_VALUES:
            out[name] = fmean(values)
    return out


def _drops(scores: dict[str, int], baselines: dict[str, float]) -> list[str]:
    return [n for n, v in scores.items() if n in baselines and v <= baselines[n] - DROP_POINTS]


def _hrv_drop(user, today: date) -> bool:
    tz = _tz(user.profile)
    recent_from = today - timedelta(days=HRV_RECENT_DAYS - 1)
    base_from = recent_from - timedelta(days=HRV_BASELINE_DAYS)
    recent, base = [], []
    for log in user.profile.biometrics.filter(hrv_ms__isnull=False):
        day = log.timestamp.astimezone(tz).date()
        if recent_from <= day <= today:
            recent.append(log.hrv_ms)
        elif base_from <= day < recent_from:
            base.append(log.hrv_ms)
    if len(recent) < HRV_MIN_VALUES or len(base) < HRV_MIN_VALUES or fmean(base) <= 0:
        return False
    return (fmean(recent) - fmean(base)) / fmean(base) * 100 <= -HRV_DROP_PCT


def readiness_data(user, today: date) -> dict:
    window_start = today - timedelta(days=WINDOW_DAYS - 1)
    rows = list(user.profile.checkins.filter(date__gte=window_start - timedelta(days=BASELINE_DAYS), date__lte=today))
    by_day = {r.date: r for r in rows}
    baselines = _baselines(rows, window_start)
    hrv_drop = _hrv_drop(user, today)
    grades = dict(KnowledgeRule.objects.filter(key__in=[READINESS_RULE, HRV_RULE]).values_list("key", "grade"))
    base = {
        "status": "no_data",
        "drops_today": [],
        "days_with_drop": 0,
        "hrv_drop": hrv_drop,
        "rule_key": READINESS_RULE,
        "grade": grades.get(READINESS_RULE),
        "hrv_rule_key": HRV_RULE,
        "hrv_grade": grades.get(HRV_RULE),
    }
    today_row = by_day.get(today)
    if len(baselines) < DROP_ITEMS or today_row is None or not _scores(today_row):
        return base
    per_day = []
    for offset in range(WINDOW_DAYS):
        row = by_day.get(window_start + timedelta(days=offset))
        per_day.append(_drops(_scores(row), baselines) if row else [])
    drops_today = per_day[-1]
    days_with_drop = sum(1 for d in per_day if len(d) >= DROP_ITEMS)
    if days_with_drop == WINDOW_DAYS:
        status = "reduce"
    elif hrv_drop and drops_today:
        status = "easy"
    else:
        status = "ok"
    return {**base, "status": status, "drops_today": drops_today, "days_with_drop": days_with_drop}
