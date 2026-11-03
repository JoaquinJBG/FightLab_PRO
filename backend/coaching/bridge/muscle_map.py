"""El mapa de músculos del coach con los nombres del gimnasio de FightLab (Task 6.2, U12).

El gimnasio de la app guarda los ejercicios por su nombre en español (`frontend/lib/gym.ts`,
`LIBRARY`). La mayoría ya son alias de `coach/muscle_map.yaml`; aquí se añaden solo los que son
el mismo ejercicio con otro nombre. Los créditos por músculo siguen siendo los del coach: no se
añade ningún ejercicio nuevo ni ningún crédito. Lo que no tiene equivalente (fondos, pájaros,
plancha y el resto del core) queda sin mapear y la API lo avisa, como hace el coach.
"""
import copy
from functools import cache

from coach import strength

# Nombre de la biblioteca de FightLab -> clave del mapa del coach.
FIGHTLAB_ALIASES: dict[str, str] = {
    "Curl bíceps": "bicep curl",
    "Extensión de tríceps": "triceps extension",
    "Press francés": "skullcrusher",
    "Gemelos": "calf raise",
    # Mancuernas y máquina: el coach ya trata "Bench Press (Dumbbell)" como el press de banca
    # (ignora el equipo entre paréntesis), y todos sus remos acreditan lo mismo.
    "Press con mancuernas": "bench press",
    "Remo en máquina": "seated cable row",
    "Press Arnold": "shoulder press",
}


@cache
def muscle_map() -> dict[str, dict]:
    """`coach.strength.load_muscle_map()` con los alias de FightLab añadidos."""
    mapped = copy.deepcopy(strength.load_muscle_map())
    for alias, key in FIGHTLAB_ALIASES.items():
        entry = mapped[key]
        entry["aliases"] = [*entry.get("aliases", []), alias.lower()]
    return mapped
