"""E.4: el anexo de combate (`knowledge_fightlab/`) se carga con `origin=fightlab`.

`iter_rules`/`CITE_RE` del coach solo leen `[Sxxx]`: el puente lee también `[Fxxx]`, así que
`source_ids` no sale vacío. `dropped-claims.md` no es un archivo de reglas.
"""
import io
import re
from collections import Counter
from pathlib import Path

import pytest
from django.core.management import call_command

from coaching.models import KnowledgeRule, KnowledgeSource

ANNEX = Path(__file__).resolve().parents[2] / "knowledge_fightlab"


def load(*args) -> str:
    out = io.StringIO()
    call_command("load_knowledge", *args, stdout=out)
    return out.getvalue()


@pytest.fixture
def annex(db):
    return load("--dir", str(ANNEX), "--origin", "fightlab")


def test_loads_the_60_rules_and_144_sources(annex):
    rules = KnowledgeRule.objects.filter(origin="fightlab")
    assert rules.count() == 60
    assert not rules.filter(retired=True).exists()
    assert KnowledgeSource.objects.filter(origin="fightlab").count() == 144
    assert set(KnowledgeSource.objects.values_list("sid", flat=True)) == {f"F{n:03d}" for n in range(1, 145)}
    assert "reglas: 60 altas" in annex and "fuentes: 144 altas" in annex
    assert "fuentes citadas que no existen" not in annex


def test_grades_match_the_annex(annex):
    grades = Counter(KnowledgeRule.objects.filter(origin="fightlab").values_list("grade", flat=True))
    assert grades == {"strong": 7, "moderate": 14, "emerging": 39}


def test_every_rule_has_its_fxxx_source_ids_and_they_resolve(annex):
    sids = set(KnowledgeSource.objects.values_list("sid", flat=True))
    cited = set()
    for rule in KnowledgeRule.objects.filter(origin="fightlab"):
        assert rule.source_ids, rule.key
        assert all(re.fullmatch(r"F\d{3}", s) for s in rule.source_ids), rule.key
        assert set(rule.source_ids) <= sids, rule.key
        cited |= set(rule.source_ids)
    assert cited == {f"F{n:03d}" for n in range(1, 145)}  # cada fuente se cita


def test_rule_fields_and_checked_date_are_parsed(annex):
    rule = KnowledgeRule.objects.get(key="combat-sports/the-0-8-1-3-sweet-spot-is-not-a-safe-zone")
    assert rule.file == "combat-sports"
    assert rule.section == "ACWR and load spikes"
    assert rule.grade and rule.rule_text and rule.evidence and rule.applies_to
    assert rule.checked_on.isoformat() == "2026-10-29"
    assert rule.engine_sha == ""  # no es del motor


def test_dropped_claims_is_not_loaded_as_rules(annex):
    assert not KnowledgeRule.objects.filter(file="dropped-claims").exists()
    assert not KnowledgeSource.objects.filter(sid__startswith="FD").exists()


def test_loading_the_annex_is_idempotent_and_leaves_upstream_alone(real_knowledge):
    upstream = KnowledgeRule.objects.filter(origin="upstream").count()
    assert upstream > 400
    load("--dir", str(ANNEX), "--origin", "fightlab")
    out = load("--dir", str(ANNEX), "--origin", "fightlab")
    assert "reglas: 0 altas, 0 cambios, 0 bajas (60 sin cambios)" in out
    assert KnowledgeRule.objects.filter(origin="upstream").count() == upstream
    assert KnowledgeRule.objects.filter(origin="upstream", retired=True).count() == 0
