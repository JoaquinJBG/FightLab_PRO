"""Las reglas del anexo de combate que cita el frontend (`frontend/lib/combat-rules.ts`) existen
en el anexo y con el mismo grado (E.5). Si se renombra un encabezado del anexo, falla aquí."""
import io
import re
from pathlib import Path

import pytest
from django.core.management import call_command

from coaching.models import KnowledgeRule

ROOT = Path(__file__).resolve().parents[3]
RULES_TS = ROOT / "frontend" / "lib" / "combat-rules.ts"
ANNEX = ROOT / "backend" / "knowledge_fightlab"
RULE_RE = re.compile(r'rule\("(?P<slug>[a-z0-9-]+)", "(?P<grade>strong|moderate|emerging)"\)')


def frontend_rules() -> list[tuple[str, str]]:
    return [(f"combat-sports/{m['slug']}", m["grade"]) for m in RULE_RE.finditer(RULES_TS.read_text(encoding="utf-8"))]


def test_the_frontend_cites_annex_rules():
    assert len(frontend_rules()) >= 25


@pytest.mark.django_db
def test_every_frontend_rule_exists_with_its_grade():
    call_command("load_knowledge", "--dir", str(ANNEX), "--origin", "fightlab", stdout=io.StringIO())
    grades = dict(KnowledgeRule.objects.filter(origin="fightlab").values_list("key", "grade"))
    for key, grade in frontend_rules():
        assert key in grades, key
        assert grades[key] == grade, key


SAFETY_TS = ROOT / "frontend" / "lib" / "safety-rules.ts"
SAFETY_RE = re.compile(r'key: "(?P<key>[a-z0-9/-]+)", grade: "(?P<grade>strong|moderate|emerging)"')


@pytest.mark.django_db
def test_every_frontend_safety_rule_exists_with_its_grade():
    """F3: las reglas de seguridad que cita el chat por reglas (`frontend/lib/safety-rules.ts`)."""
    call_command("load_knowledge", stdout=io.StringIO())
    found = [(m["key"], m["grade"]) for m in SAFETY_RE.finditer(SAFETY_TS.read_text(encoding="utf-8"))]
    assert len(found) == 3
    grades = dict(KnowledgeRule.objects.values_list("key", "grade"))
    for key, grade in found:
        assert grades.get(key) == grade, key
