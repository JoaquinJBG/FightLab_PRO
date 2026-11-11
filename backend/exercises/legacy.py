"""Nombres antiguos de ejercicio -> clave del catálogo (contrato F17).

Hasta la F17 un ejercicio era un texto: el nombre en español de `LIBRARY` (`frontend/lib/gym.ts`)
o el que traía un CSV. `legacy_exercise_key` traduce ese texto a `cat:<slug>`:

1. los 30 nombres de `LIBRARY` (y los cortos del plan, como «Remo»), sin distinguir mayúsculas
   ni acentos;
2. si no, cualquier nombre o alias del catálogo en español o en inglés (incluidos los de Hevy,
   como «Bench Press (Barbell)»).

Devuelve None si no lo conoce: un nombre propio o importado se queda como texto.
"""
from __future__ import annotations

from functools import cache

from .catalog import catalog, entry_names, normalize


@cache
def _legacy_index() -> dict[str, str]:
    return {normalize(name): e["key"] for e in catalog() for name in e.get("legacy_names", [])}


@cache
def _name_index() -> dict[str, str]:
    index: dict[str, str] = {}
    for entry in catalog():
        for name in entry_names(entry):
            index.setdefault(normalize(name), entry["key"])
    return index


def legacy_exercise_key(nombre: str | None) -> str | None:
    if not nombre or not nombre.strip():
        return None
    norm = normalize(nombre)
    return _legacy_index().get(norm) or _name_index().get(norm)
