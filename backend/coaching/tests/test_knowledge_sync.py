import io
import shutil
import time

import pytest
from django.core.management import call_command

from coaching import knowledge_sync
from coaching.knowledge_loader import load_knowledge
from coaching.knowledge_sync import KnowledgeSet, sync_knowledge
from coaching.models import KnowledgeRule, KnowledgeSync

from .conftest import GOOD_DIR


def good_set(tmp_path, name="upstream"):
    work = tmp_path / name
    shutil.copytree(GOOD_DIR, work)
    return KnowledgeSet(name, work, lambda d: load_knowledge(d, origin=KnowledgeRule.Origin.UPSTREAM))


@pytest.mark.django_db
def test_first_start_loads_and_saves_the_hash(tmp_path):
    kset = good_set(tmp_path)
    [r] = sync_knowledge([kset])
    assert r.status == "loaded"
    assert KnowledgeRule.objects.count() == 3
    assert KnowledgeSync.objects.get(name="upstream").content_hash == kset.content_hash()


@pytest.mark.django_db
def test_same_content_is_skipped_without_loading(tmp_path, monkeypatch):
    kset = good_set(tmp_path)
    sync_knowledge([kset])
    calls = []
    skipping = KnowledgeSet(kset.name, kset.directory, lambda d: calls.append(d))
    start = time.monotonic()
    [r] = sync_knowledge([skipping])
    assert r.status == "unchanged"
    assert calls == []
    assert time.monotonic() - start < 1


