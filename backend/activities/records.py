"""Récords y progreso por ejercicio (F17, rama H), sobre las series de `SetLog`.

Un ejercicio se identifica por su clave del contrato (`cat:<slug>` o `custom:<id>`). Las series
antiguas no la tienen: se traducen con `exercises.legacy.legacy_exercise_key` (los 30 nombres de
`LIBRARY`, de la rama E) y, si no hay traducción, se agrupan por el nombre (`name:<nombre>` en
minúsculas).

Qué es un récord (como Hevy): solo las series de trabajo (los calentamientos no cuentan) con
repeticiones. Peso máximo, repeticiones a cada peso, e1RM (Epley con las repeticiones en reserva,
la convención del coach), volumen de una serie (kg × reps) y volumen de la sesión en ese ejercicio.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from coach import strength as coach_strength

from coaching.bridge.adapters import _tz

from .models import SetLog

CONVENTION = "coach"  # Epley con las repeticiones en reserva: convención del coach, sin regla
MAX_REPS_BY_WEIGHT = 30


def _legacy_key(name: str) -> str | None:
    try:  # la app `exercises` es de la rama E: sin ella, se agrupa por el nombre
        from exercises.legacy import legacy_exercise_key
    except ImportError:
        return None
    try:
        return legacy_exercise_key(name)
    except Exception:  # noqa: BLE001 - una traducción rota no tumba los récords
        return None


def exercise_id(key: str | None, name: str) -> str:
    """El identificador con el que se agrupan las series de un ejercicio."""
    if key:
        return key
    return _legacy_key(name) or f"name:{name.strip().lower()}"


def wanted_id(raw: str) -> str:
    """Lo que pide el cliente (`cat:…`, `custom:…`, `name:…` o un nombre suelto) → identificador."""
    raw = raw.strip()
    if raw.startswith(("cat:", "custom:")):
        return raw
    if raw.startswith("name:"):
        return f"name:{raw[5:].strip().lower()}"
    return exercise_id(None, raw)


@dataclass
class _Set:
    activity_id: int
    day: date
    name: str
    weight: float | None
    reps: int
    rir: float | None
    rpe: float | None

    @property
    def e1rm(self) -> float | None:
        if not self.weight or self.reps < 1:
            return None
        rir = coach_strength.effective_rir(self) or 0
        return coach_strength.e1rm(self.weight, self.reps, max(0.0, rir))

    @property
    def volume(self) -> float:
        return (self.weight or 0) * self.reps


def _working_sets(user) -> dict[str, list[_Set]]:
    tz = _tz(user.profile)
    out: dict[str, list[_Set]] = defaultdict(list)
    rows = (
        SetLog.objects.filter(activity__profile=user.profile, reps__gt=0)
        .exclude(set_type="warmup")
        .select_related("activity")
        .order_by("activity__started_at", "activity_id", "exercise_index", "set_index")
    )
    for log in rows:
        out[exercise_id(log.exercise_key, log.exercise)].append(_Set(
            log.activity_id,
            log.activity.started_at.astimezone(tz).date(),
            log.exercise,
            float(log.weight_kg) if log.weight_kg is not None else None,
            log.reps,
            float(log.rir) if log.rir is not None else None,
            float(log.rpe) if log.rpe is not None else None,
        ))
    return out


def _r(value: float | None) -> float | None:
    return round(value, 2) if value is not None else None


def _records(sets: list[_Set]) -> dict:
    loaded = [s for s in sets if s.weight]
    heaviest = max(loaded, key=lambda s: (s.weight, s.reps), default=None)
    with_e1rm = [s for s in loaded if s.e1rm is not None]
    best = max(with_e1rm, key=lambda s: (s.e1rm, s.weight), default=None)
    top_set = max(loaded, key=lambda s: (s.volume, s.weight), default=None)
    sessions: dict[int, tuple[date, float]] = {}
    for s in sets:
        day, total = sessions.get(s.activity_id, (s.day, 0.0))
        sessions[s.activity_id] = (day, total + s.volume)
    top_session = max(sessions.values(), key=lambda v: v[1], default=None)
    by_weight: dict[float, _Set] = {}
    for s in loaded:
        if s.weight not in by_weight or s.reps > by_weight[s.weight].reps:
            by_weight[s.weight] = s
    return {
        "name": sets[-1].name,
        "sessions": len(sessions),
        "max_weight_kg": _r(heaviest.weight) if heaviest else None,
        "max_weight_date": heaviest.day.isoformat() if heaviest else None,
        "max_reps": max(s.reps for s in sets),
        "best_e1rm_kg": _r(best.e1rm) if best else None,
        "best_e1rm_date": best.day.isoformat() if best else None,
        "best_set_volume_kg": _r(top_set.volume) if top_set else None,
        "best_session_volume_kg": _r(top_session[1]) if top_session and top_session[1] > 0 else None,
        "reps_by_weight": [
            {"weight_kg": _r(w), "reps": s.reps, "date": s.day.isoformat()}
            for w, s in sorted(by_weight.items(), reverse=True)[:MAX_REPS_BY_WEIGHT]
        ],
    }


def records_data(user, wanted: list[str] | None = None) -> dict:
    """Los récords de cada ejercicio (todos, o los de `wanted`; los que no tienen series, null)."""
    by_id = _working_sets(user)
    if wanted:
        ids = list(dict.fromkeys(wanted_id(w) for w in wanted if w.strip()))
        records = {i: (_records(by_id[i]) if by_id.get(i) else None) for i in ids}
    else:
        records = {i: _records(sets) for i, sets in sorted(by_id.items(), key=lambda kv: kv[1][-1].name.lower())}
    return {"records": records, "convention": CONVENTION}


def progress_data(user, wanted: str) -> dict:
    """Una fila por sesión del ejercicio: mejor e1RM, peso máximo, volumen y mejor serie."""
    ident = wanted_id(wanted)
    sets = _working_sets(user).get(ident, [])
    by_activity: dict[int, list[_Set]] = defaultdict(list)
    for s in sets:
        by_activity[s.activity_id].append(s)
    points = []
    for activity_id, rows in by_activity.items():
        loaded = [s for s in rows if s.weight]
        best = max((s for s in loaded if s.e1rm is not None), key=lambda s: (s.e1rm, s.weight), default=None)
        points.append({
            "date": rows[0].day.isoformat(),
            "activity_id": activity_id,
            "e1rm_kg": _r(best.e1rm) if best else None,
            "max_weight_kg": _r(max((s.weight for s in loaded), default=None)),
            "volume_kg": _r(sum(s.volume for s in rows)),
            "reps": sum(s.reps for s in rows),
            "best_set": {"weight_kg": _r(best.weight), "reps": best.reps} if best else None,
        })
    return {
        "exercise": ident,
        "name": sets[-1].name if sets else None,
        "sessions": points,
        "convention": CONVENTION,
    }
