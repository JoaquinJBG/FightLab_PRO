"""Claves y nombres de ejercicio para las rutinas generadas (programas y plan por reglas).

La clave sale de `exercises.legacy.legacy_exercise_key` (app de la rama E): los 30 nombres de
`LIBRARY` y cualquier nombre o alias del catálogo. Un nombre que no conoce (un nombre libre
importado de Hevy) se queda sin clave (`None`): la rutina guarda el nombre y H lo registra como
hasta ahora.
"""
from exercises.catalog import catalog_by_key
from exercises.legacy import legacy_exercise_key


def resolve_key(name: str) -> str | None:
    return legacy_exercise_key(name)


def display_name(name: str, lang: str) -> str:
    """El nombre que se guarda en la rutina: el del catálogo en `lang` si lo conoce; si no, el
    mismo texto que trae el plan o el programa."""
    key = legacy_exercise_key(name)
    entry = catalog_by_key().get(key) if key else None
    if entry:
        return entry["names"].get(lang) or entry["names"].get("es") or name
    return name
