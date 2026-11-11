"""Importar series de un CSV de Hevy o genérico a `SetLog` (Task 9.1, spec §3 fila 13).

Cada sesión del archivo es una `Activity` de gimnasio con `source=IMPORT` y `external_id` = el
`session_id` del coach (importador + hora de inicio). La deduplicación es la del coach
(`coach.sessions.store.append`): una serie con la misma clave que una ya guardada (`ExerciseSet.key`:
importador, inicio, ejercicio, bloque y serie) no se añade y cuenta como duplicada, así que
reimportar el mismo archivo, o un export más largo que se solapa con el anterior, no duplica nada.
Si la serie guardada en esa posición es de otro ejercicio (se editó en la app de origen), la
guardada gana, como en el coach.

Las filas sin repeticiones, peso, duración ni distancia son restos de plantilla de Hevy
(`ExerciseSet.is_empty`): no se importan y se avisa de cuántas son, como `coach import`.

Las sesiones importadas no llevan RPE de sesión, así que no suman carga (el motor de carga solo
cuenta las que lo tienen): no se inventa.

F17 (rama H), importar de Hevy de forma completa:
- cada serie guarda su tipo (`dropset` pasa a `drop`, el nombre del contrato), su RPE, las notas
  del ejercicio, la superserie (`superset_id`) y la clave del ejercicio (la del catálogo o la de
  un ejercicio propio creado con la API de la rama E, como los personalizados de Hevy);
- la descripción de la sesión pasa a su nota;
- reimportar no duplica y completa lo importado antes sin esos datos;
- los ejercicios con pareja en el catálogo (también por los alias en inglés de Hevy,
  `exercises.hevy_aliases`) se guardan con el nombre del catálogo en el idioma de la cuenta;
- de cada título de entreno distinto sale una rutina con los ejercicios de todas sus sesiones (el
  orden de la última y, al final, los que solo salían antes) y las series de la última vez que
  salió cada uno, con el cuerpo del contrato de la rama R y `source=import` / `source_ref` = el título
  (`activities.contract.create_routine`). Reimportar no la vuelve a crear (`ImportedRoutine`),
  ni aunque el usuario la haya borrado.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import transaction
from django.utils import timezone

from activities import contract
from activities.models import Activity, ImportedRoutine, SetLog
from activities.sets import MAX_KG, MAX_REPS, MAX_SETS_PER_SESSION

from .bridge.importers import ImportFileError, Parsed

MAX_IMPORT_SETS = 20_000
# Antes de esta fecha casi seguro es un error de formato (las apps de gimnasio no existían).
IMPORT_FLOOR = datetime(2000, 1, 1, tzinfo=dt_timezone.utc)
FUTURE_SKEW = timedelta(days=1)  # el día local del archivo puede ir por delante del UTC
MAX_DISTANCE_KM = 1000
MAX_DURATION_S = 86_400
MAX_INDEX = 32_767  # PositiveSmallIntegerField


def _tz(profile) -> ZoneInfo:
    try:
        return ZoneInfo(profile.timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _dec(value: float | None, places: int) -> Decimal | None:
    return None if value is None else Decimal(str(round(value, places)))


SET_TYPE_ALIASES = {"dropset": "drop"}


def _row(s, warnings: Counter, extra: dict | None = None, key: str | None = None, name: str | None = None) -> dict | None:
    """`ExerciseSet` → campos de `SetLog`, o None si la serie no se puede guardar."""
    if s.exercise_index > MAX_INDEX or s.set_index > MAX_INDEX or not s.exercise.strip():
        warnings["set_invalid"] += 1
        return None
    if (s.weight_kg is not None and not 0 <= s.weight_kg <= MAX_KG) or (
        s.reps is not None and not 0 <= s.reps <= MAX_REPS
    ):
        warnings["set_out_of_range"] += 1
        return None
    rpe = s.rpe if s.rpe is not None and 1 <= s.rpe <= 10 else None
    rir = s.rir if s.rir is not None and 0 <= s.rir <= 10 else None
    distance = s.distance_km if s.distance_km is not None and 0 <= s.distance_km <= MAX_DISTANCE_KM else None
    duration = s.duration_s if s.duration_s is not None and 0 <= s.duration_s <= MAX_DURATION_S else None
    if (rpe, rir, distance, duration) != (s.rpe, s.rir, s.distance_km, s.duration_s):
        warnings["value_dropped"] += 1
    return {
        "exercise": (name or s.exercise).strip()[:120],
        "exercise_index": s.exercise_index,
        "set_index": s.set_index,
        "set_type": SET_TYPE_ALIASES.get(s.set_type, s.set_type)[:16] or "normal",
        "weight_kg": _dec(s.weight_kg, 2),
        "reps": s.reps,
        "rir": _dec(rir, 1),
        "rpe": _dec(rpe, 1),
        "distance_km": _dec(distance, 3),
        "duration_s": duration,
        "exercise_key": key,
        "notes": (s.notes or "")[:1000],
        "superset": (extra or {}).get("superset"),
    }


def _duration(start: datetime, sets, end_times: dict) -> tuple[int, bool]:
    """Segundos de la sesión: de Hevy, fin − inicio; si no, la suma de las duraciones de las
    series. Sin ninguno de los dos, 1 s y `duration_known: false` (el modelo pide al menos 1)."""
    end = end_times.get(start)
    if end is not None:
        return min(MAX_DURATION_S, int((end - start).total_seconds())), True
    total = sum(s.duration_s or 0 for s in sets)
    if total > 0:
        return min(MAX_DURATION_S, total), True
    return 1, False


def _routine_payload(title: str, rows: list[dict]) -> dict:
    """Los ejercicios y series de una sesión → el cuerpo de `POST gym/routines` (contrato de R)."""
    blocks: dict[int, dict] = {}
    for r in sorted(rows, key=lambda r: (r["exercise_index"], r["set_index"])):
        block = blocks.setdefault(r["exercise_index"], {
            "exercise_key": r["exercise_key"],
            "name": r["exercise"],
            "notes": r["notes"],
            "rest_s": None,
            "superset": r["superset"],
            "sets": [],
        })
        block["sets"].append({
            "set_type": r["set_type"] if r["set_type"] in ("warmup", "normal", "drop", "failure") else "normal",
            "reps": r["reps"],
            "reps_max": None,
            "weight_kg": float(r["weight_kg"]) if r["weight_kg"] is not None else None,
            "rpe": float(r["rpe"]) if r["rpe"] is not None else None,
            "rir": float(r["rir"]) if r["rir"] is not None else None,
        })
    return {"title": title[:120], "notes": "", "exercises": list(blocks.values())}


def _merge_sessions(sessions: list[tuple[datetime, list[dict]]]) -> list[dict]:
    """Las sesiones de un mismo título → las filas de una sola rutina (R4-5): los ejercicios de
    la última sesión, en su orden, y detrás los que solo salían en las anteriores (de la más
    reciente a la más antigua). Cada ejercicio lleva las series de la última sesión en la que
    salió. Un ejercicio es el mismo por su clave o, sin ella, por su nombre."""
    merged: list[dict] = []
    seen: set[str] = set()
    supersets: dict[tuple[int, int], int] = {}  # los números de superserie son de cada sesión
    for n, (_, rows) in enumerate(sorted(sessions, key=lambda s: s[0], reverse=True)):
        blocks: dict[int, list[dict]] = defaultdict(list)
        for r in rows:
            blocks[r["exercise_index"]].append(r)
        for index in sorted(blocks):
            block = blocks[index]
            ident = block[0]["exercise_key"] or " ".join(block[0]["exercise"].lower().split())
            if ident in seen:
                continue
            seen.add(ident)
            for r in block:
                group = r["superset"]
                if group is not None:
                    group = supersets.setdefault((n, group), len(supersets))
                merged.append({**r, "exercise_index": len(seen) - 1, "superset": group})
    return merged


def _routines(user, source: str, last_by_title: dict[str, list[dict]], dry_run: bool) -> dict:
    """Una rutina por título (con su última sesión), sin repetir las ya creadas al importar."""
    profile = user.profile
    done = set(ImportedRoutine.objects.filter(profile=profile, source=source).values_list("title", flat=True))
    counts = {"new": 0, "existing": 0, "unavailable": 0}
    for title, rows in sorted(last_by_title.items()):
        if title[:120] in done or contract.imported_routine_exists(user, title):
            counts["existing"] += 1
            continue
        if dry_run:
            counts["new"] += 1
            continue
        routine_id = contract.create_routine(user, _routine_payload(title, rows), source_ref=title)
        if routine_id is None:
            counts["unavailable"] += 1
            continue
        ImportedRoutine.objects.get_or_create(profile=profile, source=source, title=title[:120],
                                              defaults={"routine_id": routine_id})
        counts["new"] += 1
    return counts


# Lo que reimportar completa en las series ya guardadas (importadas antes de F17).
BACKFILL = ("exercise_key", "notes", "superset")


def import_sets(user, parsed: Parsed, *, dry_run: bool = False) -> dict:
    """Guarda las series de `parsed` (o, con `dry_run`, solo cuenta lo que haría)."""
    profile = user.profile
    tz = _tz(profile)
    extras = parsed.extras if len(parsed.extras) == len(parsed.sets) else [{} for _ in parsed.sets]
    pairs = list(zip(parsed.sets, extras))
    empty = [s for s, _ in pairs if s.is_empty]
    performed = [(s, e) for s, e in pairs if not s.is_empty]
    if not performed:
        raise ImportFileError("no_sets", {"empty": len(empty)})
    if len(performed) > MAX_IMPORT_SETS:
        raise ImportFileError("too_many_sets", {"max": MAX_IMPORT_SETS})

    warnings: Counter = Counter()
    if empty:
        warnings["template_rows"] = len(empty)
    sessions = defaultdict(list)
    for s, e in performed:
        sessions[(s.source, s.start_time)].append((s, e))

    keys: dict[str, str | None] = {}
    now = timezone.now()
    created = updated = added = duplicates = 0
    days = []
    # Rutinas (Hevy): las sesiones de cada título; la rutina junta los ejercicios de todas.
    by_title: dict[str, list[tuple[datetime, list[dict]]]] = defaultdict(list)
    lang = getattr(profile, "language", None) or "es"
    for (source, start), items in sorted(sessions.items(), key=lambda kv: kv[0][1]):
        started = start.replace(tzinfo=tz)
        if not IMPORT_FLOOR <= started <= now + FUTURE_SKEW:
            warnings["session_out_of_range"] += 1
            continue
        if len(items) > MAX_SETS_PER_SESSION:
            warnings["session_truncated"] += 1
            items = items[:MAX_SETS_PER_SESSION]
        sets = [s for s, _ in items]
        rows = []
        for s, e in items:
            key = contract.exercise_key_for(user, s.exercise.strip(), create=not dry_run, cache=keys)
            # R4-5: con pareja en el catálogo, el nombre es el del catálogo (en el idioma de la
            # cuenta), no el que traía el CSV («Pull Up» → «Dominadas»).
            row = _row(s, warnings, e, key, contract.catalog_name(key, lang, s.exercise.strip()))
            if row is not None:
                rows.append(row)
        if not rows:
            continue
        title = (sets[0].session_title or "").strip()
        if source == "hevy_csv" and title:
            by_title[title].append((start, rows))
        description = next((e.get("description") for _, e in items if e.get("description")), "")
        external_id = sets[0].session_id
        with transaction.atomic():
            activity = (
                Activity.objects.select_for_update()
                .filter(profile=profile, source=Activity.Source.IMPORT, external_id=external_id)
                .first()
            )
            stored = {(r.exercise_index, r.set_index): r for r in activity.sets.all()} if activity else {}
            new = []
            for row in rows:
                key = (row["exercise_index"], row["set_index"])
                if key in stored:
                    duplicates += 1
                    old = stored[key]
                    fill = [f for f in BACKFILL if row[f] not in (None, "") and getattr(old, f) in (None, "")]
                    if fill and not dry_run and old.exercise == row["exercise"]:
                        for f in fill:
                            setattr(old, f, row[f])
                        old.save(update_fields=fill)
                    continue
                stored[key] = None
                new.append(row)
            if activity is not None and description and not activity.note and not dry_run:
                activity.note = description[:2000]
                activity.save(update_fields=["note"])
            if not new:
                continue
            days.append(started.date())
            added += len(new)
            if activity is None:
                created += 1
            else:
                updated += 1
            if dry_run:
                continue
            if activity is None:
                seconds, known = _duration(start, sets, parsed.end_times)
                activity = Activity.objects.create(
                    profile=profile,
                    kind=Activity.Kind.GYM,
                    title=(sets[0].session_title or "")[:80],
                    started_at=started,
                    duration_sec=max(1, seconds),
                    source=Activity.Source.IMPORT,
                    external_id=external_id,
                    note=description[:2000],
                    detail={"import": {"source": source}, "duration_known": known},
                )
            SetLog.objects.bulk_create(SetLog(activity=activity, **row) for row in new)

    result = {
        "importer": parsed.importer,
        "dry_run": dry_run,
        "sessions": {"new": created, "updated": updated, "total": len(sessions)},
        "sets": {"imported": added, "duplicates": duplicates, "in_file": len(parsed.sets)},
        "range": {"first": min(days).isoformat(), "last": max(days).isoformat()} if days else None,
        "warnings": [{"code": code, "count": n} for code, n in sorted(warnings.items())],
    }
    if parsed.importer == "hevy_csv":
        result["routines"] = _routines(user, "hevy_csv", {t: _merge_sessions(s) for t, s in by_title.items()}, dry_run)
    return result