@pytest.mark.django_db
def test_changed_content_is_loaded_again(tmp_path):
    kset = good_set(tmp_path)
    sync_knowledge([kset])
    old_hash = KnowledgeSync.objects.get(name="upstream").content_hash
    rule_file = next(p for p in kset.files() if p.name not in ("sources.md", "index.md"))
    rule_file.write_text(rule_file.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    [r] = sync_knowledge([kset])
    assert r.status == "loaded"
    assert KnowledgeSync.objects.get(name="upstream").content_hash != old_hash


@pytest.mark.django_db
def test_force_loads_even_without_changes(tmp_path):
    kset = good_set(tmp_path)
    sync_knowledge([kset])
    [r] = sync_knowledge([kset], force=True)
    assert r.status == "loaded"


@pytest.mark.django_db
def test_a_failure_is_logged_keeps_the_old_hash_and_does_not_raise(tmp_path, caplog):
    # Carpeta que no existe: load_knowledge lanza KnowledgeError
    broken = KnowledgeSet("upstream", tmp_path / "missing", lambda d: load_knowledge(d, origin=KnowledgeRule.Origin.UPSTREAM))
    later = good_set(tmp_path, "fightlab")
    results = sync_knowledge([broken, later])
    assert [r.status for r in results] == ["failed", "failed"]  # el de detrás podría depender del primero
    assert not KnowledgeSync.objects.exists()  # sin huella: se reintenta en el próximo arranque
    assert "No se pudo cargar la base de evidencia 'upstream'" in caplog.text


@pytest.mark.django_db
def test_real_sets_cover_the_coach_and_the_combat_annex():
    names = [s.name for s in knowledge_sync.knowledge_sets()]
    assert names == ["upstream", "fightlab", "translations-es"]  # las traducciones, detrás de sus reglas
    assert all(s.files() for s in knowledge_sync.knowledge_sets())


@pytest.mark.django_db
def test_command_on_start_can_be_switched_off(settings, monkeypatch):
    called = []
    monkeypatch.setattr("coaching.management.commands.sync_knowledge.sync_knowledge", lambda **kw: called.append(kw) or [])
    settings.KNOWLEDGE_SYNC_ON_START = False
    out = io.StringIO()
    call_command("sync_knowledge", "--on-start", stdout=out)
    assert called == [] and "desactivada" in out.getvalue()
    settings.KNOWLEDGE_SYNC_ON_START = True
    call_command("sync_knowledge", "--on-start", stdout=io.StringIO())
    assert called == [{"force": False}]


def test_dockerfile_runs_it_on_start_without_blocking_gunicorn():
    from pathlib import Path

    cmd = (Path(__file__).resolve().parents[2] / "Dockerfile").read_text(encoding="utf-8")
    assert "sync_knowledge --on-start ||" in cmd
    assert cmd.index("sync_knowledge") < cmd.index("gunicorn core.wsgi")


# --- Traducciones al español (conjunto "translations-es") ---

def translations_set(tmp_path, rules_dir):
    """Traducciones de las reglas de `rules_dir` (ya cargadas) en archivos, como en el repo."""
    import yaml

    from coaching.translation_loader import load_translations

    from .test_load_translations import entries_for_loaded_rules

    folder = tmp_path / "tr" / "es" / "upstream"
    folder.mkdir(parents=True)
    doc = {"lang": "es", "origin": "upstream", "file": "widgets", "rules": entries_for_loaded_rules()}
    (folder / "widgets.yaml").write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return KnowledgeSet("translations-es", tmp_path / "tr", lambda d: load_translations(d, "es"),
                        patterns=("es/**/*.yaml",), reload_after_previous=True)


@pytest.mark.django_db
def test_translations_load_after_the_rules_and_are_skipped_without_changes(tmp_path):
    from coaching.models import RuleTranslation

    rules = good_set(tmp_path)
    sync_knowledge([rules])
    tr = translations_set(tmp_path, rules.directory)
    results = sync_knowledge([rules, tr])
    assert [r.status for r in results] == ["unchanged", "loaded"]
    assert results[1].report.created == 3
    assert RuleTranslation.objects.filter(lang="es", status=RuleTranslation.Status.MACHINE).count() == 3
    assert [r.status for r in sync_knowledge([rules, tr])] == ["unchanged", "unchanged"]
    assert "3 altas, 0 cambios, 0 desfasadas" in knowledge_sync.summary(results[1].report)


@pytest.mark.django_db
def test_changed_translation_files_are_loaded_again(tmp_path):
    from coaching.models import RuleTranslation

    rules = good_set(tmp_path)
    sync_knowledge([rules])
    tr = translations_set(tmp_path, rules.directory)
    sync_knowledge([rules, tr])
    path = next(tr.directory.glob("es/**/*.yaml"))
    path.write_text(path.read_text(encoding="utf-8").replace("despacio", "muy despacio"), encoding="utf-8")
    results = sync_knowledge([rules, tr])
    assert [r.status for r in results] == ["unchanged", "loaded"]
    assert results[1].report.updated == 1
    assert RuleTranslation.objects.get(rule__key="widgets/lift-widgets-slowly").heading == "Levanta los widgets muy despacio"


@pytest.mark.django_db
def test_a_changed_rule_reloads_the_translations_and_marks_them_stale(tmp_path):
    from coaching.models import RuleTranslation

    rules = good_set(tmp_path)
    sync_knowledge([rules])
    tr = translations_set(tmp_path, rules.directory)
    sync_knowledge([rules, tr])
    rule_file = next(p for p in rules.files() if p.name not in ("sources.md", "index.md"))
    text = rule_file.read_text(encoding="utf-8")
    assert "Lift each widget over about 2 seconds." in text
    rule_file.write_text(text.replace("about 2 seconds", "about 3 seconds"), encoding="utf-8")
    # Los archivos de traducción no cambian, pero se recargan porque cambió una regla
    results = sync_knowledge([rules, tr])
    assert [r.status for r in results] == ["loaded", "loaded"]
    assert results[1].report.stale_keys == ["widgets/lift-widgets-slowly"]
    stale = RuleTranslation.objects.get(rule__key="widgets/lift-widgets-slowly")
    assert stale.status == RuleTranslation.Status.STALE
