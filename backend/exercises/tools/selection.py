"""Selección curada a mano de la biblioteca de ejercicios (F17).

Es la fuente del catálogo: `snapshot.py` la combina con la copia fijada de wger y everkinetic y
escribe `exercises/data/exercise_catalog.json`. Cada entrada:

- `key`: slug estable en inglés (la clave pública es `cat:<key>`). No se cambia nunca: se guarda
  en las series (`SetLog.exercise_key`) y en las rutinas.
- `es` / `en`: nombre en cada idioma. `aliases_es` / `aliases_en`: otros nombres para la búsqueda
  (incluidos los de la exportación de Hevy, como «Bench Press (Barbell)»).
- `legacy`: los nombres que ya guardaba la app (`LIBRARY` de `frontend/lib/gym.ts` y el plan);
  `legacy_exercise_key` los traduce a la clave.
- `primary` / `secondary` / `equipment` / `category`: slugs de `exercises/vocab.py`.
- `wger`: id del ejercicio en wger (https://wger.de/api/v2/exerciseinfo/<id>/), o None.
- `everkinetic`: nombre del ejercicio en everkinetic/data (`dist/svg/<nombre>-1.svg` y `-2.svg`), o
  None. Si lo hay, se prefieren sus dos fotogramas de línea (un estilo uniforme); si no, las
  imágenes de wger con autor.
- `steps_es` / `steps_en`: pasos propios de FightLab (CC BY 4.0) cuando wger no tiene texto.
- `note`: notas del mapeo a mano (no se publican).
"""

