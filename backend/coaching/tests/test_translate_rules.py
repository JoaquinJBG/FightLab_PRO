import io
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.management import CommandError, call_command

from coaching import translation
from coaching.models import KnowledgeRule, RuleTranslation

from .conftest import GOOD_DIR

LIFT = "widgets/lift-widgets-slowly"
DRY = "widgets/store-widgets-dry"
POLISH = "widgets/polish-widgets-weekly"


def fake_reply(payload) -> SimpleNamespace:
    text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)])


def es_for(user_json: str) -> dict:
    """Respuesta simulada del LLM: antepone 'ES: ' a cada campo que recibe."""
    data = json.loads(user_json)
    return {k: f"ES: {v}" for k, v in data.items() if v}


@pytest.fixture
def widgets(db, settings):
    settings.ANTHROPIC_API_KEY = "sk-test"
    call_command("load_knowledge", "--dir", str(GOOD_DIR), verbosity=0)


@pytest.fixture
def llm():
    """Cliente de Anthropic simulado: nunca sale a la red."""
    with patch("ai.services.anthropic.Anthropic") as mock:
        create = mock.return_value.messages.create
        create.side_effect = lambda **kw: fake_reply(es_for(kw["messages"][0]["content"]))
        yield create


def run(*args):
    out = io.StringIO()
    call_command("translate_rules", *args, stdout=out)
    return out.getvalue()


@pytest.mark.django_db
def test_translates_missing_rules_with_status_machine(widgets, llm):
    out = run("--lang", "es")
    assert llm.call_count == 3
    tr = RuleTranslation.objects.get(rule__key=LIFT, lang="es")
    assert tr.status == "machine"
    assert tr.rule_text == "ES: Lift each widget over about 2 seconds."
    assert tr.heading == "ES: Lift widgets slowly"
    assert tr.source_hash == KnowledgeRule.objects.get(key=LIFT).source_hash
    assert "traducidas: 3" in out


@pytest.mark.django_db
def test_second_run_makes_no_calls(widgets, llm):
    run("--lang", "es")
    llm.reset_mock()
    out = run("--lang", "es")
    assert llm.call_count == 0
    assert "traducidas: 0" in out


@pytest.mark.django_db
def test_stale_translation_is_redone_and_reviewed_is_kept(widgets, llm):
    run("--lang", "es")
    RuleTranslation.objects.filter(rule__key=DRY).update(status="reviewed")
    RuleTranslation.objects.filter(rule__key=LIFT).update(status="stale", rule_text="viejo")
    llm.reset_mock()
    run("--lang", "es")
    assert llm.call_count == 1
    tr = RuleTranslation.objects.get(rule__key=LIFT)
    assert tr.status == "machine" and tr.rule_text.startswith("ES: Lift each")
    assert RuleTranslation.objects.get(rule__key=DRY).status == "reviewed"


@pytest.mark.django_db
def test_priority_rules_go_first_and_priority_only_skips_the_rest(widgets, llm, monkeypatch):
    monkeypatch.setattr(translation, "priority_keys", lambda: {POLISH})
    run("--lang", "es", "--priority-only")
    assert list(RuleTranslation.objects.values_list("rule__key", flat=True)) == [POLISH]
    llm.reset_mock()
    order = []
    llm.side_effect = lambda **kw: (order.append(json.loads(kw["messages"][0]["content"])["heading"]),
                                    fake_reply(es_for(kw["messages"][0]["content"])))[1]
    run("--lang", "es")
    assert order == ["Lift widgets slowly", "Store widgets dry"]
    RuleTranslation.objects.all().delete()
    order.clear()
    run("--lang", "es")
    assert order[0] == "Polish widgets weekly"  # la prioritaria, la primera


@pytest.mark.django_db
def test_limit(widgets, llm):
    run("--lang", "es", "--limit", "2")
    assert llm.call_count == 2


@pytest.mark.django_db
def test_dry_run_never_calls_the_api(widgets, llm):
    out = run("--lang", "es", "--dry-run")
    assert llm.call_count == 0
    assert RuleTranslation.objects.count() == 0
    assert "3 reglas" in out


@pytest.mark.django_db
def test_without_api_key_it_refuses(widgets, llm, settings):
    settings.ANTHROPIC_API_KEY = ""
    with pytest.raises(CommandError, match="ANTHROPIC_API_KEY"):
        run("--lang", "es")
    assert llm.call_count == 0


@pytest.mark.django_db
def test_bad_json_is_reported_and_nothing_is_saved(widgets, llm):
    llm.side_effect = lambda **kw: fake_reply("esto no es JSON")
    out = run("--lang", "es")
    assert RuleTranslation.objects.count() == 0
    assert "fallidas: 3" in out


@pytest.mark.django_db
def test_lost_source_tags_are_rejected(widgets, llm):
    KnowledgeRule.objects.filter(key=LIFT).update(rule_text="Lift slowly [S001].")
    llm.side_effect = lambda **kw: fake_reply({"heading": "Levanta", "rule_text": "Levanta despacio."})
    out = run("--lang", "es")
    assert not RuleTranslation.objects.filter(rule__key=LIFT).exists()
    assert "fallidas" in out


@pytest.mark.django_db
def test_json_inside_a_code_fence_is_accepted(widgets, llm):
    llm.side_effect = lambda **kw: fake_reply("```json\n" + json.dumps(es_for(kw["messages"][0]["content"])) + "\n```")
    run("--lang", "es")
    assert RuleTranslation.objects.count() == 3


@pytest.mark.django_db
def test_prompt_carries_the_rules_of_translation(widgets, llm):
    run("--lang", "es", "--limit", "1")
    kwargs = llm.call_args.kwargs
    assert "Spanish" in kwargs["system"]
    assert "[S" in kwargs["system"]  # conservar las etiquetas de fuente
    assert kwargs["model"]
    sent = json.loads(kwargs["messages"][0]["content"])
    assert "rule_text" in sent and "evidence" not in sent


@pytest.mark.django_db
def test_unsupported_language_is_rejected(widgets, llm):
    with pytest.raises(CommandError):
        run("--lang", "fr")


@pytest.mark.django_db
def test_retired_rules_are_not_translated(widgets, llm):
    KnowledgeRule.objects.filter(key=POLISH).update(retired=True)
    run("--lang", "es")
    assert llm.call_count == 2


@pytest.mark.django_db
def test_engine_priority_keys_exist_in_the_real_knowledge(real_knowledge):
    keys = translation.priority_keys()
    assert len(keys) >= 25
    existing = set(KnowledgeRule.objects.values_list("key", flat=True))
    assert keys <= existing
    assert "recovery-habits/resting-bp-thresholds-to-defer-or-refer" in keys
    assert "nutrition/recalibrate-tdee-from-the-weight-trend" in keys
