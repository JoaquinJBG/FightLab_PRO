"""«Mi rutina» = una carpeta de rutinas generadas por el plan por reglas (F17 R, punto 5).

El plan de la semana (`coaching.plan`, `WeeklyPlan` activo) se convierte en rutinas del mismo
modelo que las del usuario: una por sesión (A, B…), en la carpeta `kind=plan`. Los números son los
del plan (series, rango de repeticiones, carga del motor y RIR de su regla); aquí no se calcula
nada nuevo. El usuario las puede editar como cualquier rutina.

Regenerar nunca pisa en silencio lo que el usuario cambió: cada rutina generada guarda la huella
de su contenido (`generated_hash`); si alguna ya no coincide, `sync` responde `edited` y el
usuario elige `keep` (la suya se queda como rutina propia en la carpeta y llegan las nuevas) u
`overwrite`.

Seguridad: con `no_training` no se regenera (como `coaching.plan.apply`). Los ejercicios en pausa
o cambiados por una lesión ya vienen resueltos en el plan; aquí llevan su nota.
"""
from coach.profile import ProfileIncomplete
from django.db import transaction

from coaching import plan as plans
from coaching.models import WeeklyPlan
from coaching.safety_views import _lang, _today
from coaching.targets import reasons_data

from . import services
from .catalog import display_name, resolve_key
from .models import Routine, RoutineFolder
from .programs import lang_of
from .serializers import FolderSerializer, routine_summary

# convention (FightLab): descanso de 2 min en las rutinas del plan, dentro de los 1,5-3 min por
# defecto de strength-hypertrophy.md: "Rest intervals for hypertrophy".
PLAN_REST_S = 120

TEXTS = {
    "es": {
        "folder": "Mi rutina",
        "session": "Sesión {key}",
        "notes": "Plan de la semana del {week}. Esfuerzo: RIR {low}-{high}.",
        "deload": " Semana de descarga.",
        "swapped": "Sustituye a {name} (pausa por lesión).",
        "paused": "En pausa por lesión: sin subir carga.",
        "kept": "{title} (tu versión)",
    },
    "en": {
        "folder": "My routine",
        "session": "Session {key}",
        "notes": "Weekly plan of {week}. Effort: RIR {low}-{high}.",
        "deload": " Deload week.",
        "swapped": "Replaces {name} (injury pause).",
        "paused": "Paused for an injury: no added load.",
        "kept": "{title} (your version)",
    },
}


class NoActivePlan(Exception):
    pass


class Blocked(Exception):
    def __init__(self, reasons: list[dict]):
        self.reasons = reasons
        super().__init__("no_training")


class EditedRoutines(Exception):
    def __init__(self, routines: list[dict]):
        self.routines = routines
        super().__init__("edited")


def _active(user) -> WeeklyPlan | None:
    return WeeklyPlan.objects.filter(profile=user.profile, status=WeeklyPlan.Status.ACTIVE).first()


def plan_folder(user) -> RoutineFolder | None:
    return RoutineFolder.objects.filter(profile=user.profile, kind=RoutineFolder.Kind.PLAN).order_by("id").first()


def _generated(folder: RoutineFolder | None) -> list[Routine]:
    if folder is None:
        return []
    return list(folder.routines.filter(source=Routine.Source.PLAN).prefetch_related("exercises").order_by("order", "id"))


def is_edited(routine: Routine) -> bool:
    return bool(routine.generated_hash) and services.content_hash(routine) != routine.generated_hash


def _plan_id(routine: Routine) -> int | None:
    parts = routine.source_ref.split(":")
    return int(parts[1]) if len(parts) == 3 and parts[0] == "plan" and parts[1].isdigit() else None


def status_data(user) -> dict:
    plan = _active(user)
    folder = plan_folder(user)
    generated = _generated(folder)
    in_sync = bool(plan and generated and all(_plan_id(r) == plan.id for r in generated))
    routines = []
    if folder is not None:
        for r in folder.routines.prefetch_related("exercises").order_by("order", "id"):
            routines.append({**routine_summary(r), "edited": r.source == Routine.Source.PLAN and is_edited(r)})
    return {
        "plan_id": plan.id if plan else None,
        "week_start": plan.week_start.isoformat() if plan else None,
        "folder": FolderSerializer(folder).data if folder else None,
        "routines": routines,
        "in_sync": in_sync,
        "edited": [r["id"] for r in routines if r["edited"]],
    }


def _exercise(item: dict, effort: dict, t: dict, lang: str) -> dict:
    low, high = item["rep_range"]
    notes = []
    if item.get("swapped_from"):
        notes.append(t["swapped"].format(name=display_name(item["swapped_from"], lang)))
    if item.get("action") == "paused":
        notes.append(t["paused"])
    return {
        "exercise_key": resolve_key(item["exercise"]),
        "name": display_name(item["exercise"], lang)[:120],
        "notes": " ".join(notes),
        "rest_s": PLAN_REST_S,
        "superset": None,
        "sets": [
            {
                "set_type": "normal",
                "reps": low,
                "reps_max": high if high != low else None,
                "weight_kg": item.get("load_kg"),
                "rpe": None,
                # El extremo más prudente del rango de RIR de la sesión (su regla va en el plan).
                "rir": effort["rir"][1] if effort else None,
            }
            for _ in range(item["sets"])
        ],
    }


@transaction.atomic
def sync(user, on_edited: str | None = None) -> RoutineFolder:
    plan = _active(user)
    if plan is None:
        raise NoActivePlan()
    lang = lang_of(user)
    try:
        plans.check_trainable(user, _today(user.profile))
    except plans.PlanBlocked as exc:
        raise Blocked(reasons_data(exc.reasons, _lang())) from exc
    except ProfileIncomplete:
        pass  # el plan ya se aplicó con el perfil completo; no se borra nada por un dato que falte
    t = TEXTS.get(lang, TEXTS["es"])

    folder = plan_folder(user)
    existing = _generated(folder)
    if existing and all(_plan_id(r) == plan.id for r in existing) and on_edited is None:
        return folder  # ya está al día: no se toca nada
    edited = [r for r in existing if is_edited(r)]
    if edited and on_edited is None:
        raise EditedRoutines([{"id": r.id, "title": r.title} for r in edited])

    if folder is None:
        folder = services.folder_create(user.profile, t["folder"], kind=RoutineFolder.Kind.PLAN)
    for r in existing:
        if r in edited and on_edited == "keep":
            r.source = Routine.Source.USER
            r.generated_hash = ""
            r.title = t["kept"].format(title=r.title)[:120]
            r.save(update_fields=["source", "generated_hash", "title", "updated_at"])
        else:
            r.delete()

    week = plan.week_start.isoformat()
    for s in plan.sessions:
        effort = s.get("effort") or {}
        rir = effort.get("rir") or [None, None]
        notes = t["notes"].format(week=week, low=rir[0], high=rir[1]) + (t["deload"] if plan.deload else "")
        exercises = [_exercise(i, effort, t, lang) for i in s.get("items", []) if i.get("sets", 0) > 0]
        routine = services.routine_create(
            user.profile,
            title=t["session"].format(key=s["key"]),
            notes=notes,
            folder=folder,
            exercises=exercises,
            source=Routine.Source.PLAN,
            source_ref=f"plan:{plan.id}:{s['key']}",
        )
        routine.generated_hash = services.content_hash(Routine.objects.prefetch_related("exercises").get(pk=routine.pk))
        routine.save(update_fields=["generated_hash"])
    return folder
