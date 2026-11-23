"""Alias de nombres de Hevy (y de apps parecidas) que no están en el catálogo fijado.

El catálogo (`data/exercise_catalog.json`, generado desde `tools/selection.py`) ya trae los alias
más comunes en español y en inglés. Aquí van los nombres en inglés que se ven al importar un CSV de
Hevy y que no lo traen: se emparejan con el ejercicio más parecido del catálogo, para que las
series, las rutinas y los récords salgan con el nombre en español y juntos. Solo se usan para
reconocer un nombre (`legacy_exercise_key`); no cambian lo que enseña el catálogo.

Clave del catálogo -> nombres. Las variantes con ayuda o lastre («Pull Up (Assisted)») se juntan
con el ejercicio base: el peso de la serie ya dice la diferencia.
"""
from __future__ import annotations

HEVY_ALIASES: dict[str, tuple[str, ...]] = {
    "cat:pull-up": ("Pull Up (Assisted)", "Pull Up (Weighted)", "Assisted Pull Up", "Weighted Pull Up"),
    "cat:chin-up": ("Chin Up (Assisted)", "Chin Up (Weighted)"),
    "cat:overhead-press": ("Overhead Press", "Standing Overhead Press (Barbell)", "Military Press (Barbell)"),
    "cat:dumbbell-shoulder-press": ("Overhead Press (Dumbbell)", "Standing Overhead Press (Dumbbell)"),
    "cat:rope-pushdown": ("Triceps Pushdown (Cable)", "Triceps Pushdown", "Triceps Rope Pushdown (Cable)"),
    "cat:standing-calf-raise": ("Standing Calf Raise (Smith Machine)", "Standing Calf Raise (Machine)", "Calf Raise (Machine)"),
    "cat:dips": ("Dip", "Dips", "Chest Dip (Assisted)", "Tricep Dip"),
    "cat:rear-delt-fly": ("Reverse Fly (Dumbbell)", "Rear Delt Reverse Fly (Dumbbell)", "Rear Delt Reverse Fly (Machine)"),
    "cat:seated-machine-row": ("Iso-Lateral Row (Machine)", "Iso Lateral Row (Machine)"),
    "cat:preacher-curl": ("Preacher Curl (Machine)", "Preacher Curl (Barbell)", "Preacher Curl (Dumbbell)"),
    "cat:barbell-row": ("Pendlay Row (Barbell)", "Barbell Bent Over Row"),
    "cat:cable-crossover": ("Cable Fly", "Cable Fly Crossover", "Cable Crossover (Cable)"),
    "cat:pec-deck": ("Pec Deck (Machine)", "Pec Deck Fly (Machine)", "Butterfly (Machine)"),
    "cat:barbell-back-squat": ("Squat", "Back Squat"),
    "cat:lat-pulldown": ("Lat Pulldown - Close Grip (Cable)", "Lat Pulldown (Machine)", "Wide Grip Lat Pulldown"),
    "cat:front-raise": ("Front Raise (Dumbbell)", "Front Raise (Plate)", "Dumbbell Front Raise"),
    "cat:leg-curl": ("Seated Leg Curl (Machine)", "Lying Leg Curl (Machine)"),
    "cat:biceps-curl": ("Bicep Curl (Dumbbell)", "Bicep Curl (Barbell)", "Biceps Curl (Dumbbell)"),
    "cat:triceps-extension": ("Triceps Extension (Cable)", "Triceps Extension (Dumbbell)"),
    "cat:skull-crusher": ("Skullcrusher (Barbell)", "Skullcrusher (Dumbbell)", "Lying Triceps Extension"),
}
