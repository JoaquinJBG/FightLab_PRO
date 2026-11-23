"""Vocabulario cerrado de músculos, material y categorías (F17).

Los slugs son estables y en inglés: los usan el catálogo, los ejercicios propios del usuario y el
frontend (`frontend/lib/exercises.ts`, que los traduce con `messages/*.json`). Los deltoides van
separados en anterior, lateral y posterior, como en el mapa de músculos del coach.
"""

MUSCLES: tuple[str, ...] = (
    "chest",
    "lats",
    "upper_back",
    "traps",
    "lower_back",
    "front_delts",
    "side_delts",
    "rear_delts",
    "biceps",
    "triceps",
    "forearms",
    "abs",
    "obliques",
    "quads",
    "hamstrings",
    "glutes",
    "adductors",
    "abductors",
    "calves",
    "neck",
    "hip_flexors",
    "full_body",
    "cardio",
)

EQUIPMENT: tuple[str, ...] = (
    "barbell",
    "dumbbell",
    "kettlebell",
    "machine",
    "cable",
    "smith_machine",
    "ez_bar",
    "bench",
    "pull_up_bar",
    "band",
    "plate",
    "medicine_ball",
    "suspension",
    "heavy_bag",
    "jump_rope",
    "mat",
    "bodyweight",
    "other",
)

# strength: fuerza/hipertrofia; mobility: estiramientos y movilidad; combat: golpeo y trabajo
# específico de MMA; cardio: condición física.
CATEGORIES: tuple[str, ...] = ("strength", "mobility", "combat", "cardio")
