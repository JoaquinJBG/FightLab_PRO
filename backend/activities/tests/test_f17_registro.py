"""F17 (rama H): registro completo, guardado con motivo, historial y calendario del servidor,
detalle editable, récords y progreso por ejercicio."""
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.utils import timezone

from activities.models import Activity, SetLog
from profiles.models import UserProfile

from .test_sync_api import item, make_client

SYNC = "/api/v1/activities/sync"
LIST = "/api/v1/activities"
MADRID = ZoneInfo("Europe/Madrid")


@pytest.fixture
def client(db):
    cache.clear()
    return make_client("h@test.com")


def gym(cid, sets=None, **over):
    base = item(cid, kind="GYM", title="Torso", rpe=8, kcal=None, detail={"focus": "Torso"})
    base.update(over)
    if sets is not None:
        base["sets"] = sets
    return base


def s(ei, si, kg=None, reps=None, **over):
    row = {"exercise": "Press banca", "exercise_key": "cat:barbell-bench-press", "exercise_index": ei,
           "set_index": si, "weight_kg": kg, "reps": reps}
    row.update(over)
    return row


# ------------------------------------------------------------------ registro completo


@pytest.mark.django_db
def test_sync_keeps_everything_logged(client):
    sets = [
        s(0, 0, "40", 10, set_type="warmup", superset=1, notes="Agarre medio", rest_s=120),
        s(0, 1, "80", 6, rpe="8.5", superset=1, notes="Agarre medio", rest_s=120),
        s(0, 2, "60", 10, set_type="drop", rir=1, superset=1),
        {"exercise": "Remo con barra", "exercise_key": "cat:barbell-row", "exercise_index": 1, "set_index": 0,
         "weight_kg": "70", "reps": 8, "set_type": "dropset", "superset": 1},
        {"exercise": "Dominadas", "exercise_key": "custom:12", "exercise_index": 2, "set_index": 0,
         "weight_kg": None, "reps": 12, "set_type": "failure"},
    ]
    resp = client.post(SYNC, {"items": [gym("cid-h0000001", sets)]}, format="json")
    assert resp.data["created"] == 1, resp.data
    rows = list(SetLog.objects.order_by("exercise_index", "set_index"))
    assert [r.set_type for r in rows] == ["warmup", "normal", "drop", "drop", "failure"]
    assert rows[0].exercise_key == "cat:barbell-bench-press" and rows[4].exercise_key == "custom:12"
    assert rows[1].rpe == Decimal("8.5") and rows[2].rir == Decimal("1.0")
    assert [r.superset for r in rows] == [1, 1, 1, 1, None]
    assert rows[0].notes == "Agarre medio" and rows[0].rest_s == 120


@pytest.mark.django_db
@pytest.mark.parametrize("bad, field", [
    ({"exercise_key": "barbell-bench-press"}, "exercise_key"),
    ({"weight_kg": "9295"}, "weight_kg"),
    ({"reps": 1001}, "reps"),
    ({"set_type": "giant"}, "set_type"),
    ({"rpe": "11"}, "rpe"),
    ({"rest_s": 4000}, "rest_s"),
])
def test_an_impossible_set_rejects_the_session_with_its_reason(client, bad, field):
    resp = client.post(SYNC, {"items": [gym("cid-h0000002", [{**s(0, 0, "80", 5), **bad}])]}, format="json")
    result = resp.data["results"][0]
    assert result["status"] == "invalid"
    assert field in result["errors"]["sets"][0]
    assert Activity.objects.count() == 0


# ------------------------------------------------- guardar una sesión: 400 con el motivo


@pytest.mark.django_db
def test_post_one_session_creates_it_and_is_idempotent(client):
    body = gym("cid-h0000003", [s(0, 0, "80", 5)])
    first = client.post(LIST, body, format="json")
    assert first.status_code == 201, first.data
    assert first.data["status"] == "created" and first.data["id"]
    again = client.post(LIST, body, format="json")
    assert again.status_code == 200 and again.data["status"] == "exists" and again.data["id"] == first.data["id"]
    assert SetLog.objects.count() == 1


