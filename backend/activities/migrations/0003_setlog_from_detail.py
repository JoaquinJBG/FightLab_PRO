"""Task 6.1: las series que ya están en `Activity.detail.exercises` pasan a `SetLog`.

Si el cliente quitó el desglose porque no cabía (solo queda `volume_kg`), la sesión se marca con
`sets_truncated` y no se inventa nada. La lectura de `detail` se copia aquí (no se importa de
`activities.sets`) para que la migración no cambie si cambia el código.
"""
from decimal import Decimal, InvalidOperation

from django.db import migrations

MAX_SETS_PER_SESSION = 300


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = Decimal(str(value).replace(",", "."))
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def _rows(detail):
    if not isinstance(detail, dict):
        return [], False
    exercises = detail.get("exercises")
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
            if not name or reps is None or reps != reps.to_integral_value() or not 0 < reps <= 1000:
                continue
            if s.get("kg") is not None and kg is None:  # carga ilegible: no se adivina
                continue
            if kg is not None and not 0 <= kg <= 1000:
                continue
            rows.append({"exercise": name, "exercise_index": ei, "set_index": si,
                         "weight_kg": kg if kg else None, "reps": int(reps)})
    return rows[:MAX_SETS_PER_SESSION], False


def forwards(apps, schema_editor):
    Activity = apps.get_model("activities", "Activity")
    SetLog = apps.get_model("activities", "SetLog")
    for activity in Activity.objects.filter(kind="GYM").iterator():
        if SetLog.objects.filter(activity=activity).exists():
            continue
        rows, truncated = _rows(activity.detail)
        if rows:
            SetLog.objects.bulk_create(SetLog(activity=activity, **row) for row in rows)
        elif truncated and not activity.sets_truncated:
            activity.sets_truncated = True
            activity.save(update_fields=["sets_truncated"])


def backwards(apps, schema_editor):
    apps.get_model("activities", "SetLog").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("activities", "0002_setlog")]

    operations = [migrations.RunPython(forwards, backwards)]
