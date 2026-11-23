"""Escrituras de rutinas y carpetas (F17 R). Las vistas validan; aquí se guarda."""
import hashlib
import json

from django.db import transaction
from django.db.models import F, Max

from .models import Routine, RoutineExercise, RoutineFolder
from .serializers import set_to_json


def normalise_supersets(exercises: list[dict]) -> list[dict]:
    """Los grupos de superserie se renumeran 0, 1… por orden de aparición; un grupo con un solo
    ejercicio deja de ser superserie (como en Hevy: una superserie son 2 o más ejercicios)."""
    counts: dict[int, int] = {}
    for ex in exercises:
        if ex.get("superset") is not None:
            counts[ex["superset"]] = counts.get(ex["superset"], 0) + 1
    renumber: dict[int, int] = {}
    out = []
    for ex in exercises:
        group = ex.get("superset")
        if group is None or counts[group] < 2:
            out.append({**ex, "superset": None})
            continue
        if group not in renumber:
            renumber[group] = len(renumber)
        out.append({**ex, "superset": renumber[group]})
    return out


def _next_order(profile, folder) -> int:
    top = Routine.objects.filter(profile=profile, folder=folder).aggregate(m=Max("order"))["m"]
    return 0 if top is None else top + 1


def _write_exercises(routine: Routine, exercises: list[dict]) -> None:
    routine.exercises.all().delete()
    RoutineExercise.objects.bulk_create(
        RoutineExercise(
            routine=routine,
            exercise_key=ex.get("exercise_key"),
            name=ex["name"],
            order=i,
            superset=ex.get("superset"),
            notes=ex.get("notes", ""),
            rest_s=ex.get("rest_s"),
            sets=[set_to_json(s) for s in ex.get("sets", [])],
        )
        for i, ex in enumerate(normalise_supersets(exercises))
    )


@transaction.atomic
def routine_create(profile, *, title, notes="", folder=None, exercises=(), source=Routine.Source.USER,
                   source_ref="", order=None) -> Routine:
    routine = Routine.objects.create(
        profile=profile,
        folder=folder,
        title=title,
        notes=notes,
        order=_next_order(profile, folder) if order is None else order,
        source=source,
        source_ref=source_ref,
    )
    _write_exercises(routine, list(exercises))
    return routine


@transaction.atomic
def routine_update(routine: Routine, data: dict) -> Routine:
    """`data` ya validado; solo cambia lo que trae. Cambiar de carpeta la pone al final."""
    if "folder" in data and data["folder"] != routine.folder:
        routine.folder = data["folder"]
        routine.order = _next_order(routine.profile, routine.folder)
    for name in ("title", "notes"):
        if name in data:
            setattr(routine, name, data[name])
    routine.save()
    if "exercises" in data:
        _write_exercises(routine, data["exercises"])
    return routine


def exercises_payload(routine: Routine) -> list[dict]:
    return [
        {
            "exercise_key": e.exercise_key,
            "name": e.name,
            "notes": e.notes,
            "rest_s": e.rest_s,
            "superset": e.superset,
            "sets": [set_to_json(s) for s in e.sets],
        }
        for e in routine.exercises.all()
    ]


@transaction.atomic
def routine_duplicate(routine: Routine, suffix: str) -> Routine:
    """La copia va justo detrás del original, en la misma carpeta."""
    Routine.objects.filter(profile=routine.profile, folder=routine.folder, order__gt=routine.order).update(
        order=F("order") + 1
    )
    return routine_create(
        routine.profile,
        title=f"{routine.title} ({suffix})"[:120],
        notes=routine.notes,
        folder=routine.folder,
        exercises=exercises_payload(routine),
        order=routine.order + 1,
    )


@transaction.atomic
def routines_reorder(profile, folder, ids: list[int]) -> bool:
    """Pone las rutinas `ids` de esa carpeta en ese orden. `False` si alguna no es de ahí."""
    routines = {r.id: r for r in Routine.objects.filter(profile=profile, folder=folder, id__in=ids)}
    if len(routines) != len(set(ids)) or len(ids) != len(set(ids)):
        return False
    rest = Routine.objects.filter(profile=profile, folder=folder).exclude(id__in=ids).order_by("order", "id")
    for i, rid in enumerate(list(ids) + [r.id for r in rest]):
        Routine.objects.filter(pk=rid).update(order=i)
    return True


@transaction.atomic
def folders_reorder(profile, ids: list[int]) -> bool:
    found = set(RoutineFolder.objects.filter(profile=profile, id__in=ids).values_list("id", flat=True))
    if found != set(ids) or len(ids) != len(found):
        return False
    rest = RoutineFolder.objects.filter(profile=profile).exclude(id__in=ids).order_by("order", "id")
    for i, fid in enumerate(list(ids) + [f.id for f in rest]):
        RoutineFolder.objects.filter(pk=fid).update(order=i)
    return True


def folder_create(profile, name: str, *, kind=RoutineFolder.Kind.USER, program_slug="") -> RoutineFolder:
    top = RoutineFolder.objects.filter(profile=profile).aggregate(m=Max("order"))["m"]
    return RoutineFolder.objects.create(
        profile=profile, name=name, kind=kind, program_slug=program_slug, order=0 if top is None else top + 1
    )


@transaction.atomic
def folder_delete(folder: RoutineFolder, *, with_routines: bool) -> None:
    if with_routines:
        folder.routines.all().delete()
    else:
        for routine in folder.routines.all().order_by("order", "id"):
            routine.folder = None
            routine.order = _next_order(folder.profile, None)
            routine.save(update_fields=["folder", "order"])
    folder.delete()


def content_hash(routine: Routine) -> str:
    """Huella del contenido editable (título, notas y ejercicios) para saber si se ha cambiado."""
    payload = {"title": routine.title, "notes": routine.notes, "exercises": exercises_payload(routine)}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
