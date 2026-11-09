"""Claves de ejercicio para rutinas generadas (programas y plan por reglas).

La clave sale de `exercises.legacy.legacy_exercise_key` (app de la rama E) cuando está; si no
(o si no conoce el nombre), de esta tabla con los 30 nombres de `LIBRARY` del frontend
(`frontend/lib/gym.ts`). Un nombre que no está en ninguna (un nombre libre importado de Hevy)
se queda sin clave (`None`): la rutina guarda el nombre y H lo registra como hasta ahora.
"""

# Nombre de `LIBRARY` → (clave del contrato de F17, nombre en inglés).
LIBRARY_KEYS: dict[str, tuple[str, str]] = {
    "Press banca": ("cat:barbell-bench-press", "Barbell bench press"),
    "Press inclinado": ("cat:incline-bench-press", "Incline bench press"),
    "Press con mancuernas": ("cat:dumbbell-bench-press", "Dumbbell bench press"),
    "Aperturas": ("cat:dumbbell-fly", "Dumbbell fly"),
    "Fondos": ("cat:dip", "Dips"),
    "Dominadas": ("cat:pull-up", "Pull-up"),
    "Jalón al pecho": ("cat:lat-pulldown", "Lat pulldown"),
    "Remo con barra": ("cat:barbell-row", "Barbell row"),
    "Remo en máquina": ("cat:machine-row", "Machine row"),
    "Peso muerto": ("cat:deadlift", "Deadlift"),
    "Face pull": ("cat:face-pull", "Face pull"),
    "Sentadilla": ("cat:barbell-squat", "Barbell squat"),
    "Prensa": ("cat:leg-press", "Leg press"),
    "Peso muerto rumano": ("cat:romanian-deadlift", "Romanian deadlift"),
    "Zancadas": ("cat:lunge", "Lunges"),
    "Extensión de cuádriceps": ("cat:leg-extension", "Leg extension"),
    "Curl femoral": ("cat:leg-curl", "Leg curl"),
    "Gemelos": ("cat:calf-raise", "Calf raises"),
    "Press militar": ("cat:overhead-press", "Overhead press"),
    "Elevaciones laterales": ("cat:lateral-raise", "Lateral raises"),
    "Pájaros": ("cat:rear-delt-fly", "Rear delt fly"),
    "Press Arnold": ("cat:arnold-press", "Arnold press"),
    "Curl bíceps": ("cat:biceps-curl", "Biceps curl"),
    "Curl martillo": ("cat:hammer-curl", "Hammer curl"),
    "Extensión de tríceps": ("cat:triceps-extension", "Triceps extension"),
    "Press francés": ("cat:skull-crusher", "Skull crusher"),
    "Plancha": ("cat:plank", "Plank"),
    "Crunch en polea": ("cat:cable-crunch", "Cable crunch"),
    "Rueda abdominal": ("cat:ab-wheel-rollout", "Ab wheel rollout"),
    "Elevaciones de piernas": ("cat:leg-raise", "Leg raises"),
}


def _legacy(name: str) -> str | None:
    try:
        from exercises.legacy import legacy_exercise_key
    except ImportError:  # la app de la rama E aún no está en esta rama
        return None
    return legacy_exercise_key(name)


def resolve_key(name: str) -> str | None:
    key = _legacy(name)
    if key:
        return key
    entry = LIBRARY_KEYS.get(name)
    return entry[0] if entry else None


def display_name(name: str, lang: str) -> str:
    """El nombre guardado en la rutina: el de `LIBRARY` en español o su traducción."""
    entry = LIBRARY_KEYS.get(name)
    if entry and lang == "en":
        return entry[1]
    return name
