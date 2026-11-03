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
    assert names == ["upstream", "fightlab"]
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
