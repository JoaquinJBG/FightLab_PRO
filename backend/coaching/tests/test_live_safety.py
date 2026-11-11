"""F26: un golpe en la cabeza o una lesión cuentan al momento en el plan ya hecho y en Hoy, sin
rehacer el plan. El contacto vuelve solo con el alta de un clínico (la vuelta por fases de la
tarjeta del golpe). Datos inventados."""
from datetime import timedelta

import pytest

from coaching.combat import RETURN_STEPS_RULE
from coaching.models import HeadImpact
from coaching.services import injury_add

from .helpers import TODAY, client_for, make_user, today_fixed  # noqa: F401

pytestmark = pytest.mark.django_db

PLAN = "/api/v1/coach/plan"
TODAY_URL = "/api/v1/coach/today"
WEEKDAY = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")[TODAY.weekday()]
CONTACT = {"sparring_hard", "sparring_light", "rolling_hard", "rolling_flow"}


def active_plan(client, **body):
    plan = client.post(PLAN, body, format="json").json()
    client.post(f"{PLAN}/{plan['id']}/apply")
    return client.get(PLAN).json()["active"]


def mma_entry(plan):
    return next(e for e in plan["training_schedule"] if e["kind"] == "mma")


def test_a_head_blow_blocks_contact_in_the_active_plan_without_redoing_it(today_fixed):
    user = make_user()
    client = client_for(user)
    before = active_plan(client, gym_days=["mon", "fri"], mma_days=[WEEKDAY])
    assert CONTACT <= {w["key"] for w in mma_entry(before)["allowed"]}
    assert before["live"] == {"changed": False, "no_contact": False, "no_training": False, "return_rule_key": None}

    impact = HeadImpact.objects.create(profile=user.profile, occurred_on=TODAY - timedelta(days=1), symptoms=True)
    after = client.get(PLAN).json()["active"]
    assert after["id"] == before["id"]  # el mismo plan, sin rehacer
    entry = mma_entry(after)
    assert not CONTACT & {w["key"] for w in entry["allowed"]}
    assert all("no_contact" in w["blocked_by"] for w in entry["excluded"] if w["key"] in CONTACT)
    assert after["live"]["changed"] and after["live"]["no_contact"]
    # La vuelta al contacto por fases, con su chip de evidencia
    assert after["live"]["return_rule_key"] == RETURN_STEPS_RULE
    assert RETURN_STEPS_RULE in {r["key"] for r in after["rules"]}
    assert "head_blow_no_contact" in {r["code"] for r in after["safety_reasons"]}

    # Hoy: el día de MMA sale con el contacto bloqueado
    day = client.get(TODAY_URL).json()["plan"]
    assert day["no_contact"] is True
    assert next(e for e in day["entries"] if e["kind"] == "mma")["contact_blocked"] is True

    # Solo el alta de un clínico lo quita (la tarjeta del golpe: vuelta por fases)
    impact.cleared_on = TODAY
    impact.cleared_by = "Dra. Prueba"
    impact.save()
    cleared = client.get(PLAN).json()["active"]
    assert CONTACT <= {w["key"] for w in mma_entry(cleared)["allowed"]}
    assert cleared["live"]["no_contact"] is False and cleared["live"]["return_rule_key"] is None
    day = client.get(TODAY_URL).json()["plan"]
    assert day["no_contact"] is False
    assert next(e for e in day["entries"] if e["kind"] == "mma")["contact_blocked"] is False


def test_a_head_blow_without_symptoms_does_not_block(today_fixed):
    user = make_user()
    client = client_for(user)
    active_plan(client, gym_days=["mon", "fri"], mma_days=[WEEKDAY])
    HeadImpact.objects.create(profile=user.profile, occurred_on=TODAY, symptoms=False)
    plan = client.get(PLAN).json()["active"]
    assert CONTACT <= {w["key"] for w in mma_entry(plan)["allowed"]}
    assert plan["live"]["no_contact"] is False


def test_an_injury_saved_after_the_plan_pauses_only_the_lifts_it_affects(today_fixed):
    user = make_user()
    client = client_for(user)
    before = active_plan(client, gym_days=[WEEKDAY, "mon" if WEEKDAY != "mon" else "tue"])
    squats = [i for s in before["sessions"] for i in s["items"] if i["exercise"] == "Sentadilla"]
    assert squats and all(i["action"] != "paused" for i in squats)

    injured = ["Sentadilla", "Peso muerto rumano"]
    injury_add(user.profile, area="rodilla", status="active", since=TODAY, exercises=injured)
    after = client.get(PLAN).json()["active"]
    items = [i for s in after["sessions"] for i in s["items"]]
    squat = next(i for i in items if i["exercise"] == "Sentadilla")
    assert squat["action"] == "paused" and squat["load_kg"] is None and squat["live"] is True
    assert squat["reasons"][0]["code"] == "injury_unassessed"
    assert squat["rule_key"] == "recovery-habits/some-pain-during-exercise-is-acceptable-in-chronic-assessed-pain"
    # El resto del entreno sigue: no se bloquea todo
    others = [i for i in items if i["exercise"] not in injured]
    assert others and all(i["action"] != "paused" for i in others)
    assert after["live"]["changed"] is True and after["live"]["no_training"] is False
    assert "injury_unassessed" in {r["code"] for r in after["safety_reasons"]}

    # Hoy: la sesión de gimnasio de hoy dice qué va en pausa
    day = client.get(TODAY_URL).json()["plan"]
    gym = next(e for e in day["entries"] if e["kind"] == "gym")
    assert gym["paused"] and set(gym["paused"]) <= set(injured)
