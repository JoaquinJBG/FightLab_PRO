"""El texto del LLM en el plan y la revisión cuesta dinero (fix G1-1).

- Apagado por defecto (`PLAN_NARRATIVE_ENABLED`): ni con la clave puesta se llama a Anthropic.
- Encendido: gasta cuota del chat, cuenta tokens para `AI_GLOBAL_DAILY_TOKEN_BUDGET`, tiene un
  throttle de 10/h y la llamada va fuera de la transacción que guarda el plan.
"""
from datetime import timedelta
from unittest import mock

import pytest
from django.db import connection
from django.test import override_settings

from ai.models import AIUsage
from coaching.models import WeeklyPlan

from .helpers import TODAY, client_for, make_user, today_fixed  # noqa: F401
from .test_review import _proposing_user
from .test_strength import bench, log_session

pytestmark = pytest.mark.django_db

PLAN = "/api/v1/coach/plan"
REVIEW = "/api/v1/coach/review"


def _reply(text="Semana de trabajo."):
    return mock.Mock(content=[mock.Mock(text=text)], usage=mock.Mock(input_tokens=120, output_tokens=30))


def _user():
    user = make_user()
    log_session(user, TODAY - timedelta(days=3), [bench(60, 10)])
    return user


@override_settings(ANTHROPIC_API_KEY="test-key")
def test_narrative_is_off_by_default(today_fixed):
    with mock.patch("ai.services._client") as client:
        client.return_value.messages.create.return_value = _reply()
        res = client_for(_user()).post(PLAN, {"gym_days": ["mon", "thu"]}, format="json")
    assert res.status_code == 201
    assert res.json()["narrative"] == ""
    client.assert_not_called()


@override_settings(ANTHROPIC_API_KEY="test-key")
def test_review_and_accept_do_not_call_the_llm_by_default(today_fixed):
    user = _proposing_user()
    with mock.patch("ai.services._client") as client:
        api = client_for(user)
        body = api.post(REVIEW, {"signs": ["joint_aches"]}, format="json").json()
        res = api.post(f"{REVIEW}/{body['id']}/accept", {"accept": ["deload"]}, format="json")
    assert res.status_code == 200, res.json()
    client.assert_not_called()


@override_settings(ANTHROPIC_API_KEY="test-key", PLAN_NARRATIVE_ENABLED=True)
def test_enabled_narrative_spends_chat_quota_and_records_tokens(today_fixed):
    user = _user()
    with mock.patch("ai.services._client") as client:
        client.return_value.messages.create.return_value = _reply()
        res = client_for(user).post(PLAN, {"gym_days": ["mon", "thu"]}, format="json")
    assert res.status_code == 201
    assert res.json()["narrative"] == "Semana de trabajo."
    usage = AIUsage.objects.get(user=user, kind=AIUsage.Kind.CHAT)
    assert (usage.count, usage.input_tokens, usage.output_tokens) == (1, 120, 30)


@override_settings(ANTHROPIC_API_KEY="test-key", PLAN_NARRATIVE_ENABLED=True, AI_DAILY_QUOTA_CHAT=1)
def test_enabled_narrative_respects_the_daily_quota(today_fixed):
    user = _user()
    api = client_for(user)
    with mock.patch("ai.services._client") as client:
        client.return_value.messages.create.return_value = _reply()
        first = api.post(PLAN, {"gym_days": ["mon", "thu"]}, format="json")
        second = api.post(PLAN, {"gym_days": ["mon", "thu"]}, format="json")
    assert first.json()["narrative"] and second.status_code == 201
    assert second.json()["narrative"] == ""  # sin cuota el plan sale igual, sin texto
    assert client.return_value.messages.create.call_count == 1


@override_settings(ANTHROPIC_API_KEY="test-key", PLAN_NARRATIVE_ENABLED=True, AI_GLOBAL_DAILY_TOKEN_BUDGET=100)
def test_enabled_narrative_stops_at_the_global_budget(today_fixed):
    user = _user()
    other = make_user()
    AIUsage.objects.create(user=other, kind=AIUsage.Kind.CHAT, date=TODAY, count=1, input_tokens=100)
    with mock.patch("ai.services._client") as client, mock.patch("ai.quota.today", return_value=TODAY):
        res = client_for(user).post(PLAN, {"gym_days": ["mon", "thu"]}, format="json")
    assert res.status_code == 201 and res.json()["narrative"] == ""
    client.assert_not_called()


@override_settings(ANTHROPIC_API_KEY="test-key", PLAN_NARRATIVE_ENABLED=True, AI_DAILY_QUOTA_CHAT=0)
def test_enabled_narrative_is_throttled_to_10_per_hour(today_fixed):
    user = _user()
    api = client_for(user)
    with mock.patch("ai.services._client") as client:
        client.return_value.messages.create.return_value = _reply()
        texts = [api.post(PLAN, {"gym_days": ["mon", "thu"]}, format="json").json()["narrative"] for _ in range(11)]
    assert texts[:10] == ["Semana de trabajo."] * 10
    assert texts[10] == ""
    assert client.return_value.messages.create.call_count == 10


@override_settings(ANTHROPIC_API_KEY="test-key", PLAN_NARRATIVE_ENABLED=True)
def test_failed_call_refunds_the_quota(today_fixed):
    user = _user()
    with mock.patch("ai.services._client") as client:
        client.return_value.messages.create.side_effect = RuntimeError("caída")
        res = client_for(user).post(PLAN, {"gym_days": ["mon", "thu"]}, format="json")
    assert res.status_code == 201 and res.json()["narrative"] == ""
    assert AIUsage.objects.get(user=user, kind=AIUsage.Kind.CHAT).count == 0


@pytest.mark.django_db(transaction=True)
@override_settings(ANTHROPIC_API_KEY="test-key", PLAN_NARRATIVE_ENABLED=True)
def test_llm_call_happens_outside_the_plan_transaction(today_fixed):
    user = _user()
    seen = {}

    def create(**kwargs):
        seen["atomic"] = connection.in_atomic_block
        seen["saved"] = WeeklyPlan.objects.filter(profile=user.profile).exists()
        return _reply()

    with mock.patch("ai.services._client") as client:
        client.return_value.messages.create.side_effect = create
        res = client_for(user).post(PLAN, {"gym_days": ["mon", "thu"]}, format="json")
    assert res.status_code == 201
    assert seen == {"atomic": False, "saved": True}
