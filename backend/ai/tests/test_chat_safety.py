"""F3: con dolor, una lesión, un golpe en la cabeza, mareo o fiebre, el chat con IA pone la regla
de seguridad antes que cualquier consejo de carga.

Las frases son las mismas que `frontend/lib/chat-safety.test.ts` (el chat por reglas): las dos
listas de palabras tienen que decir lo mismo.
"""
import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.management import call_command

from ai import chat_safety, services
from coaching import redflags
from coaching.tests.helpers import client_for, make_user

URL = "/api/v1/ai/coach/chat"
ANNEX = Path(__file__).resolve().parents[2] / "knowledge_fightlab"

PHRASES = {
    "pain": [
        "me duele la rodilla después del sparring, ¿entreno hoy?",
        "Me duele el hombro",
        "tengo dolor en la espalda, ¿puedo entrenar fuerte?",
        "creo que me he lesionado el tobillo",
        "Me he hecho daño en la muñeca entrenando",
        "tengo una lesión en el codo",
        "me torcí el tobillo ayer",
        "noto un tirón en el isquio",
        "tengo molestias en la rodilla",
        "my knee hurts after sparring, should I train hard today?",
        "I have pain in my shoulder",
        "I think I injured my ankle",
        "I sprained my wrist yesterday",
        "my back is sore and stiff",
        "I pulled a muscle in my leg",
    ],
    "headBlow": [
        "me dieron un golpe en la cabeza en el sparring",
        "Recibí un golpe fuerte en la cabeza, ¿entreno hoy?",
        "me duele la cabeza después del sparring",
        "creo que tengo una conmoción",
        "me noquearon ayer",
        "I took a hit to the head in sparring",
        "I got knocked out last night",
        "I have a headache after sparring, can I train hard today?",
        "could it be a concussion?",
    ],
    "cardiac": [
        "me mareo cuando entreno fuerte",
        "estoy mareado, ¿entreno hoy?",
        "tengo dolor en el pecho al correr",
        "me desmayé en el entreno",
        "noto palpitaciones",
        "I feel dizzy, can I train hard today?",
        "I get chest pain when I run",
        "I nearly fainted at training",
        "I'm short of breath at rest",
    ],
    "illness": [
        "tengo fiebre, ¿entreno hoy?",
        "creo que tengo la gripe",
        "I have a fever, should I train today?",
        "I think I have the flu",
    ],
}

NOT_SAFETY = [
    "¿entreno fuerte hoy?",
    "¿cómo va mi carga?",
    "cómo voy",
    "¿cómo va mi peso?",
    "tengo agujetas",
    "no me duele nada, ¿entreno fuerte hoy?",
    "sin dolor, ¿entreno fuerte hoy?",
    "should I train hard today?",
    "what is my strain this week?",
    "I'm pain-free, should I train hard today?",
    "gracias",
]


@pytest.mark.parametrize("topic,phrase", [(t, p) for t, ps in PHRASES.items() for p in ps])
def test_detects_safety_messages_in_spanish_and_english(topic, phrase):
    assert chat_safety.detect_topic(phrase) == topic


@pytest.mark.parametrize("phrase", NOT_SAFETY)
def test_ordinary_questions_are_not_safety_messages(phrase):
    assert chat_safety.detect_topic(phrase) is None


def test_the_most_serious_topic_in_the_conversation_wins():
    messages = [
        {"role": "user", "content": "me duele la rodilla"},
        {"role": "assistant", "content": "Vale."},
        {"role": "user", "content": "y además me mareo"},
    ]
    assert chat_safety.conversation_topic(messages) == "cardiac"
    # Lo que dice el coach no cuenta: solo lo que escribe el atleta
    assert chat_safety.conversation_topic([{"role": "assistant", "content": "¿te duele algo?"}]) is None


def test_each_topic_uses_the_checkin_and_screening_rules():
    assert chat_safety.RULES["pain"] == (redflags.INJURY,)
    assert chat_safety.RULES["cardiac"] == (redflags.CARDIAC,)
    assert chat_safety.RULES["illness"] == (redflags.FEVER,)
    assert "combat-sports/stop-training-after-a-suspected-head-injury" in chat_safety.RULES["headBlow"]


def test_the_base_prompt_puts_safety_before_load_advice():
    prompt = services.COACH_SYSTEM
    assert "Safety comes first, before any load" in prompt
    assert "never tell them to train hard" in prompt


# --- de punta a punta, con el modelo de mentira ---------------------------------------------


@pytest.fixture
def knowledge(db):
    call_command("load_knowledge", stdout=io.StringIO())
    call_command("load_knowledge", "--dir", str(ANNEX), "--origin", "fightlab", stdout=io.StringIO())


@pytest.fixture
def fake_model(settings):
    settings.ANTHROPIC_API_KEY = "sk-test"
    with patch("ai.services.anthropic.Anthropic") as mock:
        yield mock.return_value.messages.create


def answer(create, text):
    create.return_value = SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason="end_turn")


@pytest.mark.django_db
def test_a_pain_message_puts_the_new_pain_rule_in_the_prompt_and_its_citation_survives(fake_model, knowledge):
    user = make_user()
    answer(fake_model, f"Hoy no cargues la rodilla. [[regla:{redflags.INJURY}]]")
    resp = client_for(user).post(
        URL,
        {"messages": [{"role": "user", "content": "me duele la rodilla después del sparring, ¿entreno hoy?"}],
         "context": {"semana_au": 900, "semana_vs_media_pct": 20}},
        format="json",
    )
    assert resp.status_code == 200
    system = fake_model.call_args.kwargs["system"]
    assert "new pain or an injury" in system
    assert f"[[regla:{redflags.INJURY}]]" in system
    # La nota va antes que las demás notas de seguridad y que cualquier consejo de carga
    assert "never tell them to train hard" in system.split("Safety (set by the server")[1]
    # El modelo la cita sin haberla buscado: el servidor la dio por recuperada
    assert [c["key"] for c in resp.data["citations"]] == [redflags.INJURY]
    assert f"[[regla:{redflags.INJURY}]]" in resp.data["reply"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "phrase,expected",
    [
        ("me dieron un golpe en la cabeza en el sparring", "blow to the head"),
        ("I feel dizzy, can I train hard today?", "dizziness"),
        ("tengo fiebre", "a fever"),
    ],
)
def test_other_topics_add_their_note(fake_model, knowledge, phrase, expected):
    answer(fake_model, "Hoy no.")
    client_for(make_user()).post(URL, {"messages": [{"role": "user", "content": phrase}], "context": {}}, format="json")
    system = fake_model.call_args.kwargs["system"]
    assert "Safety (set by the server" in system and expected in system


@pytest.mark.django_db
def test_an_ordinary_question_adds_no_note(fake_model, knowledge):
    answer(fake_model, "Día normal.")
    client_for(make_user()).post(URL, {"messages": [{"role": "user", "content": "¿entreno fuerte hoy?"}], "context": {}}, format="json")
    assert "Safety (set by the server" not in fake_model.call_args.kwargs["system"]


@pytest.mark.django_db
def test_without_a_safety_message_an_uncited_safety_rule_is_still_dropped(fake_model, knowledge):
    answer(fake_model, f"Vale. [[regla:{redflags.INJURY}]]")
    resp = client_for(make_user()).post(
        URL, {"messages": [{"role": "user", "content": "¿cómo voy?"}], "context": {}}, format="json"
    )
    assert resp.data["citations"] == []
