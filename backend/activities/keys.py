"""Claves de ejercicio del contrato de F17 (`cat:<slug>` y `custom:<id>`)."""
from __future__ import annotations

CUSTOM_PREFIX = "custom:"


def custom_key_owned(profile, key: str | None) -> bool:
    """Un `custom:<id>` solo vale si ese ejercicio propio es de `profile` (nadie guarda series ni
    rutinas con el ejercicio de otro usuario). Las claves del catálogo y la ausencia de clave
    siempre valen; sin la app `exercises` (rama E) no se puede comprobar y se deja pasar."""
    if not key or not key.startswith(CUSTOM_PREFIX) or profile is None:
        return True
    try:
        from exercises.models import CustomExercise
    except ImportError:
        return True
    raw = key[len(CUSTOM_PREFIX):]
    return raw.isdigit() and CustomExercise.objects.filter(pk=int(raw), profile=profile).exists()
