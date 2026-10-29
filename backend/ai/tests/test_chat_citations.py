"""Chat del coach sin afirmaciones sin fuente (spec §7.4): citas `[[regla:clave]]`,
herramientas `search_rules` / `get_rule`, validación en el backend e idioma del usuario."""
import json
import logging
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from ai import services
from coaching.models import KnowledgeRule
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token

PAYLOAD = {"messages": [{"role": "user", "content": "¿Cuánta proteína?"}], "context": {"semana_au": 1200}}
PROTEIN = "nutrition/daily-protein-target-for-people-who-lift"


def text_block(text):
    return SimpleNamespace(type="text", text=text)


def tool_block(name, tool_input, id_="tu_1"):
    return SimpleNamespace(type="tool_use", id=id_, name=name, input=tool_input)


def reply(*blocks, stop="end_turn"):
    return SimpleNamespace(content=list(blocks), stop_reason=stop)


@pytest.fixture
def auth_client(db, settings):
    settings.ANTHROPIC_API_KEY = "sk-test"
    user = user_create(email="c@test.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": "c@test.com", "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    client.user = user
    return client


def set_language(client, lang):
    profile = client.user.profile
    profile.language = lang
    profile.save()


@pytest.fixture
def knowledge(db):
    call_command("load_knowledge", verbosity=0)


@pytest.fixture
def create():
    with patch("ai.services.anthropic.Anthropic") as mock:
        yield mock.return_value.messages.create


def chat(client, payload=PAYLOAD, lang=None):
    extra = {"HTTP_ACCEPT_LANGUAGE": lang} if lang else {}
    return client.post("/api/v1/ai/coach/chat", payload, format="json", **extra)


# --- el prompt ---------------------------------------------------------------------


def test_system_prompt_has_no_acwr_safe_zone_nor_unsourced_thresholds():
    prompt = services.COACH_SYSTEM.lower()
    assert "zona segura" not in prompt and "safe zone" not in prompt
    assert "0.8" not in prompt and "1.3" not in prompt
    assert "riesgo de lesión" not in prompt
    assert "[[regla:" in services.COACH_SYSTEM  # la instrucción de citar solo así


@pytest.mark.django_db
def test_prompt_is_in_english_and_carries_the_language_instruction(auth_client, create):
    """El idioma del chat es el del perfil (`profile.language`), no el de la petición."""
    set_language(auth_client, "en")
    create.return_value = reply(text_block("Ok."))
    assert chat(auth_client, lang="es").status_code == 200
    system = create.call_args.kwargs["system"]
    assert "Reply in English" in system
    assert "Reply in Spanish" not in system
    create.reset_mock()
    set_language(auth_client, "es")
    create.return_value = reply(text_block("Vale."))
    chat(auth_client, lang="en")
    assert "Reply in Spanish" in create.call_args.kwargs["system"]


@pytest.mark.django_db
def test_request_language_does_not_change_the_chat_language(auth_client, create):
    create.return_value = reply(text_block("Ok."))
    chat(auth_client, lang="fr")
    assert "Reply in Spanish" in create.call_args.kwargs["system"]  # el del perfil, por defecto es


@pytest.mark.django_db
def test_the_model_gets_both_rule_tools(auth_client, create):
    create.return_value = reply(text_block("Ok."))
    chat(auth_client)
    names = {t["name"] for t in create.call_args.kwargs["tools"]}
    assert names == {"search_rules", "get_rule"}


# --- el bucle de herramientas --------------------------------------------------------


@pytest.mark.django_db
def test_tool_loop_returns_rules_and_keeps_a_valid_citation(auth_client, knowledge, create):
    create.side_effect = [
        reply(tool_block("search_rules", {"query": "protein"}), stop="tool_use"),
        reply(tool_block("get_rule", {"key": PROTEIN}, id_="tu_2"), stop="tool_use"),
        reply(text_block(f"Unos 1,6 g/kg al día [[regla:{PROTEIN}]].")),
    ]
    resp = chat(auth_client)
    assert resp.status_code == 200
    assert resp.data["reply"] == f"Unos 1,6 g/kg al día [[regla:{PROTEIN}]]."
    assert resp.data["citations"] == [
        {"key": PROTEIN, "grade": "moderate", "title": "Daily protein target for people who lift"}
    ]
    # el resultado de la herramienta vuelve al modelo como tool_result
    second = create.call_args_list[1].kwargs["messages"]
    assert second[-2]["role"] == "assistant" and second[-2]["content"][0]["type"] == "tool_use"
    result = second[-1]["content"][0]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "tu_1"
    assert PROTEIN in result["content"]
    third = json.loads(create.call_args_list[2].kwargs["messages"][-1]["content"][0]["content"])
    assert third["key"] == PROTEIN and "rule_text" in third and third["grade"] == "moderate"


@pytest.mark.django_db
def test_invented_key_is_removed_and_logged(auth_client, knowledge, create, caplog):
    create.return_value = reply(text_block("Come bien [[regla:nutrition/inventada]] y duerme."))
    with caplog.at_level(logging.WARNING, logger="coaching.citations"):
        resp = chat(auth_client)
    assert resp.data["reply"] == "Come bien y duerme."
    assert resp.data["citations"] == []
    assert "nutrition/inventada" in caplog.text


@pytest.mark.django_db
def test_real_key_not_returned_by_a_tool_this_turn_is_removed(auth_client, knowledge, create, caplog):
    create.return_value = reply(text_block(f"Come proteína [[regla:{PROTEIN}]]."))
    with caplog.at_level(logging.WARNING, logger="coaching.citations"):
        resp = chat(auth_client)
    assert resp.data["reply"] == "Come proteína."
    assert resp.data["citations"] == []
    assert PROTEIN in caplog.text


@pytest.mark.django_db
def test_retired_rule_cannot_be_cited(auth_client, knowledge, create):
    KnowledgeRule.objects.filter(key=PROTEIN).update(retired=True)
    create.side_effect = [
        reply(tool_block("get_rule", {"key": PROTEIN}), stop="tool_use"),
        reply(text_block(f"Proteína [[regla:{PROTEIN}]].")),
    ]
    resp = chat(auth_client)
    assert "[[regla" not in resp.data["reply"]
    assert resp.data["citations"] == []


@pytest.mark.django_db
def test_get_rule_with_unknown_key_returns_an_error_to_the_model(auth_client, knowledge, create):
    create.side_effect = [
        reply(tool_block("get_rule", {"key": "nutrition/nada"}), stop="tool_use"),
        reply(text_block("No tengo una regla para eso.")),
    ]
    resp = chat(auth_client)
    assert resp.data["reply"] == "No tengo una regla para eso."
    result = create.call_args_list[1].kwargs["messages"][-1]["content"][0]
    assert "error" in json.loads(result["content"])


@pytest.mark.django_db
def test_search_rules_finds_by_heading(auth_client, knowledge, create):
    create.side_effect = [
        reply(tool_block("search_rules", {"query": "Mifflin"}), stop="tool_use"),
        reply(text_block("Ok.")),
    ]
    chat(auth_client)
    found = json.loads(create.call_args_list[1].kwargs["messages"][-1]["content"][0]["content"])
    assert "nutrition/default-rmr-equation-mifflin-st-jeor" in [r["key"] for r in found["results"]]
    assert set(found["results"][0]) == {"key", "title", "grade", "section"}


@pytest.mark.django_db
def test_endless_tool_use_is_cut_off(auth_client, knowledge, create):
    create.return_value = reply(tool_block("search_rules", {"query": "x"}), stop="tool_use")
    resp = chat(auth_client)
    assert resp.status_code == 502
    assert create.call_count == services.MAX_TOOL_ROUNDS + 1


@pytest.mark.django_db
def test_unknown_tool_is_answered_with_an_error(auth_client, knowledge, create):
    create.side_effect = [
        reply(tool_block("hack_the_planet", {}), stop="tool_use"),
        reply(text_block("Ok.")),
    ]
    assert chat(auth_client).status_code == 200
    result = create.call_args_list[1].kwargs["messages"][-1]["content"][0]
    assert "error" in json.loads(result["content"])


@pytest.mark.django_db
def test_citations_are_deduplicated_and_ordered(auth_client, knowledge, create):
    other = "nutrition/default-rmr-equation-mifflin-st-jeor"
    create.side_effect = [
        reply(tool_block("get_rule", {"key": PROTEIN}), stop="tool_use"),
        reply(tool_block("get_rule", {"key": other}, id_="tu_2"), stop="tool_use"),
        reply(text_block(f"A [[regla:{other}]] B [[regla:{PROTEIN}]] C [[regla:{other}]]")),
    ]
    resp = chat(auth_client)
    assert [c["key"] for c in resp.data["citations"]] == [other, PROTEIN]
