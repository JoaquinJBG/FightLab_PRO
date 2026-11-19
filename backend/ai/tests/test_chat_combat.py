"""E.5 en el chat: los bloqueos de combate los pone el servidor en el prompt, no el cliente.

Con `no_contact` el modelo no puede proponer contacto y la respuesta deriva (línea de
`docs/safety.md`); con un menor no hay información de corte. La carga llega sin ratio antes de
28 días y con la comparación frente a la media.
"""
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.utils import timezone

from ai import services
from ai.views import CONTEXT_KEYS
from coaching.bridge import reason_texts
from coaching.models import HeadImpact
from coaching.tests.helpers import client_for, make_user

URL = "/api/v1/ai/coach/chat"
PAYLOAD = {"messages": [{"role": "user", "content": "¿Hago sparring hoy?"}], "context": {"semana_au": 900}}

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def fake_model(settings):
    settings.ANTHROPIC_API_KEY = "sk-test"
    with patch("ai.services.anthropic.Anthropic") as mock:
        mock.return_value.messages.create.return_value = SimpleNamespace(
            content=[SimpleNamespace(type="text", text="Hoy técnica suave.")], stop_reason="end_turn"
        )
        yield mock.return_value.messages.create


def chat(user, payload=PAYLOAD):
    return client_for(user).post(URL, payload, format="json")


def test_no_contact_goes_into_the_prompt_and_the_reply_refers(fake_model):
    user = make_user()
    HeadImpact.objects.create(profile=user.profile, occurred_on=timezone.localdate() - timedelta(days=2), symptoms=True)
    resp = chat(user)
    assert resp.status_code == 200
    system = fake_model.call_args.kwargs["system"]
    assert "blow to the head" in system and "sparring" in system
    assert "Concussion Recognition Tool 6" in system
    assert resp.data["reply"].endswith(reason_texts.DEFERRAL_LINE["es"])


def test_cleared_blow_leaves_the_prompt_alone(fake_model):
    user = make_user()
    today = timezone.localdate()
    HeadImpact.objects.create(profile=user.profile, occurred_on=today, symptoms=True, cleared_on=today)
    chat(user)
    assert "blow to the head" not in fake_model.call_args.kwargs["system"]


def test_minors_get_no_weight_cut_information(fake_model):
    user = make_user(profile={"date_of_birth": date(2011, 1, 1)})
    chat(user)
    assert "under 18" in fake_model.call_args.kwargs["system"]


def test_load_context_keys_follow_the_annex():
    assert "acwr_provisional" not in CONTEXT_KEYS
    assert {"semana_vs_media_pct", "dias_para_ratio", "historial_con_huecos"} <= CONTEXT_KEYS


def test_prompt_explains_the_ratio_is_descriptive_and_barely_studied_in_combat():
    prompt = services.COACH_SYSTEM
    assert "28 days" in prompt
    assert "team sports" in prompt and "combat sports" in prompt
