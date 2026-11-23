"""Programas clásicos (F17 R) como datos: `routines/data/programs/*.json`.

Cada programa lleva su fuente (`source`) o la etiqueta «FightLab convention», y las reglas del
coach que fijan sus parámetros (`rules`, para los chips de evidencia). Cargar un programa lo
copia como rutinas del usuario en una carpeta nueva: desde ahí son suyas y las edita como
cualquier otra.

Formato compacto de cada ejercicio: `{"exercise": <nombre de LIBRARY>, "rest_s", "warmup",
"sets", "reps": [mín, máx], "rir", "superset", "notes"}`. Al cargar se expande a series
planificadas (`warmup` de calentamiento y `sets` normales con su rango y RIR).
"""
import json
from functools import lru_cache
from pathlib import Path

from django.db import transaction
from django.utils.translation import get_language

from coaching.targets import rule_refs

from . import services
from .catalog import display_name, resolve_key
from .models import Routine, RoutineFolder

DATA_DIR = Path(__file__).resolve().parent / "data" / "programs"
LANGS = ("es", "en")
CONVENTION = "FightLab convention"
# convention (FightLab): las series de calentamiento de un programa, de 8 repeticiones sin carga
# fijada (la pone el usuario).
WARMUP_REPS = 8


@lru_cache(maxsize=1)
def _load_all() -> tuple[dict, ...]:
    programs = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(DATA_DIR.glob("*.json"))]
    return tuple(sorted(programs, key=lambda p: (p.get("order", 99), p["slug"])))


def all_programs() -> tuple[dict, ...]:
    return _load_all()


def get_program(slug: str) -> dict | None:
    return next((p for p in _load_all() if p["slug"] == slug), None)


def lang_of(user) -> str:
    """El idioma de la petición (cookie o `Accept-Language`); si no es uno de los dos, el del perfil."""
    lang = (get_language() or "")[:2]
    if lang in LANGS:
        return lang
    lang = getattr(user.profile, "language", "es")
    return lang if lang in LANGS else "es"


def _t(value, lang: str) -> str:
    if isinstance(value, dict):
        return value.get(lang) or value.get("es") or ""
    return value or ""


def expand_sets(ex: dict) -> list[dict]:
    low, high = ex["reps"]
    warmups = [
        {"set_type": "warmup", "reps": WARMUP_REPS, "reps_max": None, "weight_kg": None, "rpe": None, "rir": None}
        for _ in range(ex.get("warmup", 0))
    ]
    working = [
        {
            "set_type": "normal",
            "reps": low,
            "reps_max": high if high != low else None,
            "weight_kg": None,
            "rpe": None,
            "rir": ex.get("rir"),
        }
        for _ in range(ex["sets"])
    ]
    return warmups + working


def routine_exercises(day: dict, lang: str) -> list[dict]:
    return [
        {
            "exercise_key": resolve_key(ex["exercise"]),
            "name": display_name(ex["exercise"], lang),
            "notes": _t(ex.get("notes", ""), lang),
            "rest_s": ex.get("rest_s"),
            "superset": ex.get("superset"),
            "sets": expand_sets(ex),
        }
        for ex in day["exercises"]
    ]


def program_summary(program: dict, lang: str) -> dict:
    return {
        "slug": program["slug"],
        "title": _t(program["title"], lang),
        "description": _t(program["description"], lang),
        "days_per_week": program["days_per_week"],
        "level": program["level"],
        "source": program["source"],
        "source_note": _t(program.get("source_note", ""), lang),
        "convention": program["source"] == CONVENTION,
        "rules": rule_refs(program.get("rules", []), lang),
        "routines": [
            {"key": d["key"], "title": _t(d["title"], lang), "exercise_count": len(d["exercises"])}
            for d in program["routines"]
        ],
    }


def program_detail(program: dict, lang: str) -> dict:
    data = program_summary(program, lang)
    data["routines"] = [
        {
            "key": d["key"],
            "title": _t(d["title"], lang),
            "notes": _t(d.get("notes", ""), lang),
            "exercises": routine_exercises(d, lang),
        }
        for d in program["routines"]
    ]
    return data


@transaction.atomic
def load(user, program: dict) -> tuple[RoutineFolder, list[Routine]]:
    """Copia el programa como rutinas del usuario en una carpeta nueva con su nombre."""
    profile = user.profile
    lang = lang_of(user)
    folder = services.folder_create(
        profile, _t(program["title"], lang)[:80], kind=RoutineFolder.Kind.PROGRAM, program_slug=program["slug"]
    )
    routines = [
        services.routine_create(
            profile,
            title=_t(day["title"], lang),
            notes=_t(day.get("notes", ""), lang),
            folder=folder,
            exercises=routine_exercises(day, lang),
            source=Routine.Source.PROGRAM,
            source_ref=f"{program['slug']}:{day['key']}",
        )
        for day in program["routines"]
    ]
    return folder, routines
