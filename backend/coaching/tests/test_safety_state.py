"""R4-10 y R4-13: una sola fuente de verdad del estado de seguridad (`coaching.safety_state`).

Tres veces una pantalla dijo «Listo para entrenar» u ofreció «Intenso» tras un golpe en la cabeza.
Con un golpe activo, y con una lesión que nadie ha valorado, se recorren todos los sitios del
servidor que lo leen: `/coach/safety` (Hoy, Inicio, Coach, Carga y Deportes), el plan y Mi
rutina, Hoy, el aviso de sesión vigorosa y el texto de sistema del chat con IA. Datos inventados.
"""
from datetime import timedelta

import pytest

from ai import services as ai_services
from ai.views import _safety
from coaching import rules, safety_state
from coaching.models import HeadImpact
from coaching.services import injury_add

from .helpers import TODAY, client_for, make_user, today_fixed  # noqa: F401

pytestmark = pytest.mark.django_db

SAFETY = "/api/v1/coach/safety"
PLAN = "/api/v1/coach/plan"
TODAY_URL = "/api/v1/coach/today"
CHECK = "/api/v1/coach/session-check"
WEEKDAY = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")[TODAY.weekday()]
HARD = (rules.VIGOROUS, rules.MAXIMAL)


def head_blow(user):
    HeadImpact.objects.create(profile=user.profile, occurred_on=TODAY - timedelta(days=1), symptoms=True)


def injury(user):
    injury_add(user.profile, area="rodilla derecha", since=TODAY - timedelta(days=2))


def _plan(client):
    plan = client.post(PLAN, {"gym_days": ["mon", "fri"], "mma_days": [WEEKDAY]}, format="json").json()
    client.post(f"{PLAN}/{plan['id']}/apply")


def test_without_anything_active_the_state_is_ok(today_fixed):
    user = make_user()
    state = client_for(user).get(SAFETY).json()["state"]
    assert state == {"level": "ok", "no_contact": False, "no_training": False,
                     "vigorous": {"allowed": True, "blocked_by": []}, "active": []}


@pytest.mark.parametrize(
    ("make", "flag", "kind", "code", "until"),
    [
        (head_blow, "head_blow_return", "head_blow", "head_blow_no_contact", "clearance"),
        (injury, "injury_unassessed", "injury", "injury_unassessed", "assessed"),
    ],
    ids=["golpe", "lesion"],
)
def test_every_screen_reads_the_same_state(today_fixed, make, flag, kind, code, until):
    user = make_user()
    client = client_for(user)
    _plan(client)
    make(user)

    # /coach/safety: precaución, nada vigoroso, con su motivo, vigencia y regla
    state = client.get(SAFETY).json()["state"]
    assert state["level"] == "caution"
    assert state["vigorous"] == {"allowed": False, "blocked_by": [flag]}
    item = next(a for a in state["active"] if a["kind"] == kind)
    assert item["code"] == code and item["until"] == until and item["rule_key"] and item["text"]
    assert item["since"] == (TODAY - timedelta(days=1 if kind == "head_blow" else 2)).isoformat()

    # Plan y Mi rutina (el plan activo con los bloqueos de hoy): nada vigoroso en MMA ni en cardio
    plan = client.get(PLAN).json()["active"]
    mma = next(e for e in plan["training_schedule"] if e["kind"] == "mma")
    assert all(w["intensity"] not in HARD for w in mma["allowed"])
    assert all(o["intensity"] not in HARD for o in plan["cardio"]["options"])
    assert all(flag in w["blocked_by"] for w in plan["cardio"]["excluded"] if w["intensity"] in HARD)

    # Aviso al registrar algo vigoroso (Deportes: comba, HIIT; MMA duro)
    for params in ({"kind": "SPORT", "sport_key": "rope"}, {"kind": "SPORT", "sport_key": "run", "sport_format": "hiit"},
                   {"kind": "MMA", "work_type": "Pads", "art": "Muay Thai", "rpe": 9}):
        check = client.get(CHECK, params).json()
        assert check["warn"] is True and flag in check["flags"], params
        assert check["reasons"], params

    # Chat con IA: el texto de sistema lleva el estado de hoy (nunca «listo», nada vigoroso)
    _, notes, _ = _safety(user)
    readiness = ai_services.readiness_note("caution", [flag])
    assert readiness in notes
    assert "Never say they are ready to train hard" in readiness

    # El mismo objeto en Python: una sola regla
    live = safety_state.for_user(user, TODAY)
    assert live.vigorous_blocked_by == [flag] and live.level == "caution"
    assert live.blocked_by("hiit") == rules.blocked_by("hiit", live.flags, live.no_contact, live.injured)


def test_a_managed_injury_is_caution_but_keeps_vigorous_work(today_fixed):
    """Decisión (R4-13): una lesión que ya lleva un profesional limita lo que él diga (sus ejercicios
    en pausa), no todo lo vigoroso; pero ya no es «Listo para entrenar»."""
    user = make_user()
    injury_add(user.profile, area="hombro", professional="Fisio Inventado")
    state = client_for(user).get(SAFETY).json()["state"]
    assert state["level"] == "caution" and state["vigorous"]["allowed"] is True
    assert [a["until"] for a in state["active"] if a["kind"] == "injury"] == ["cleared"]


def test_stop_and_consult_is_level_stop(today_fixed):
    user = make_user(screening={"bp_systolic": 200, "bp_diastolic": 120})
    state = client_for(user).get(SAFETY).json()["state"]
    assert state["level"] == "stop" and state["no_training"] is True
    assert state["vigorous"]["allowed"] is False
    assert {a["kind"] for a in state["active"]} == {"stop"}
    _, notes, _ = _safety(user)
    assert ai_services.readiness_note("stop", []) in notes


def test_clearance_brings_everything_back(today_fixed):
    user = make_user()
    head_blow(user)
    HeadImpact.objects.filter(profile=user.profile).update(cleared_on=TODAY, cleared_by="Dra. Prueba")
    state = client_for(user).get(SAFETY).json()["state"]
    assert state["level"] == "ok" and state["vigorous"]["allowed"] is True
