import io
import shutil
from pathlib import Path

import pytest
import yaml
from django.conf import settings
from django.core.management import CommandError, call_command

from coaching.models import KnowledgeRule, RuleTranslation
from coaching.translation_loader import up_to_date

from .conftest import GOOD_DIR

ES = {
    "widgets/lift-widgets-slowly": ("Levanta los widgets despacio", "Levanta cada widget en unos 2 segundos."),
    "widgets/store-widgets-dry": ("Guarda los widgets en seco", "Guárdalos en un sitio seco."),
    "widgets/polish-widgets-weekly": ("Pule los widgets cada semana", "Púlelos una vez a la semana."),
}


def run(*args):
    out = io.StringIO()
    call_command("load_translations", *args, stdout=out)
    return out.getvalue()


def write_translations(root: Path, entries: list[dict], lang: str = "es") -> Path:
    folder = root / lang / "upstream"
    folder.mkdir(parents=True, exist_ok=True)
    doc = {"lang": lang, "origin": "upstream", "file": "widgets", "rules": entries}
    (folder / "widgets.yaml").write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return root


def entries_for_loaded_rules(**overrides) -> list[dict]:
    out = []
    for rule in KnowledgeRule.objects.order_by("key"):
        heading, text = ES[rule.key]
        entry = {"key": rule.key, "source_hash": rule.source_hash, "status": "machine", "heading": heading, "rule_text": text}
        out.append({**entry, **overrides.get(rule.key, {})})
    return out


@pytest.fixture
def widgets(db):
    call_command("load_knowledge", "--dir", str(GOOD_DIR), verbosity=0)


def test_creates_translations_from_files(widgets, tmp_path):
    root = write_translations(tmp_path, entries_for_loaded_rules())
    out = run("--lang", "es", "--dir", str(root))
    assert "3 altas, 0 cambios (0 sin cambios)" in out
    tr = RuleTranslation.objects.get(rule__key="widgets/lift-widgets-slowly", lang="es")
    assert tr.heading == "Levanta los widgets despacio"
    assert tr.rule_text == "Levanta cada widget en unos 2 segundos."
    assert tr.status == RuleTranslation.Status.MACHINE
    assert tr.source_hash == tr.rule.source_hash
    assert all(up_to_date(t, t.rule) for t in RuleTranslation.objects.select_related("rule"))


def test_second_run_changes_nothing(widgets, tmp_path):
    root = write_translations(tmp_path, entries_for_loaded_rules())
    run("--lang", "es", "--dir", str(root))
    out = run("--lang", "es", "--dir", str(root))
    assert "0 altas, 0 cambios (3 sin cambios)" in out
    assert RuleTranslation.objects.count() == 3


def test_edited_file_updates_the_translation(widgets, tmp_path):
    root = write_translations(tmp_path, entries_for_loaded_rules())
    run("--lang", "es", "--dir", str(root))
    key = "widgets/store-widgets-dry"
    write_translations(tmp_path, entries_for_loaded_rules(**{key: {"rule_text": "Guárdalos secos.", "status": "reviewed"}}))
    out = run("--lang", "es", "--dir", str(root))
    assert "0 altas, 1 cambios (2 sin cambios)" in out
    tr = RuleTranslation.objects.get(rule__key=key)
    assert (tr.rule_text, tr.status) == ("Guárdalos secos.", RuleTranslation.Status.REVIEWED)


def test_entry_with_an_old_source_hash_is_stale(widgets, tmp_path):
    key = "widgets/polish-widgets-weekly"
    root = write_translations(tmp_path, entries_for_loaded_rules(**{key: {"source_hash": "0" * 64}}))
    out = run("--lang", "es", "--dir", str(root))
    assert f"obsoletas (la regla cambió desde que se tradujo): 1: {key}" in out
    assert "reglas vigentes sin traducción al día: 1" in out
    tr = RuleTranslation.objects.get(rule__key=key)
    assert tr.status == RuleTranslation.Status.STALE
    assert not up_to_date(tr, tr.rule)


def test_rule_changed_upstream_after_translating_stays_stale(widgets, tmp_path):
    root = write_translations(tmp_path, entries_for_loaded_rules())
    run("--lang", "es", "--dir", str(root))
    work = tmp_path / "k"
    shutil.copytree(GOOD_DIR, work)
    for path in work.glob("*.md"):
        path.write_text(path.read_text(encoding="utf-8").replace("over about 2 seconds", "over about 3 seconds"), encoding="utf-8")
    call_command("load_knowledge", "--dir", str(work), verbosity=0)
    tr = RuleTranslation.objects.get(rule__key="widgets/lift-widgets-slowly")
    assert tr.status == RuleTranslation.Status.STALE  # lo marca load_knowledge
    # Volver a cargar el archivo viejo no la da por buena.
    run("--lang", "es", "--dir", str(root))
    tr.refresh_from_db()
    assert tr.status == RuleTranslation.Status.STALE


