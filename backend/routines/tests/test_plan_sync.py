"""«Mi rutina» como carpeta de rutinas generadas por el plan por reglas (F17 R, punto 5).

- Aplicar un plan y sincronizar crea una rutina por sesión (A, B) en la carpeta del plan, con las
  series, el rango, la carga y el RIR del plan.
- Si el usuario ha editado una rutina generada, regenerar no la pisa sin avisar: `409 edited`, y
  luego `keep` (se queda la suya y se añade la nueva) u `overwrite`.
- Con `no_training` no se regenera; las lesiones del plan (ejercicio cambiado) llegan con su nota.
- Empezar una rutina con un ejercicio en pausa por lesión lo avisa en `safety.paused`.
"""
from datetime import date

import pytest

from coaching.models import WeeklyPlan
from coaching.services import screening_set
from coaching.tests.helpers import client_for, make_user, today_fixed  # noqa: F401
from routines.models import Routine, RoutineFolder

from .helpers import PLAN_ROUTINES, ROUTINES

pytestmark = pytest.mark.django_db

SYNC = f"{PLAN_ROUTINES}/sync"


def item(name, sets=3, rep_range=(8, 12), load=None, action="no_data", swapped_from=None, reasons=()):
    return {
        "exercise": name, "pattern": "legs", "sets": sets, "sets_basis": "coach_convention", "sets_rule_key": None,
        "rep_range": list(rep_range), "load_kg": load, "action": action, "rule_key": None,
        "reasons": list(reasons), "swapped_from": swapped_from,
    }


def session(key, items, rir=(1, 3)):
    return {"key": key, "kind": "gym", "items": items, "rule_key": None,
            "effort": {"rir": list(rir), "rule_key": "strength-hypertrophy/target-reps-in-reserve"}}


def active_plan(user, sessions=None, **over):
    sessions = sessions or [
        session("A", [item("Sentadilla", load=80.0, action="progress"), item("Press banca", 3, (6, 10), 60.0),
                      item("Remo con barra")]),
        session("B", [item("Peso muerto rumano"), item("Press militar", 0), item("Jalón al pecho")]),
    ]
    WeeklyPlan.objects.filter(profile=user.profile, status="active").update(status="superseded")
    return WeeklyPlan.objects.create(
        profile=user.profile, week_start=date(2026, 10, 26), status="active", sessions=sessions, **over
    )


def test_no_active_plan_is_409(today_fixed):
    user = make_user()
    client = client_for(user)
    assert client.get(PLAN_ROUTINES).data["plan_id"] is None
    resp = client.post(SYNC, {}, format="json")
    assert resp.status_code == 409 and resp.data["code"] == "no_active_plan"


def test_sync_creates_one_routine_per_session(today_fixed):
    user = make_user()
    plan = active_plan(user)
    client = client_for(user)
    before = client.get(PLAN_ROUTINES).data
    assert before["plan_id"] == plan.id and before["in_sync"] is False

    resp = client.post(SYNC, {}, format="json")
    assert resp.status_code == 200, resp.data
    data = resp.data
    assert data["in_sync"] is True
    folder = RoutineFolder.objects.get(profile=user.profile, kind="plan")
    assert data["folder"]["id"] == folder.id
    routines = list(Routine.objects.filter(folder=folder).order_by("order"))
    assert [r.source for r in routines] == ["plan", "plan"]
    assert [r.source_ref for r in routines] == [f"plan:{plan.id}:A", f"plan:{plan.id}:B"]

    start = client.get(f"{ROUTINES}/{routines[0].id}/start").data
    squat, bench, row = start["exercises"]
    assert squat["exercise_key"] == "cat:barbell-squat" and squat["name"] == "Sentadilla"
    assert len(squat["sets"]) == 3
    assert squat["sets"][0] == {"set_type": "normal", "reps": 8, "reps_max": 12, "weight_kg": 80.0, "rpe": None, "rir": 3.0}
    assert bench["sets"][0]["reps"] == 6 and bench["sets"][0]["weight_kg"] == 60.0
    assert row["sets"][0]["weight_kg"] is None  # sin registros: sin carga inventada
    assert squat["rest_s"] == 120
    # Un ejercicio con 0 series (todos los del patrón en pausa) no entra en la rutina.
    b = client.get(f"{ROUTINES}/{routines[1].id}").data
    assert [e["name"] for e in b["exercises"]] == ["Peso muerto rumano", "Jalón al pecho"]


def test_resync_same_plan_is_idempotent(today_fixed):
    user = make_user()
    active_plan(user)
    client = client_for(user)
    client.post(SYNC, {}, format="json")
    client.post(SYNC, {}, format="json")
    assert Routine.objects.filter(profile=user.profile).count() == 2
    assert RoutineFolder.objects.filter(profile=user.profile, kind="plan").count() == 1


def test_new_plan_regenerates_unedited_routines_without_asking(today_fixed):
    user = make_user()
    active_plan(user)
    client = client_for(user)
    client.post(SYNC, {}, format="json")
    plan2 = active_plan(user, sessions=[session("A", [item("Prensa")]), session("B", [item("Dominadas")])])
    assert client.get(PLAN_ROUTINES).data["in_sync"] is False
    resp = client.post(SYNC, {}, format="json")
    assert resp.status_code == 200
    refs = sorted(Routine.objects.filter(profile=user.profile).values_list("source_ref", flat=True))
    assert refs == [f"plan:{plan2.id}:A", f"plan:{plan2.id}:B"]