# Los 30 de `LIBRARY` (frontend/lib/gym.ts), en su orden. El mapeo a wger y everkinetic se revisó
# a mano: ver las notas de cada uno.
LIBRARY_30: list[dict] = [
    {
        "key": "barbell-bench-press", "es": "Press banca", "en": "Bench press (barbell)",
        "aliases_es": ["press de banca", "press banca con barra", "press plano"],
        "aliases_en": ["Bench Press (Barbell)", "barbell bench press", "flat bench press", "bench press"],
        "legacy": ["Press banca"],
        "primary": ["chest"], "secondary": ["triceps", "front_delts"], "equipment": ["barbell", "bench"],
        "category": "strength",
    },
    {
        "key": "incline-barbell-bench-press", "es": "Press inclinado", "en": "Incline bench press (barbell)",
        "aliases_es": ["press banca inclinado", "press inclinado con barra"],
        "aliases_en": ["Incline Bench Press (Barbell)", "incline bench press"],
        "legacy": ["Press inclinado"],
        "primary": ["chest"], "secondary": ["front_delts", "triceps"], "equipment": ["barbell", "bench"],
        "category": "strength",
    },
    {
        "key": "dumbbell-bench-press", "es": "Press con mancuernas", "en": "Dumbbell bench press",
        "aliases_es": ["press banca con mancuernas", "press plano con mancuernas"],
        "aliases_en": ["Bench Press (Dumbbell)", "dumbbell press"],
        "legacy": ["Press con mancuernas"],
        "primary": ["chest"], "secondary": ["triceps", "front_delts"], "equipment": ["dumbbell", "bench"],
        "category": "strength",
    },
    {
        "key": "dumbbell-fly", "es": "Aperturas", "en": "Dumbbell fly",
        "aliases_es": ["aperturas con mancuernas", "aperturas de pecho"],
        "aliases_en": ["Chest Fly (Dumbbell)", "dumbbell flyes", "chest fly"],
        "legacy": ["Aperturas"],
        "primary": ["chest"], "secondary": ["front_delts"], "equipment": ["dumbbell", "bench"],
        "category": "strength",
    },
    {
        "key": "dips", "es": "Fondos", "en": "Dips",
        "aliases_es": ["fondos en paralelas", "fondos de pecho"],
        "aliases_en": ["Chest Dip", "Triceps Dip", "parallel bar dips"],
        "legacy": ["Fondos"],
        "primary": ["chest", "triceps"], "secondary": ["front_delts"], "equipment": ["bodyweight"],
        "category": "strength",
    },
    {
        "key": "pull-up", "es": "Dominadas", "en": "Pull-up",
        "aliases_es": ["dominadas pronas"],
        "aliases_en": ["Pull Up", "pullups", "pull ups"],
        "legacy": ["Dominadas"],
        "primary": ["lats"], "secondary": ["biceps", "upper_back", "rear_delts"],
        "equipment": ["pull_up_bar", "bodyweight"],
        "category": "strength",
    },
    {
        "key": "lat-pulldown", "es": "Jalón al pecho", "en": "Lat pulldown",
        "aliases_es": ["jalón dorsal", "jalón en polea alta"],
        "aliases_en": ["Lat Pulldown (Cable)", "lat pull down"],
        "legacy": ["Jalón al pecho"],
        "primary": ["lats"], "secondary": ["biceps", "upper_back"], "equipment": ["cable", "machine"],
        "category": "strength",
    },
    {
        "key": "barbell-row", "es": "Remo con barra", "en": "Bent-over row (barbell)",
        "aliases_es": ["remo inclinado con barra", "remo con barra inclinado"],
        "aliases_en": ["Bent Over Row (Barbell)", "barbell row", "bent over row"],
        "legacy": ["Remo con barra", "Remo"],
        "primary": ["upper_back", "lats"], "secondary": ["biceps", "rear_delts", "lower_back"],
        "equipment": ["barbell"],
        "category": "strength",
    },
    {
        "key": "seated-machine-row", "es": "Remo en máquina", "en": "Seated row (machine)",
        "aliases_es": ["remo sentado en máquina", "remo sentado"],
        "aliases_en": ["Seated Row (Machine)", "machine row"],
        "legacy": ["Remo en máquina"],
        "primary": ["upper_back", "lats"], "secondary": ["biceps", "rear_delts"], "equipment": ["machine"],
        "category": "strength",
    },
    {
        "key": "deadlift", "es": "Peso muerto", "en": "Deadlift (barbell)",
        "aliases_es": ["peso muerto convencional", "peso muerto con barra"],
        "aliases_en": ["Deadlift (Barbell)", "conventional deadlift", "deadlift"],
        "legacy": ["Peso muerto"],
        "primary": ["glutes", "hamstrings", "lower_back"], "secondary": ["quads", "traps", "forearms"],
        "equipment": ["barbell"],
        "category": "strength",
    },
    {
        "key": "face-pull", "es": "Face pull", "en": "Face pull",
        "aliases_es": ["face pull en polea", "jalón a la cara"],
        "aliases_en": ["Face Pull (Cable)"],
        "legacy": ["Face pull"],
        "primary": ["rear_delts"], "secondary": ["traps", "upper_back"], "equipment": ["cable", "band"],
        "category": "strength",
    },
    {
        "key": "barbell-back-squat", "es": "Sentadilla", "en": "Squat (barbell)",
        "aliases_es": ["sentadilla con barra", "sentadilla trasera"],
        "aliases_en": ["Squat (Barbell)", "back squat", "barbell squat"],
        "legacy": ["Sentadilla"],
        "primary": ["quads", "glutes"], "secondary": ["adductors", "hamstrings", "lower_back"],
        "equipment": ["barbell"],
        "category": "strength",
    },
    {
        "key": "leg-press", "es": "Prensa", "en": "Leg press",
        "aliases_es": ["prensa de piernas", "prensa inclinada"],
        "aliases_en": ["Leg Press (Machine)"],
        "legacy": ["Prensa"],
        "primary": ["quads", "glutes"], "secondary": ["hamstrings", "adductors"], "equipment": ["machine"],
        "category": "strength",
    },
    {
        "key": "romanian-deadlift", "es": "Peso muerto rumano", "en": "Romanian deadlift",
        "aliases_es": ["rumano"],
        "aliases_en": ["Romanian Deadlift (Barbell)", "Romanian Deadlift (Dumbbell)", "RDL"],
        "legacy": ["Peso muerto rumano"],
        "primary": ["hamstrings", "glutes"], "secondary": ["lower_back"], "equipment": ["barbell", "dumbbell"],
        "category": "strength",
    },
    {
        "key": "lunge", "es": "Zancadas", "en": "Lunge",
        "aliases_es": ["zancada", "zancadas con mancuernas"],
        "aliases_en": ["Lunge (Dumbbell)", "Walking Lunge", "lunges"],
        "legacy": ["Zancadas"],
        "primary": ["quads", "glutes"], "secondary": ["hamstrings", "adductors"],
        "equipment": ["dumbbell", "bodyweight"],
        "category": "strength",
    },
    {
        "key": "leg-extension", "es": "Extensión de cuádriceps", "en": "Leg extension",
        "aliases_es": ["extensiones de cuádriceps", "extensión de piernas"],
        "aliases_en": ["Leg Extension (Machine)"],
        "legacy": ["Extensión de cuádriceps"],
        "primary": ["quads"], "secondary": [], "equipment": ["machine"],
        "category": "strength",
    },
    {
        "key": "leg-curl", "es": "Curl femoral", "en": "Leg curl",
        "aliases_es": ["curl femoral tumbado", "curl femoral sentado", "curl de isquios"],
        "aliases_en": ["Lying Leg Curl (Machine)", "Seated Leg Curl (Machine)", "hamstring curl"],
        "legacy": ["Curl femoral"],
        "primary": ["hamstrings"], "secondary": ["calves"], "equipment": ["machine"],
        "category": "strength",
    },
    {
        "key": "standing-calf-raise", "es": "Gemelos", "en": "Calf raise",
        "aliases_es": ["elevación de talones", "gemelos de pie", "elevaciones de gemelos"],
        "aliases_en": ["Standing Calf Raise", "Calf Raise (Machine)", "calf raises"],
        "legacy": ["Gemelos"],
        "primary": ["calves"], "secondary": [], "equipment": ["machine", "bodyweight"],
        "category": "strength",
    },
    {
        "key": "overhead-press", "es": "Press militar", "en": "Overhead press (barbell)",
        "aliases_es": ["press de hombro con barra", "press militar de pie"],
        "aliases_en": ["Overhead Press (Barbell)", "military press", "OHP", "shoulder press"],
        "legacy": ["Press militar"],
        "primary": ["front_delts"], "secondary": ["triceps", "side_delts", "traps"], "equipment": ["barbell"],
        "category": "strength",
    },
    {
        "key": "dumbbell-lateral-raise", "es": "Elevaciones laterales", "en": "Lateral raise",
        "aliases_es": ["elevaciones laterales con mancuernas", "laterales"],
        "aliases_en": ["Lateral Raise (Dumbbell)", "side raise"],
        "legacy": ["Elevaciones laterales"],
        "primary": ["side_delts"], "secondary": ["traps"], "equipment": ["dumbbell"],
        "category": "strength",
    },
    {
        "key": "rear-delt-fly", "es": "Pájaros", "en": "Rear delt fly",
        "aliases_es": ["pájaros con mancuernas", "aperturas inversas", "vuelos posteriores"],
        "aliases_en": ["Rear Delt Reverse Fly (Dumbbell)", "reverse fly", "bent over lateral raise"],
        "legacy": ["Pájaros"],
        "primary": ["rear_delts"], "secondary": ["upper_back", "traps"], "equipment": ["dumbbell"],
        "category": "strength",
    },
    {
        "key": "arnold-press", "es": "Press Arnold", "en": "Arnold press",
        "aliases_es": ["press arnold con mancuernas"],
        "aliases_en": ["Arnold Press (Dumbbell)"],
        "legacy": ["Press Arnold"],
        "primary": ["front_delts"], "secondary": ["side_delts", "triceps"], "equipment": ["dumbbell"],
        "category": "strength",
    },
    {
        "key": "biceps-curl", "es": "Curl bíceps", "en": "Biceps curl",
        "aliases_es": ["curl de bíceps", "curl con mancuernas", "curl con barra"],
        "aliases_en": ["Bicep Curl (Dumbbell)", "Bicep Curl (Barbell)", "bicep curl", "dumbbell curl"],
        "legacy": ["Curl bíceps"],
        "primary": ["biceps"], "secondary": ["forearms"], "equipment": ["dumbbell", "barbell"],
        "category": "strength",
    },
    {
        "key": "hammer-curl", "es": "Curl martillo", "en": "Hammer curl",
        "aliases_es": ["curl de martillo"],
        "aliases_en": ["Hammer Curl (Dumbbell)"],
        "legacy": ["Curl martillo"],
        "primary": ["biceps"], "secondary": ["forearms"], "equipment": ["dumbbell"],
        "category": "strength",
    },
    {
        "key": "triceps-extension", "es": "Extensión de tríceps", "en": "Triceps extension",
        "aliases_es": ["extensiones de tríceps", "jalón de tríceps", "tríceps en polea"],
        "aliases_en": ["Triceps Extension (Cable)", "Triceps Pushdown", "triceps pushdown", "overhead triceps extension"],
        "legacy": ["Extensión de tríceps", "Extensión tríceps"],
        "primary": ["triceps"], "secondary": [], "equipment": ["cable", "dumbbell"],
        "category": "strength",
    },
    {
        "key": "skull-crusher", "es": "Press francés", "en": "Skull crusher",
        "aliases_es": ["press francés con barra z", "rompecráneos"],
        "aliases_en": ["Skullcrusher (Barbell)", "Skullcrusher (EZ Bar)", "lying triceps extension"],
        "legacy": ["Press francés"],
        "primary": ["triceps"], "secondary": [], "equipment": ["ez_bar", "barbell", "bench"],
        "category": "strength",
    },
    {
        "key": "plank", "es": "Plancha", "en": "Plank",
        "aliases_es": ["plancha abdominal", "plancha frontal"],
        "aliases_en": ["front plank"],
        "legacy": ["Plancha"],
        "primary": ["abs"], "secondary": ["obliques", "lower_back"], "equipment": ["bodyweight", "mat"],
        "category": "strength",
    },
    {
        "key": "cable-crunch", "es": "Crunch en polea", "en": "Cable crunch",
        "aliases_es": ["crunch en polea alta", "encogimientos en polea"],
        "aliases_en": ["Cable Crunch", "kneeling cable crunch"],
        "legacy": ["Crunch en polea"],
        "primary": ["abs"], "secondary": ["obliques"], "equipment": ["cable"],
        "category": "strength",
    },
    {
        "key": "ab-wheel-rollout", "es": "Rueda abdominal", "en": "Ab wheel rollout",
        "aliases_es": ["rueda de abdominales", "rodillo abdominal"],
        "aliases_en": ["Ab Wheel", "ab rollout"],
        "legacy": ["Rueda abdominal"],
        "primary": ["abs"], "secondary": ["lats", "lower_back"], "equipment": ["other"],
        "category": "strength",
    },
    {
        "key": "leg-raise", "es": "Elevaciones de piernas", "en": "Leg raise",
        "aliases_es": ["elevación de piernas", "elevaciones de piernas colgado", "elevaciones de piernas tumbado"],
        "aliases_en": ["Hanging Leg Raise", "Lying Leg Raise", "leg raises"],
        "legacy": ["Elevaciones de piernas"],
        "primary": ["abs"], "secondary": ["hip_flexors"], "equipment": ["bodyweight", "pull_up_bar"],
        "category": "strength",
    },
]

SELECTION: list[dict] = [*LIBRARY_30]
