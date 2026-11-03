"""Series de gimnasio (`SetLog`) desde lo que manda el cliente (Task 6.1).

El cliente manda las series en `sets` (sin tope de tamaño de `detail`). Los clientes antiguos y
la cola offline solo las llevan en `detail.exercises`, que el cliente quita cuando no cabe en
8 KB: entonces la sesión queda marcada como truncada (`Activity.sets_truncated`) y no se inventa
ninguna serie.
"""
from decimal import Decimal, InvalidOperation

from .models import Activity, SetLog

MAX_SETS_PER_SESSION = 300
MAX_REPS = 1000
MAX_KG = Decimal("1000")


def _number(value) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = Decimal(str(value).replace(",", "."))
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def _exercises(detail: dict):
    """`exercises` tal cual o, si no está, el formato compacto de la beta
    (`ex: [{n, s: [[kg, reps]]}]`, cuando el completo no cabe en 8 KB) pasado a la misma forma."""
    exercises = detail.get("exercises")
    if isinstance(exercises, list) or not isinstance(detail.get("ex"), list):
        return exercises
    out = []
    for item in detail["ex"]:
        if not isinstance(item, dict):
            out.append(None)
            continue
        pairs = item.get("s") if isinstance(item.get("s"), list) else []
        out.append({
            "name": item.get("n"),
            "sets": [{"kg": p[0], "reps": p[1]} if isinstance(p, list) and len(p) == 2 else None for p in pairs],
        })
    return out


def sets_from_detail(detail) -> tuple[list[dict], bool]:
    """`detail.exercises` (`[{name, sets: [{kg, reps}]}]`, o el compacto `ex`) → filas de `SetLog` y si faltan.

    Las series sin repeticiones válidas se descartan. 0 kg es una serie con el peso corporal
    (`weight_kg` nulo, como en el coach): el gimnasio de la app no distingue "sin carga" de 0.
    Sin `exercises` pero con `volume_kg`, el cliente quitó el desglose: está truncada.
    """
    if not isinstance(detail, dict):
        return [], False
    exercises = _exercises(detail)
    if not isinstance(exercises, list):
        return [], "volume_kg" in detail
    rows = []
    for ei, exercise in enumerate(exercises):
        if not isinstance(exercise, dict) or not isinstance(exercise.get("name"), str):
            continue
        name = exercise["name"].strip()[:120]
        sets = exercise.get("sets") if isinstance(exercise.get("sets"), list) else []
        for si, s in enumerate(sets):
            if not isinstance(s, dict):
                continue
            reps, kg = _number(s.get("reps")), _number(s.get("kg"))
            if not name or reps is None or reps != reps.to_integral_value() or not 0 < reps <= MAX_REPS:
                continue
            if s.get("kg") is not None and kg is None:  # carga ilegible: no se adivina
                continue
            if kg is not None and not 0 <= kg <= MAX_KG:
                continue
            rows.append({
                "exercise": name,
                "exercise_index": ei,
                "set_index": si,
                "weight_kg": kg if kg else None,
                "reps": int(reps),
            })
    return rows[:MAX_SETS_PER_SESSION], False


def set_logs_create(activity: Activity, rows: list[dict]) -> int:
    SetLog.objects.bulk_create(SetLog(activity=activity, **row) for row in rows)
    return len(rows)


def set_logs_for_new_activity(activity: Activity, sets: list[dict] | None) -> None:
    """Guarda las series de una sesión recién creada: las de `sets` o, si no vienen, las de
    `detail.exercises`. Marca la sesión como truncada si el desglose no llegó."""
    if activity.kind != Activity.Kind.GYM:
        return
    if sets:
        set_logs_create(activity, sets)
        return
    rows, truncated = sets_from_detail(activity.detail)
    if rows:
        set_logs_create(activity, rows)
    elif truncated:
        activity.sets_truncated = True
        activity.save(update_fields=["sets_truncated"])