@pytest.mark.django_db
def test_post_one_session_answers_400_with_the_reason_and_saves_nothing(client):
    # El fallo F2: «9295,.» en el peso. Antes la serie se descartaba sin avisar.
    resp = client.post(LIST, gym("cid-h0000004", [s(0, 0, "80", 6), s(0, 1, "9295", 65)]), format="json")
    assert resp.status_code == 400
    assert "weight_kg" in resp.data["errors"]["sets"][1]
    assert Activity.objects.count() == 0 and SetLog.objects.count() == 0


@pytest.mark.django_db
def test_a_gym_session_whose_sets_would_be_dropped_is_refused(client):
    # Sin `sets`, las series de `detail.exercises` que no se pueden guardar ya no se pierden
    # en silencio: la sesión entera se rechaza con el motivo.
    detail = {"focus": None, "volume_kg": 610938, "exercises": [
        {"name": "Sentadilla", "sets": [{"kg": 92.5, "reps": 6}, {"kg": 9295, "reps": 65}]},
    ]}
    resp = client.post(LIST, gym("cid-h0000005", detail=detail), format="json")
    assert resp.status_code == 400
    assert "detail" in resp.data["errors"]


# ------------------------------------------------------- historial desde el servidor


def _act(profile, days_ago, kind="GYM", hour=18, **over):
    started = datetime.combine(timezone.localdate() - timedelta(days=days_ago), datetime.min.time(), MADRID)
    data = {"profile": profile, "kind": kind, "title": kind.title(), "started_at": started.replace(hour=hour),
            "duration_sec": 3600, "rpe": 7}
    data.update(over)
    return Activity.objects.create(**data)


@pytest.mark.django_db
def test_history_is_paginated_and_summarised(client):
    profile = UserProfile.objects.get(user__email="h@test.com")
    acts = [_act(profile, d) for d in range(5)]
    SetLog.objects.create(activity=acts[0], exercise="Press banca", exercise_index=0, set_index=0, weight_kg=80, reps=5)
    SetLog.objects.create(activity=acts[0], exercise="Press banca", exercise_index=0, set_index=1, weight_kg=80, reps=5)
    SetLog.objects.create(activity=acts[0], exercise="Dominadas", exercise_index=1, set_index=0, reps=10)
    _act(profile, 0, kind="MMA")

    page1 = client.get(LIST, {"kind": "GYM", "limit": 2, "offset": 0})
    page2 = client.get(LIST, {"kind": "GYM", "limit": 2, "offset": 2})
    page3 = client.get(LIST, {"kind": "GYM", "limit": 2, "offset": 4})
    ids = [a["id"] for a in page1.data + page2.data + page3.data]
    assert ids == [a.id for a in acts]
    assert page1.data[0]["summary"] == {"exercises": 2, "sets": 3, "volume_kg": 800.0}
    assert client.get(LIST, {"offset": "x"}).status_code == 400

    today = timezone.localdate()
    ranged = client.get(LIST, {"kind": "GYM", "from": (today - timedelta(days=1)).isoformat(),
                               "to": today.isoformat(), "tz": "Europe/Madrid"})
    assert [a["id"] for a in ranged.data] == [acts[0].id, acts[1].id]


@pytest.mark.django_db
def test_calendar_marks_the_trained_days_of_the_month(client):
    profile = UserProfile.objects.get(user__email="h@test.com")
    _act(profile, 0)
    _act(profile, 0, kind="MMA")
    # 00:30 en Madrid: en UTC es el día anterior, pero cuenta en su día local.
    late = _act(profile, 1, hour=0)
    late.started_at = late.started_at.replace(minute=30)
    late.save()
    month = timezone.localdate().strftime("%Y-%m")
    resp = client.get(f"{LIST}/calendar", {"month": month, "tz": "Europe/Madrid"})
    assert resp.status_code == 200
    days = resp.data["days"]
    today = timezone.localdate()
    assert days[today.isoformat()] == {"GYM": 1, "MMA": 1}
    if (today - timedelta(days=1)).month == today.month:
        assert days[(today - timedelta(days=1)).isoformat()] == {"GYM": 1}
    assert client.get(f"{LIST}/calendar", {"month": "2026-13"}).status_code == 400


# ------------------------------------------------------------ detalle, editar y borrar


