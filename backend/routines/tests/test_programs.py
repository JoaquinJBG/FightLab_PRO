"""Programas clásicos como datos (F17 R, punto 4): fuente o «FightLab convention», reglas que
existen, ejercicios con clave y carga como rutinas del usuario en una carpeta."""
import re
from pathlib import Path

import pytest

from coaching.keys import rule_key
from routines import programs
from routines.catalog import LIBRARY_KEYS
from routines.models import Routine, RoutineFolder
from routines.serializers import EXERCISE_KEY_RE

from .helpers import PROGRAMS, ROUTINES, make_client

KNOWLEDGE = Path(__file__).resolve().parents[2] / "vendor" / "ai-personal-coach" / "knowledge"
GYM_LIBRARY = Path(__file__).resolve().parents[3] / "frontend" / "lib" / "gym.ts"


def knowledge_keys() -> set[str]:
    keys = set()
    for md in KNOWLEDGE.glob("*.md"):
        for line in md.read_text(encoding="utf-8").splitlines():
            if line.startswith("### "):
                keys.add(rule_key(md.name, line[4:].strip()))
    return keys


def test_the_four_classic_programs_are_there():
    slugs = {p["slug"] for p in programs.all_programs()}
    assert {"full-body-3", "upper-lower-4", "ppl-6", "ppl-3"} <= slugs
    days = {p["slug"]: p["days_per_week"] for p in programs.all_programs()}
    assert days == {"full-body-3": 3, "upper-lower-4": 4, "ppl-6": 6, "ppl-3": 3}
    for p in programs.all_programs():
        assert len(p["routines"]) == p["days_per_week"]


@pytest.mark.parametrize("program", programs.all_programs(), ids=lambda p: p["slug"])
def test_program_data_is_sound(program):
    assert program["source"]  # una fuente o la etiqueta de convención, nunca vacío
    assert program["source"] == programs.CONVENTION or program["source"].startswith("http")
    for lang in programs.LANGS:
        assert program["title"][lang] and program["description"][lang]
    existing = knowledge_keys()
    assert program["rules"] and set(program["rules"]) <= existing, set(program["rules"]) - existing
    for day in program["routines"]:
        assert day["title"]["es"] and day["title"]["en"]
        groups = [ex["superset"] for ex in day["exercises"] if ex["superset"] is not None]
        assert all(groups.count(g) >= 2 for g in groups)  # una superserie son 2 o más
        for ex in day["exercises"]:
            assert ex["exercise"] in LIBRARY_KEYS, ex["exercise"]
            low, high = ex["reps"]
            assert 1 <= low <= high <= 30
            assert 1 <= ex["sets"] <= 5 and 0 <= ex["warmup"] <= 3
            assert 30 <= ex["rest_s"] <= 300
            assert ex["rir"] is None or 0 <= ex["rir"] <= 4


def test_library_keys_follow_the_contract_and_cover_gym_ts():
    for key, _ in LIBRARY_KEYS.values():
        assert EXERCISE_KEY_RE.match(key) and key.startswith("cat:")
    assert len({k for k, _ in LIBRARY_KEYS.values()}) == len(LIBRARY_KEYS)
    # Los 30 nombres de LIBRARY del frontend, ni uno más ni uno menos.
    source = GYM_LIBRARY.read_text(encoding="utf-8")
    block = source.split("export const LIBRARY", 1)[1].split("];", 1)[0]
    names = set(re.findall(r'"([^"]+)"', block)) - {"group", "items"}
    groups = set(re.findall(r'group: "([^"]+)"', block))
    assert names - groups == set(LIBRARY_KEYS)


@pytest.mark.django_db
def test_list_and_detail():
    _, client = make_client()
    data = client.get(PROGRAMS, HTTP_ACCEPT_LANGUAGE="en").data
    assert [p["slug"] for p in data][:4] == ["full-body-3", "upper-lower-4", "ppl-6", "ppl-3"]
    first = data[0]
    assert first["title"] == "Full body, 3 days"
    assert first["convention"] is True
    assert {r["key"] for r in first["rules"]} >= {"strength-hypertrophy/full-body-versus-split"}
    detail = client.get(f"{PROGRAMS}/upper-lower-4", HTTP_ACCEPT_LANGUAGE="es").data
    assert detail["routines"][0]["title"] == "Torso A"
    ex = detail["routines"][0]["exercises"][0]
    assert ex["exercise_key"] == "cat:barbell-bench-press" and ex["name"] == "Press banca"
    assert [s["set_type"] for s in ex["sets"]] == ["warmup", "warmup", "normal", "normal", "normal", "normal"]
    assert ex["sets"][2] == {"set_type": "normal", "reps": 6, "reps_max": 8, "weight_kg": None, "rpe": None, "rir": 2}
    assert client.get(f"{PROGRAMS}/nope").status_code == 404


@pytest.mark.django_db
def test_load_copies_program_as_user_routines_in_a_folder():
    user, client = make_client()
    resp = client.post(f"{PROGRAMS}/ppl-6/load", HTTP_ACCEPT_LANGUAGE="es")
    assert resp.status_code == 201
    folder = RoutineFolder.objects.get(pk=resp.data["folder"]["id"])
    assert folder.kind == "program" and folder.program_slug == "ppl-6"
    assert folder.name == "Empuje-tirón-pierna, 6 días"
    routines = list(Routine.objects.filter(folder=folder).order_by("order"))
    assert [r.title for r in routines] == ["Empuje A", "Tirón A", "Pierna A", "Empuje B", "Tirón B", "Pierna B"]
    assert all(r.source == "program" for r in routines)
    # Son del usuario: se editan sin tocar el programa.
    rid = routines[0].id
    client.patch(f"{ROUTINES}/{rid}", {"title": "Mi empuje"}, format="json")
    assert client.get(f"{PROGRAMS}/ppl-6").data["routines"][0]["title"] == "Empuje A"
    # Cargarlo otra vez crea otra carpeta (como copiar una plantilla en Hevy).
    client.post(f"{PROGRAMS}/ppl-6/load")
    assert RoutineFolder.objects.filter(profile=user.profile, program_slug="ppl-6").count() == 2


@pytest.mark.django_db
def test_loaded_superset_survives():
    _, client = make_client()
    data = client.post(f"{PROGRAMS}/full-body-3/load").data
    b = data["routines"][1]
    assert [e["superset"] for e in b["exercises"]][-2:] == [0, 0]


@pytest.mark.django_db
def test_english_names_when_loading_in_english():
    _, client = make_client()
    data = client.post(f"{PROGRAMS}/ppl-3/load", HTTP_ACCEPT_LANGUAGE="en").data
    assert data["folder"]["name"] == "Push/pull/legs, 3 days"
    assert data["routines"][0]["exercises"][0]["name"] == "Barbell bench press"