def test_dry_run_saves_nothing(widgets, tmp_path):
    root = write_translations(tmp_path, entries_for_loaded_rules())
    out = run("--lang", "es", "--dir", str(root), "--dry-run")
    assert "(dry-run, sin guardar) traducciones (es): 3 altas" in out
    assert RuleTranslation.objects.count() == 0


def test_unknown_keys_are_reported_and_skipped(widgets, tmp_path):
    extra = {"key": "widgets/no-such-rule", "source_hash": "x", "heading": "x", "rule_text": "x"}
    root = write_translations(tmp_path, [*entries_for_loaded_rules(), extra])
    out = run("--lang", "es", "--dir", str(root))
    assert "entradas sin regla: widgets/no-such-rule" in out
    assert RuleTranslation.objects.count() == 3


@pytest.mark.parametrize(
    "bad",
    [
        {"heading": ""},
        {"status": "stale"},
        {"source_hash": None},
    ],
)
def test_invalid_entries_fail(widgets, tmp_path, bad):
    key = "widgets/lift-widgets-slowly"
    root = write_translations(tmp_path, entries_for_loaded_rules(**{key: bad}))
    with pytest.raises(CommandError):
        run("--lang", "es", "--dir", str(root))
    assert RuleTranslation.objects.count() == 0


def test_rejects_unsupported_language_and_missing_files(widgets, tmp_path):
    with pytest.raises(CommandError, match="idioma no soportado"):
        run("--lang", "fr", "--dir", str(tmp_path))
    with pytest.raises(CommandError, match="no hay archivos"):
        run("--lang", "es", "--dir", str(tmp_path))


# --- Los archivos del repo ---


@pytest.fixture
def all_knowledge(real_knowledge):
    call_command("load_knowledge", "--dir", str(Path(settings.BASE_DIR) / "knowledge_fightlab"), "--origin", "fightlab", verbosity=0)


def test_every_loaded_rule_has_an_up_to_date_spanish_translation(all_knowledge):
    out = run("--lang", "es")
    assert "entradas sin regla" not in out
    assert "obsoletas" not in out
    rules = list(KnowledgeRule.objects.filter(retired=False))
    assert len(rules) == 527  # 459 del coach, 60 de combate y 8 de batch cooking (F12)
    translations = {t.rule_id: t for t in RuleTranslation.objects.filter(lang="es")}
    pending = [r.key for r in rules if not up_to_date(translations.get(r.pk), r)]
    assert pending == []
    for r in rules:
        tr = translations[r.pk]
        assert tr.status == RuleTranslation.Status.MACHINE
        assert tr.heading and tr.rule_text
        for f in ("applies_to", "conflicts"):
            assert bool(getattr(r, f)) == bool(getattr(tr, f)), f"{r.key}.{f}"
    assert "0 altas, 0 cambios (527 sin cambios)" in run("--lang", "es")


# La hoja de evidencia del frontend se prueba con esta misma respuesta de la API
# (`frontend/tests/evidence/rule-translation.test.tsx`): si cambia una de estas traducciones,
# regenera el archivo con `python manage.py shell` y `rule_detail(rule, "es")`.
FRONTEND_FIXTURE = Path(settings.BASE_DIR).parent / "frontend" / "tests" / "evidence" / "fixtures" / "rules-es.json"


@pytest.mark.skipif(not FRONTEND_FIXTURE.is_file(), reason="sin el frontend al lado")
def test_api_serves_the_spanish_translation_the_frontend_test_uses(all_knowledge):
    import json

    from rest_framework.test import APIClient

    from users.services import email_verify, user_create
    from users.tokens import generate_email_verification_token

    run("--lang", "es")
    user = user_create(email="tr@test.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": "tr@test.com", "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    expected = json.loads(FRONTEND_FIXTURE.read_text(encoding="utf-8"))
    for key, rule in expected.items():
        got = client.get(f"/api/v1/knowledge/rules/{key}", HTTP_ACCEPT_LANGUAGE="es").json()
        assert got["translation"] == rule["translation"], key
        assert got["translation"]["status"] == "machine"
        assert got["heading"] == rule["heading"]