@pytest.mark.django_db
def test_detail_edit_and_delete(client):
    created = client.post(LIST, gym("cid-h0000006", [s(0, 0, "80", 5), s(0, 1, "80", 5)]), format="json")
    pk = created.data["id"]
    detail = client.get(f"{LIST}/{pk}")
    assert detail.status_code == 200
    assert [(x["weight_kg"], x["reps"]) for x in detail.data["sets"]] == [(80.0, 5), (80.0, 5)]

    edit = client.patch(f"{LIST}/{pk}", {"title": "Torso pesado", "rpe": 9, "note": "Buen día",
                                         "sets": [s(0, 0, "82.5", 5, notes="Más")]}, format="json")
    assert edit.status_code == 200, edit.data
    act = Activity.objects.get(pk=pk)
    assert (act.title, act.rpe, act.note) == ("Torso pesado", 9, "Buen día")
    assert list(act.sets.values_list("weight_kg", "reps", "notes")) == [(Decimal("82.50"), 5, "Más")]
    assert act.detail["volume_kg"] == 412.5 and "exercises" not in act.detail

    bad = client.patch(f"{LIST}/{pk}", {"sets": [s(0, 0, "2000", 5)]}, format="json")
    assert bad.status_code == 400 and "weight_kg" in bad.data["sets"][0]
    assert act.sets.get().weight_kg == Decimal("82.50")

    other = make_client("otro@test.com")
    assert other.get(f"{LIST}/{pk}").status_code == 404
    assert other.patch(f"{LIST}/{pk}", {"title": "x"}, format="json").status_code == 404
    assert client.delete(f"{LIST}/{pk}").status_code == 204
    assert not Activity.objects.filter(pk=pk).exists()


# ------------------------------------------------------------ récords y progreso


def _session(client, cid, days_ago, sets):
    started = (timezone.now() - timedelta(days=days_ago)).isoformat()
    resp = client.post(LIST, gym(cid, sets, started_at=started), format="json")
    assert resp.status_code == 201, resp.data


@pytest.mark.django_db
def test_records_and_progress_per_exercise(client):
    key = "cat:barbell-bench-press"
    _session(client, "cid-h0000010", 10, [s(0, 0, "100", 1, set_type="warmup"), s(0, 1, "80", 5), s(0, 2, "80", 5)])
    _session(client, "cid-h0000011", 3, [s(0, 0, "85", 3, rir=0), s(0, 1, "70", 10)])
    # Lo antiguo, sin clave, cuenta por el nombre.
    _session(client, "cid-h0000012", 1, [{"exercise": "Curl bíceps", "exercise_index": 0, "set_index": 0,
                                          "weight_kg": "15", "reps": 12}])

    resp = client.get("/api/v1/gym/records", {"exercise": key})
    assert resp.status_code == 200
    rec = resp.data["records"][key]
    # El calentamiento de 100 kg no es un récord.
    assert rec["max_weight_kg"] == 85.0
    assert rec["best_e1rm_kg"] == 93.5  # 85 × (1 + 3/30); 70 × 10 da 93.33
    assert rec["best_set_volume_kg"] == 700.0
    assert rec["best_session_volume_kg"] == 955.0
    assert {r["weight_kg"]: r["reps"] for r in rec["reps_by_weight"]} == {85.0: 3, 80.0: 5, 70.0: 10}

    all_records = client.get("/api/v1/gym/records").data["records"]
    assert set(all_records) == {key, "name:curl bíceps"}
    assert all_records["name:curl bíceps"]["name"] == "Curl bíceps"

    progress = client.get("/api/v1/gym/progress", {"exercise": key})
    assert progress.status_code == 200
    points = progress.data["sessions"]
    assert [p["max_weight_kg"] for p in points] == [80.0, 85.0]
    assert [p["volume_kg"] for p in points] == [800.0, 955.0]
    # La mejor serie es la de mayor e1RM.
    assert points[1]["best_set"] == {"weight_kg": 85.0, "reps": 3}
    assert points[1]["e1rm_kg"] == 93.5
    assert progress.data["convention"] == "coach"
    assert client.get("/api/v1/gym/progress").status_code == 400
