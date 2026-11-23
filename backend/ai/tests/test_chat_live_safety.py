"""F26 en el chat con IA: un golpe en la cabeza activo va antes que todo, y las lesiones guardadas
(las del perfil y la que el atleta cuenta en «Contarle a mi coach») llegan al texto de sistema con
su regla, que el modelo puede citar sin buscarla."""
from datetime import timedelta

import pytest
from django.utils import timezone

from ai import services
from coaching.models import HeadImpact
from coaching.services import injury_add
from coaching.tests.helpers import client_for, make_user
from userstate.models import UserState

from .test_chat_safety import answer, fake_model, knowledge  # noqa: F401

URL = "/api/v1/ai/coach/chat"
pytestmark = pytest.mark.django_db


def ask(user, text):
    return client_for(user).post(URL, {"messages": [{"role": "user", "content": text}], "context": {}}, format="json")


def test_an_active_head_blow_comes_first_and_its_rules_can_be_cited(fake_model, knowledge):  # noqa: F811
    user = make_user()
    HeadImpact.objects.create(profile=user.profile, occurred_on=timezone.localdate() - timedelta(days=1), symptoms=True)
    answer(fake_model, f"Hoy nada de contacto. [[regla:{services.NO_CONTACT_RULES[1]}]]")
    resp = ask(user, "¿entreno fuerte hoy?")
    system = fake_model.call_args.kwargs["system"]
    assert "before any load, intensity or readiness advice" in system
    assert "return-to-contact-follows-a-graded-clinician-supervised-plan" in system
    # La vuelta por fases se puede citar sin buscarla
    assert [c["key"] for c in resp.data["citations"]] == [services.NO_CONTACT_RULES[1]]


def test_a_cleared_head_blow_lifts_the_note(fake_model, knowledge):  # noqa: F811
    user = make_user()
    today = timezone.localdate()
    HeadImpact.objects.create(profile=user.profile, occurred_on=today, symptoms=True, cleared_on=today)
    answer(fake_model, "Vale.")
    ask(user, "¿entreno fuerte hoy?")
    assert "return-to-contact" not in fake_model.call_args.kwargs["system"]


def test_saved_injuries_from_the_profile_and_the_coach_memory_reach_the_prompt(fake_model, knowledge):  # noqa: F811
    user = make_user()
    injury_add(user.profile, area="hombro izquierdo", status="active", exercises=["Press militar"])
    UserState.objects.create(
        profile=user.profile, key="coach_memory", value={"lesion": "Rodilla derecha tras sparring"},
        updated_at=timezone.now(),
    )
    answer(fake_model, f"Con la rodilla, nada de carga ahí. [[regla:{services.INJURY_RULE}]]")
    resp = ask(user, "me duele la rodilla, ¿entreno hoy?")
    system = fake_model.call_args.kwargs["system"]
    assert "hombro izquierdo" in system and "Rodilla derecha tras sparring" in system
    assert "Do not stop the rest of the training" in system
    assert "new pain or an injury" in system  # el dolor del mensaje, además de la lesión guardada
    assert [c["key"] for c in resp.data["citations"]] == [services.INJURY_RULE]


def test_without_injuries_or_blows_there_is_no_safety_note(fake_model, knowledge):  # noqa: F811
    answer(fake_model, "Vale.")
    ask(make_user(), "¿cómo voy?")
    system = fake_model.call_args.kwargs["system"]
    assert "active injury" not in system and "Safety (set by the server" not in system
