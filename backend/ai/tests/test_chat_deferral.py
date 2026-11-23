"""La línea de derivación con `refer_gp` la añade el backend al final de la respuesta (spec §7.4)."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from coaching.bridge import reason_texts
from coaching.tests.helpers import client_for, make_user

PAYLOAD = {"messages": [{"role": "user", "content": "¿Cómo voy?"}], "context": {"semana_au": 1200}}
URL = "/api/v1/ai/coach/chat"

pytestmark = pytest.mark.django_db


def model_says(text):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason="end_turn")


@pytest.fixture(autouse=True)
def fake_model(settings):
    settings.ANTHROPIC_API_KEY = "sk-test"
    with patch("ai.services.anthropic.Anthropic") as mock:
        mock.return_value.messages.create.return_value = model_says("Sigue así, vas bien.")
        yield mock.return_value.messages.create


def chat(user, language=None):
    if language:
        user.profile.language = language
        user.profile.save()
    return client_for(user).post(URL, PAYLOAD, format="json")


def test_refer_gp_appends_the_literal_deferral_line_in_spanish():
    resp = chat(make_user(screening={"scoff_yes_count": 3}))  # TCA positivo → refer_gp
    assert resp.status_code == 200
    assert resp.data["reply"] == "Sigue así, vas bien.\n\n" + reason_texts.DEFERRAL_LINE["es"]


def test_the_line_follows_the_profile_language():
    resp = chat(make_user(screening={"scoff_yes_count": 3}), language="en")
    assert resp.data["reply"].endswith(reason_texts.DEFERRAL_LINE["en"])
    assert resp.data["reply"].startswith("Sigue así")  # el texto del modelo no se toca


@pytest.mark.parametrize(
    "kw",
    [
        dict(profile={"date_of_birth": "2012-01-01"}),  # menor de 18
        dict(profile={"gender": "FEMALE"}, screening={"menstrual": "absent"}),
        dict(screening={"parq_any_yes": True, "parq_followup_yes": True}),
        dict(screening={"cardiac_symptoms": True}),
    ],
)
def test_every_refer_gp_flag_adds_the_line(kw):
    from datetime import date

    if "profile" in kw and "date_of_birth" in kw["profile"]:
        kw = {**kw, "profile": {"date_of_birth": date(2012, 1, 1)}}
    assert chat(make_user(**kw)).data["reply"].endswith(reason_texts.DEFERRAL_LINE["es"])


def test_without_refer_gp_the_reply_is_untouched():
    resp = chat(make_user())
    assert resp.data["reply"] == "Sigue así, vas bien."


def test_the_line_is_not_added_twice_if_the_model_already_wrote_it(fake_model):
    fake_model.return_value = model_says("Ojo.\n\n" + reason_texts.DEFERRAL_LINE["es"])
    reply = chat(make_user(screening={"scoff_yes_count": 3})).data["reply"]
    assert reply.count(reason_texts.DEFERRAL_LINE["es"]) == 1


def test_an_athlete_whose_profile_the_engine_cannot_read_gets_no_line_and_no_error():
    user = make_user()
    with patch("coaching.services.safety_for", side_effect=ValueError("boom")):
        resp = chat(user)
    assert resp.status_code == 200 and resp.data["reply"] == "Sigue así, vas bien."
