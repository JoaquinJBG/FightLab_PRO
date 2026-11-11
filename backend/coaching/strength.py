"""Fuerza: e1RM, series duras por músculo y progresión por ejercicio (Task 6.2).

Cada número sale de `coach.strength` sobre las series de `SetLog` (`adapters.set_records`), con
el mapa de músculos del coach más los alias del gimnasio de FightLab (`bridge/muscle_map.py`).
La progresión aplica los flags de seguridad en el servidor: `no_training` no prescribe nada,
`hold_progression` mantiene la carga y un ejercicio en pausa por una lesión no progresa.
"""
from collections import defaultdict
from datetime import date, timedelta

from coach import safety
from coach import strength as coach_strength

from .bridge.adapters import set_records, to_coach_profile
from .bridge.muscle_map import muscle_map
from .bridge.reasons import parse_reason
from .targets import _key, reasons_data, rule_refs
from .views import engine_info

# convention (del coach, `cli.py`): la progresión sin ejercicio cubre lo entrenado en 4 semanas.
PROGRESS_LOOKBACK_DAYS = 28
# convention (FightLab): la curva de e1RM enseña las últimas 12 semanas.
E1RM_LOOKBACK_DAYS = 84

EPLEY_CONVENTION = "coach"  # `docs/conventions.md` del coach: ninguna regla nombra una fórmula
WEEKLY_SETS_RULE = 'strength-hypertrophy.md: "Weekly sets per muscle (dose-response)"'
COUNTING_RULE = 'strength-hypertrophy.md: "Default counting rule: direct 1, indirect 0.5"'
DOUBLE_PROGRESSION = coach_strength.DOUBLE_PROGRESSION


def best_by_day(history) -> list[tuple[date, float]]:
    """Mejor e1RM de cada día con carga (las series con el peso corporal no tienen e1RM)."""
    best: dict[date, float] = {}
    for s in history:
        if not coach_strength.is_working(s) or s.weight_kg is None:
            continue
        value = coach_strength.e1rm(s.weight_kg, s.reps, coach_strength.effective_rir(s) or 0)
        best[s.date] = max(best.get(s.date, 0.0), value)
    return sorted(best.items())


def _by_exercise(records) -> dict[str, list]:
    out: dict[str, list] = defaultdict(list)
    for s in records:
        out[s.exercise].append(s)
    return out


def e1rm_data(user, today: date, lang: str) -> dict:
    since = today - timedelta(days=E1RM_LOOKBACK_DAYS)
    exercises = []
    for name, history in sorted(_by_exercise(set_records(user, since, today)).items()):
        points = best_by_day(history)
        if points:
            exercises.append({
                "exercise": name,
                "points": [{"date": d.isoformat(), "e1rm_kg": round(v, 2)} for d, v in points],
                "latest_kg": round(points[-1][1], 2),
            })
    return {
        "engine": engine_info(),
        "since": since.isoformat(),
        "exercises": exercises,
        # Epley con las repeticiones en reserva sumadas: convención del coach, sin regla.
        "convention": EPLEY_CONVENTION,
        "rules": [],
    }


def week_bounds(records, today: date, week_ending: date | None) -> tuple[date, date]:
    """Como `coach strength sets`: los 7 días que acaban en la última sesión registrada."""
    end = week_ending or max((s.date for s in records if s.date <= today), default=today)
    return end - timedelta(days=6), end


def sets_data(user, today: date, lang: str, week_ending: date | None = None) -> dict:
    records = set_records(user, until=today)
    start, end = week_bounds(records, today, week_ending)
    week = [s for s in records if start <= s.date <= end]
    mapped = muscle_map()
    sets = coach_strength.weekly_hard_sets(week, mapped)
    return {
        "engine": engine_info(),
        "week": {"start": start.isoformat(), "end": end.isoformat()},
        "sets": {muscle: round(value, 2) for muscle, value in sorted(sets.items())},
        "unmapped": coach_strength.unmapped_exercises(week, mapped),
        "reference_sets_per_week": coach_strength.WEEKLY_SETS_REFERENCE,
        "rules": rule_refs([_key(WEEKLY_SETS_RULE), _key(COUNTING_RULE)], lang),
    }


