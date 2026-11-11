"""Fase 14, vía B de punta a punta: el script de la skill (`tools/claude-skill/fightlab-menu`)
contra un Django de verdad (`live_server`), con un token personal. Lo que haría Claude Code en el
PC del usuario: descargar el contexto, comprobar el menú (sin guardar) y subirlo. Sin ninguna IA:
el menú lo escribe la prueba. Datos inventados."""
import importlib.util
import json
from datetime import timedelta
from pathlib import Path

import pytest

from coaching.models import MealPlan

from .helpers import TODAY, client_for, fix_today, make_user
from .menu_fixtures import schema1

SCRIPT = Path(__file__).resolve().parents[3] / "tools" / "claude-skill" / "fightlab-menu" / "fightlab_menu.py"


def load_script():
    spec = importlib.util.spec_from_file_location("fightlab_menu", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def skill():
    return load_script()


def test_skill_files_exist_and_need_nothing_paid():
    text = SCRIPT.read_text(encoding="utf-8")
    assert (SCRIPT.parent / "SKILL.md").read_text(encoding="utf-8").startswith("---\nname: fightlab-menu\n")
    for banned in ("anthropic", "openai", "requests", "flm_" + "a"):
        assert f"import {banned}" not in text
    imports = {line.split()[1].split(".")[0] for line in text.splitlines() if line.startswith(("import ", "from "))}
    assert imports <= {"__future__", "argparse", "json", "os", "sys", "unicodedata", "urllib", "datetime", "pathlib"}


def test_local_check_names_the_problems(skill):
    menu = schema1(days=1)
    assert skill.local_problems(menu, {"copos de avena"}) == [
        "dishes.D1: unknown food 'yogur griego desnatado' (use a name from \"foods\")",
        "dishes.L1: unknown food 'lentejas, cocidas' (use a name from \"foods\")",
        "dishes.L1: unknown food 'pechuga de pollo, cruda' (use a name from \"foods\")",
        "dishes.L1: unknown food 'zanahoria' (use a name from \"foods\")",
        "dishes.C1: unknown food 'merluza, cruda' (use a name from \"foods\")",
        "dishes.C1: unknown food 'patata, cruda' (use a name from \"foods\")",
    ]
    assert skill.fold("Plátano  ") == skill.fold("platano")
    broken = {"schema": 2, "days": [{"date": "2026-11-02", "meals": [{"meal": "Comida", "dish_id": "X"}]}], "dishes": {}}
    assert skill.local_problems(broken) == ['"schema" must be 1', '2026-11-02: Comida: dish_id \'X\' is not in "dishes"']


def test_config_is_never_guessed(skill, monkeypatch, tmp_path):
    monkeypatch.setattr(skill, "CONFIG_DIR", tmp_path)
    monkeypatch.delenv("FIGHTLAB_URL", raising=False)
    monkeypatch.delenv("FIGHTLAB_TOKEN", raising=False)
    monkeypatch.delenv("FIGHTLAB_TOKEN_FILE", raising=False)
    with pytest.raises(skill.Problem):
        skill.base_url()
    with pytest.raises(skill.Problem):
        skill.token()
    monkeypatch.setenv("FIGHTLAB_URL", "http://example.org/api/ext")
    with pytest.raises(skill.Problem, match="https"):
        skill.base_url()
    (tmp_path / "token").write_text("﻿flm_from_a_file_with_bom\n", encoding="utf-8")
    assert skill.token() == "flm_from_a_file_with_bom"


@pytest.mark.django_db(transaction=True)
def test_skill_downloads_checks_and_uploads_with_the_token(skill, live_server, monkeypatch, tmp_path, capsys):
    with fix_today():
        user = make_user()
        raw = client_for(user).post("/api/v1/coach/menu-tokens", {"name": "PC"}, format="json").json()["token"]
        monkeypatch.setenv("FIGHTLAB_URL", "http://127.0.0.1:" + live_server.url.rsplit(":", 1)[1] + "/api/v1")
        monkeypatch.setenv("FIGHTLAB_TOKEN", raw)
        start = TODAY + timedelta(days=3)
        ctx_file = tmp_path / "fightlab-context.json"

        assert skill.main(["context", "--start", start.isoformat(), "--days", "2", "--meals", "breakfast,lunch,dinner",
                           "--tupper", "lunch", "--out", str(ctx_file)]) == 0
        ctx = json.loads(ctx_file.read_text(encoding="utf-8"))
        assert ctx["request"]["id"] == f"ia-{start.isoformat()}" and ctx["instructions"]

        menu = schema1(menu_id=ctx["request"]["id"], start=start, days=2)
        menu["dishes"]["D1"]["ingredients"].append({"food": "harina de grillo", "grams": 10})
        menu_file = tmp_path / "fightlab-menu.json"
        menu_file.write_text(json.dumps(menu, ensure_ascii=False), encoding="utf-8")
        assert skill.main(["check", str(menu_file), "--context", str(ctx_file)]) == 1
        assert "unknown food 'harina de grillo'" in capsys.readouterr().out

        menu["dishes"]["D1"]["ingredients"].pop()
        menu_file.write_text(json.dumps(menu, ensure_ascii=False), encoding="utf-8")
        code = skill.main(["check", str(menu_file), "--context", str(ctx_file)])
        out = capsys.readouterr().out
        assert f"{start.isoformat()}: " in out and code in (0, 1)
        assert not MealPlan.objects.filter(profile=user.profile).exists()  # comprobar no guarda

        assert skill.main(["upload", str(menu_file)]) == 0
        assert "Saved in FightLab" in capsys.readouterr().out
        plan = MealPlan.objects.get(profile=user.profile)
        assert plan.source == MealPlan.Source.USER_AI and plan.menu_id == f"ia-{start.isoformat()}"
        assert skill.main(["upload", str(menu_file)]) == 0
        assert "Replaced in FightLab" in capsys.readouterr().out

        monkeypatch.setenv("FIGHTLAB_TOKEN", "flm_" + "z" * 43)
        assert skill.main(["context"]) == 2
        assert "ERROR: 401" in capsys.readouterr().out
