"""`legacy_exercise_key`: los nombres que ya guardaba la app -> clave del catálogo (contrato F17)."""
import re
from pathlib import Path

import pytest

from exercises.catalog import catalog_by_key
from exercises.legacy import legacy_exercise_key

GYM_TS = Path(__file__).resolve().parents[3] / "frontend" / "lib" / "gym.ts"


def library_names() -> list[str]:
    """Los nombres de `LIBRARY` leídos del propio `frontend/lib/gym.ts`: si alguien añade uno allí
    sin clave, este test lo dice."""
    src = GYM_TS.read_text(encoding="utf-8")
    block = src[src.index("export const LIBRARY"):]
    block = block[: block.index("];")]
    names = []
    for items in re.findall(r"items: \[([^\]]*)\]", block):
        names.extend(re.findall(r'"([^"]+)"', items))
    return names


def test_library_has_30_names():
    assert len(library_names()) == 30


@pytest.mark.parametrize("name", library_names())
def test_every_library_name_has_a_catalog_key(name):
    key = legacy_exercise_key(name)
    assert key is not None, name
    assert key.startswith("cat:")
    assert key in catalog_by_key()


def test_library_keys_are_distinct():
    keys = [legacy_exercise_key(n) for n in library_names()]
    assert len(set(keys)) == len(keys)


def test_known_mappings():
    assert legacy_exercise_key("Press banca") == "cat:barbell-bench-press"
    assert legacy_exercise_key("Sentadilla") == "cat:barbell-back-squat"
    assert legacy_exercise_key("Jalón al pecho") == "cat:lat-pulldown"
    # Nombres cortos del plan y de ejemplos antiguos
    assert legacy_exercise_key("Remo") == "cat:barbell-row"
    assert legacy_exercise_key("Extensión tríceps") == "cat:triceps-extension"


def test_case_and_accents_do_not_matter():
    assert legacy_exercise_key("  JALON AL PECHO ") == "cat:lat-pulldown"
    assert legacy_exercise_key("curl biceps") == "cat:biceps-curl"


def test_english_and_hevy_names():
    assert legacy_exercise_key("Bench Press (Barbell)") == "cat:barbell-bench-press"
    assert legacy_exercise_key("Lat Pulldown (Cable)") == "cat:lat-pulldown"
    assert legacy_exercise_key("Deadlift") == "cat:deadlift"


@pytest.mark.parametrize("name", [None, "", "   ", "Mi ejercicio raro", "Bench Press (Smith Machine) XYZ"])
def test_unknown_names_return_none(name):
    assert legacy_exercise_key(name) is None


@pytest.mark.parametrize("name,key", [
    ("Pull Up", "cat:pull-up"),
    ("Pull Up (Assisted)", "cat:pull-up"),
    ("Overhead Press (Barbell)", "cat:overhead-press"),
    ("Overhead Press", "cat:overhead-press"),
    ("Overhead Press (Dumbbell)", "cat:dumbbell-shoulder-press"),
    ("Dip", "cat:dips"),
    ("Reverse Fly (Dumbbell)", "cat:rear-delt-fly"),
    ("Pec Deck (Machine)", "cat:pec-deck"),
    ("Squat", "cat:barbell-back-squat"),
    ("Iso-Lateral Row (Machine)", "cat:seated-machine-row"),
    ("Pendlay Row (Barbell)", "cat:barbell-row"),
])
def test_extra_hevy_aliases(name, key):
    assert legacy_exercise_key(name) == key