def suggestion_for(name: str, history, today: date, flags, profile, rep_range=coach_strength.REP_RANGE):
    """`coach.strength.progression` con el mapa de FightLab, los flags y el fin de la pausa."""
    mapped = muscle_map()
    return coach_strength.progression(
        history,
        today=today,
        rep_range=rep_range,
        muscle_map=mapped,
        flags=flags,
        stall_after=coach_strength.pause_end(name, profile.injuries, mapped),
    )


def suggestion_rule_key(suggestion, reasons) -> str | None:
    """La regla de la línea: la del primer motivo que cita una, o "Double progression"."""
    keys = [r.rule_key for r in reasons if r.rule_key]
    if keys:
        return keys[0]
    return _key(DOUBLE_PROGRESSION) if suggestion.action not in ("no_training",) else None


def suggestion_data(name: str, suggestion, lang: str) -> dict:
    reasons = [parse_reason(text) for text in dict.fromkeys(suggestion.reasons)]
    return {
        "exercise": name,
        "action": suggestion.action,
        "load_kg": suggestion.load_kg,
        "rep_range": list(suggestion.rep_range),
        "rule_key": suggestion_rule_key(suggestion, reasons),
        "reasons": reasons_data(reasons, lang),
    }


def progress_data(user, today: date, lang: str, exercise: str | None = None) -> dict:
    profile = to_coach_profile(user, today)
    flags = safety.flags(profile, today)
    records = set_records(user, until=today)
    by_name = _by_exercise(records)
    if exercise:
        wanted = exercise.strip().lower()
        names = sorted(n for n in by_name if n.lower() == wanted)
    else:
        recent = today - timedelta(days=PROGRESS_LOOKBACK_DAYS)
        names = sorted({s.exercise for s in records if s.date > recent})
    items = [suggestion_data(n, suggestion_for(n, by_name[n], today, flags, profile), lang) for n in names]
    keys = [i["rule_key"] for i in items if i["rule_key"]]
    return {
        "engine": engine_info(),
        "exercises": items,
        "no_training": flags.no_training,
        "rules": rule_refs(keys, lang),
    }


# convention (FightLab): cuántos ejercicios caben en una consulta de "Última vez".
LAST_MAX_EXERCISES = 50


def _last_session(history) -> dict | None:
    """La última sesión con series de trabajo: cuántas, y la serie con más carga (a igual carga,
    la de más repeticiones), como lo enseñaba el gimnasio desde el navegador."""
    working = [s for s in history if coach_strength.is_working(s)]
    if not working:
        return None
    day = working[-1].date
    sets = [s for s in working if s.date == day]
    top = max(sets, key=lambda s: (s.weight_kg or 0, s.reps or 0))
    return {"date": day.isoformat(), "sets": len(sets), "reps": top.reps, "weight_kg": top.weight_kg}


def _exercise_ident(name: str) -> str:
    try:
        from exercises.legacy import legacy_exercise_key
    except ImportError:
        return name.lower()
    return legacy_exercise_key(name) or name.lower()


def last_data(user, today: date, names: list[str]) -> dict:
    """"Última vez", récord de carga y mejor e1RM de cada ejercicio de `names`, de `SetLog`.

    El récord es la carga máxima de una serie de trabajo (las series con el peso corporal y los
    calentamientos no cuentan). El e1RM es el del coach (Epley con las repeticiones en reserva,
    `best_by_day`), sobre todo el historial."""
    # Un ejercicio es el mismo por su clave del catálogo («Pull Up» = «Dominadas»); sin ella, por
    # el nombre sin mayúsculas. Así lo importado con nombres en inglés también cuenta.
    by_lower: dict[str, list] = defaultdict(list)
    for s in set_records(user, until=today):
        by_lower[_exercise_ident(s.exercise)].append(s)
    exercises = {}
    for name in dict.fromkeys(n.strip() for n in names if n.strip()):
        history = by_lower.get(_exercise_ident(name), [])
        loads = [s.weight_kg for s in history if coach_strength.is_working(s) and s.weight_kg]
        points = best_by_day(history)
        exercises[name] = {
            "last": _last_session(history),
            "pr_kg": max(loads) if loads else None,
            "best_e1rm_kg": round(max(v for _, v in points), 2) if points else None,
        }
    return {"engine": engine_info(), "exercises": exercises, "convention": EPLEY_CONVENTION}