def test_edited_routine_is_never_lost_silently(today_fixed):
    user = make_user()
    active_plan(user)
    client = client_for(user)
    client.post(SYNC, {}, format="json")
    a = Routine.objects.get(profile=user.profile, source_ref__endswith=":A")
    client.patch(f"{ROUTINES}/{a.id}", {"notes": "Mi cambio"}, format="json")
    status = client.get(PLAN_ROUTINES).data
    assert status["edited"] == [a.id]

    plan2 = active_plan(user, sessions=[session("A", [item("Prensa")]), session("B", [item("Dominadas")])])
    resp = client.post(SYNC, {}, format="json")
    assert resp.status_code == 409
    assert resp.data["code"] == "edited"
    assert [r["id"] for r in resp.data["routines"]] == [a.id]
    assert Routine.objects.filter(pk=a.id).exists()

    # «Mantener»: la editada se queda (ya como rutina del usuario) y llegan las nuevas.
    resp = client.post(SYNC, {"on_edited": "keep"}, format="json")
    assert resp.status_code == 200
    kept = Routine.objects.get(pk=a.id)
    assert kept.notes == "Mi cambio" and kept.source == "user"
    assert kept.folder.kind == "plan"
    refs = set(Routine.objects.filter(profile=user.profile, source="plan").values_list("source_ref", flat=True))
    assert refs == {f"plan:{plan2.id}:A", f"plan:{plan2.id}:B"}


def test_overwrite_replaces_the_edited_routine(today_fixed):
    user = make_user()
    active_plan(user)
    client = client_for(user)
    client.post(SYNC, {}, format="json")
    a = Routine.objects.get(profile=user.profile, source_ref__endswith=":A")
    client.patch(f"{ROUTINES}/{a.id}", {"title": "Otra"}, format="json")
    active_plan(user, sessions=[session("A", [item("Prensa")])])
    assert client.post(SYNC, {"on_edited": "overwrite"}, format="json").status_code == 200
    assert not Routine.objects.filter(pk=a.id).exists()
    assert Routine.objects.filter(profile=user.profile).count() == 1


def test_bad_on_edited_is_400(today_fixed):
    user = make_user()
    assert client_for(user).post(SYNC, {"on_edited": "maybe"}, format="json").status_code == 400


def test_no_training_blocks_regeneration(today_fixed):
    user = make_user()
    active_plan(user)
    screening_set(user.profile, "bp_systolic", 185, origin="checkin")
    resp = client_for(user).post(SYNC, {}, format="json")
    assert resp.status_code == 409
    assert resp.data["code"] == "no_training" and resp.data["reasons"]
    assert not Routine.objects.filter(profile=user.profile).exists()


def test_swapped_lift_keeps_its_injury_note(today_fixed):
    user = make_user()
    reason = {"code": "injury_unassessed", "rule_key": None, "params": {"area": "rodilla"}, "original_text": ""}
    active_plan(user, sessions=[session("A", [item("Prensa", swapped_from="Sentadilla", reasons=[reason])])])
    client = client_for(user)
    client.post(SYNC, {}, format="json")
    routine = Routine.objects.get(profile=user.profile)
    ex = client.get(f"{ROUTINES}/{routine.id}").data["exercises"][0]
    assert "Sentadilla" in ex["notes"]


def test_start_warns_about_paused_lift(today_fixed):
    user = make_user(injuries=[{"area": "rodilla", "status": "active", "exercises": ["Sentadilla"]}])
    client = client_for(user)
    body = {"title": "Pierna", "exercises": [
        {"exercise_key": "cat:barbell-squat", "name": "Sentadilla", "sets": [{"reps": 5}]},
        {"exercise_key": "cat:leg-curl", "name": "Curl femoral", "sets": [{"reps": 10}]},
    ]}
    rid = client.post(ROUTINES, body, format="json").data["id"]
    safety = client.get(f"{ROUTINES}/{rid}/start").data["safety"]
    assert [p["name"] for p in safety["paused"]] == ["Sentadilla"]
    assert safety["paused"][0]["reasons"][0]["code"] == "injury_unassessed"
    assert safety["blocked"] is False


def test_start_clean_profile_has_no_warnings(today_fixed):
    client = client_for(make_user())
    rid = client.post(ROUTINES, {"title": "X", "exercises": []}, format="json").data["id"]
    assert client.get(f"{ROUTINES}/{rid}/start").data["safety"] == {"blocked": False, "reasons": [], "paused": []}


def test_start_reports_no_training(today_fixed):
    user = make_user(screening={"bp_systolic": 185, "bp_diastolic": 80})
    client = client_for(user)
    rid = client.post(ROUTINES, {"title": "X", "exercises": []}, format="json").data["id"]
    safety = client.get(f"{ROUTINES}/{rid}/start").data["safety"]
    assert safety["blocked"] is True and safety["reasons"]
