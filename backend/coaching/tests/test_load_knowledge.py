import io
import shutil

import pytest
from django.core.management import CommandError, call_command

from coaching.models import KnowledgeRule, KnowledgeSource, RuleTranslation

from .conftest import BAD_DIR, GOOD_DIR


def load(*args):
    out = io.StringIO()
    call_command("load_knowledge", *args, stdout=out)
    return out.getvalue()


def copy_good(tmp_path):
    work = tmp_path / "k"
    shutil.copytree(GOOD_DIR, work)
    return work


@pytest.mark.django_db
def test_loads_fixture_rules_and_sources():
    load("--dir", str(GOOD_DIR))
    keys = set(KnowledgeRule.objects.values_list("key", flat=True))
    assert keys == {
        "widgets/lift-widgets-slowly",
        "widgets/store-widgets-dry",
        "widgets/polish-widgets-weekly",
    }
    rule = KnowledgeRule.objects.get(key="widgets/lift-widgets-slowly")
    assert rule.section == "Handling widgets"
    assert rule.heading == "Lift widgets slowly"
    assert rule.grade == "moderate"
    assert rule.rule_text == "Lift each widget over about 2 seconds."
    assert rule.source_ids == ["S001"]
    assert rule.checked_on.isoformat() == "2026-01-15"
    assert rule.origin == "upstream"
    assert set(KnowledgeSource.objects.values_list("sid", flat=True)) == {"S001", "S002"}
    s1 = KnowledgeSource.objects.get(sid="S001")
    assert s1.doi == "10.1/x" and s1.type == "RCT"
    assert s1.url == "https://pubmed.ncbi.nlm.nih.gov/11111111/"
    assert s1.citation.startswith("Doe J et al., 2020.")
    assert KnowledgeSource.objects.get(sid="S002").doi == ""  # "DOI: none"


@pytest.mark.django_db
def test_is_idempotent():
    load("--dir", str(GOOD_DIR))
    out = load("--dir", str(GOOD_DIR))
    assert "reglas: 0 altas, 0 cambios, 0 bajas" in out
    assert "fuentes: 0 altas, 0 cambios" in out
    assert KnowledgeRule.objects.count() == 3


@pytest.mark.django_db
def test_reports_additions_changes_and_retirements(tmp_path):
    work = copy_good(tmp_path)
    load("--dir", str(work))
    text = (work / "widgets.md").read_text(encoding="utf-8")
    text = text.replace("Lift each widget over about 2 seconds.", "Lift each widget over 3 seconds.")
    text = text.replace(
        "### Polish widgets weekly\n**Rule:** Polish once a week.\n**Grade:** emerging\n**Sources:** [S002]\n", ""
    )
    text += "\n### Wax widgets\n**Rule:** Wax monthly.\n**Grade:** strong\n**Sources:** [S001]\n"
    (work / "widgets.md").write_text(text, encoding="utf-8")
    out = load("--dir", str(work))
    assert "reglas: 1 altas, 1 cambios, 1 bajas" in out
    assert KnowledgeRule.objects.get(key="widgets/lift-widgets-slowly").rule_text == "Lift each widget over 3 seconds."
    assert KnowledgeRule.objects.get(key="widgets/wax-widgets").retired is False
    gone = KnowledgeRule.objects.get(key="widgets/polish-widgets-weekly")
    assert gone.retired is True  # no se borra: puede tener referencias


@pytest.mark.django_db
def test_retired_rule_comes_back(tmp_path):
    work = copy_good(tmp_path)
    original = (work / "widgets.md").read_text(encoding="utf-8")
    load("--dir", str(work))
    (work / "widgets.md").write_text(
        original.replace("### Polish widgets weekly", "### Polish widgets daily"), encoding="utf-8"
    )
    load("--dir", str(work))
    assert KnowledgeRule.objects.get(key="widgets/polish-widgets-weekly").retired is True
    (work / "widgets.md").write_text(original, encoding="utf-8")
    load("--dir", str(work))
    assert KnowledgeRule.objects.get(key="widgets/polish-widgets-weekly").retired is False


@pytest.mark.django_db
def test_changed_text_marks_translations_stale(tmp_path):
    work = copy_good(tmp_path)
    load("--dir", str(work))
    rule = KnowledgeRule.objects.get(key="widgets/lift-widgets-slowly")
    other = KnowledgeRule.objects.get(key="widgets/store-widgets-dry")
    for r in (rule, other):
        RuleTranslation.objects.create(rule=r, lang="es", status="reviewed", source_hash=r.source_hash)
    text = (work / "widgets.md").read_text(encoding="utf-8")
    (work / "widgets.md").write_text(text.replace("about 2 seconds", "about 3 seconds"), encoding="utf-8")
    out = load("--dir", str(work))
    assert "traducciones obsoletas: 1" in out
    assert RuleTranslation.objects.get(rule=rule).status == "stale"
    assert RuleTranslation.objects.get(rule=other).status == "reviewed"


@pytest.mark.django_db
def test_origin_option_and_scoped_retirement():
    load("--dir", str(GOOD_DIR))
    load("--dir", str(BAD_DIR), "--origin", "fightlab")
    assert KnowledgeRule.objects.filter(origin="fightlab").count() == 3
    # volver a cargar solo el origen fightlab no retira las reglas upstream
    load("--dir", str(BAD_DIR), "--origin", "fightlab")
    assert KnowledgeRule.objects.filter(origin="upstream", retired=True).count() == 0
    assert KnowledgeSource.objects.get(sid="S001").origin == "upstream"  # no se pisa


@pytest.mark.django_db
def test_bad_fixture_is_tolerated_and_reported():
    out = load("--dir", str(BAD_DIR), "--origin", "fightlab")
    assert KnowledgeRule.objects.get(heading="No grade").grade == ""
    assert KnowledgeRule.objects.get(heading="Wrong grade value").grade == ""
    assert "S999" in out  # fuente citada que no existe en sources.md


@pytest.mark.django_db
def test_duplicate_keys_abort(tmp_path):
    work = copy_good(tmp_path)
    text = (work / "widgets.md").read_text(encoding="utf-8")
    dup = "\n## Other\n\n### Store widgets dry\n**Rule:** x\n**Grade:** strong\n"
    (work / "widgets.md").write_text(text + dup, encoding="utf-8")
    with pytest.raises(CommandError, match="duplicadas"):
        load("--dir", str(work))
    assert KnowledgeRule.objects.count() == 0


@pytest.mark.django_db
def test_missing_dir():
    with pytest.raises(CommandError):
        load("--dir", "/no/existe")


@pytest.mark.django_db
def test_real_knowledge_counts_and_idempotence(real_knowledge):
    assert KnowledgeRule.objects.filter(origin="upstream").count() == 459
    assert KnowledgeSource.objects.count() == 859
    rule = KnowledgeRule.objects.get(key="nutrition/default-rmr-equation-mifflin-st-jeor")
    assert rule.grade == "moderate"
    assert rule.source_ids[:3] == ["S161", "S163", "S267"]
    assert rule.engine_sha.startswith("69e5537")
    assert rule.checked_on.isoformat() == "2026-10-24"
    assert "±10%" in rule.rule_text
    out = load()
    assert "reglas: 0 altas, 0 cambios, 0 bajas" in out
