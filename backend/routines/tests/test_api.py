"""API de rutinas y carpetas (F17 R): CRUD, duplicar, mover, reordenar y `start`."""
import pytest
from rest_framework.test import APIClient

from routines.models import Routine, RoutineExercise, RoutineFolder

from .helpers import FOLDERS, ROUTINES, bench, make_client, routine_body, row

pytestmark = pytest.mark.django_db


@pytest.fixture
def me():
    return make_client()


def create(client, **over):
    resp = client.post(ROUTINES, routine_body(**over), format="json")
    assert resp.status_code == 201, resp.data
    return resp.data


# ---------------------------------------------------------------- auth y aislamiento


def test_requires_auth():
    assert APIClient().get(ROUTINES).status_code == 401
    assert APIClient().get(FOLDERS).status_code == 401


def test_another_user_cannot_see_or_touch(me):
    _, client = me
    routine = create(client)
    _, other = make_client()
    assert other.get(ROUTINES).data == []
    assert other.get(f"{ROUTINES}/{routine['id']}").status_code == 404
    assert other.get(f"{ROUTINES}/{routine['id']}/start").status_code == 404
    assert other.delete(f"{ROUTINES}/{routine['id']}").status_code == 404
    assert other.post(f"{ROUTINES}/{routine['id']}/duplicate").status_code == 404
    folder = client.post(FOLDERS, {"name": "Mía"}, format="json").data
    assert other.patch(f"{ROUTINES}/{routine['id']}", {"folder": folder["id"]}, format="json").status_code == 404
    # Ni mover una rutina propia a una carpeta ajena.
    _, client2 = make_client()
    mine = create(client2)
    resp = client2.patch(f"{ROUTINES}/{mine['id']}", {"folder": folder["id"]}, format="json")
    assert resp.status_code == 400


# ---------------------------------------------------------------- CRUD


def test_create_and_read_routine(me):
    _, client = me
    data = create(client)
    assert data["title"] == "Torso A"
    assert [e["exercise_key"] for e in data["exercises"]] == ["cat:barbell-bench-press", "cat:barbell-row"]
    assert [e["order"] for e in data["exercises"]] == [0, 1]
    first = data["exercises"][0]
    assert first["rest_s"] == 150
    assert first["notes"] == "Agarre medio"
    assert [s["set_type"] for s in first["sets"]] == ["warmup", "normal", "normal", "failure"]
    assert first["sets"][1] == {"set_type": "normal", "reps": 8, "reps_max": 10, "weight_kg": 70.0, "rpe": None, "rir": 2.0}
    got = client.get(f"{ROUTINES}/{data['id']}").data
    assert got == data
    listed = client.get(ROUTINES).data
    assert len(listed) == 1
    assert listed[0]["exercise_count"] == 2
    assert listed[0]["set_count"] == 5
    assert listed[0]["exercise_names"] == ["Press banca", "Remo con barra"]


def test_put_replaces_exercises_and_keeps_order(me):
    _, client = me
    data = create(client)
    body = routine_body(title="Torso B", exercises=[row(), bench(), bench(name="Press banca 2")])
    resp = client.put(f"{ROUTINES}/{data['id']}", body, format="json")
    assert resp.status_code == 200, resp.data
    assert resp.data["title"] == "Torso B"
    assert [e["name"] for e in resp.data["exercises"]] == ["Remo con barra", "Press banca", "Press banca 2"]
    assert RoutineExercise.objects.filter(routine_id=data["id"]).count() == 3


def test_patch_only_title_keeps_exercises(me):
    _, client = me
    data = create(client)
    resp = client.patch(f"{ROUTINES}/{data['id']}", {"title": "Nuevo"}, format="json")
    assert resp.status_code == 200
    assert resp.data["title"] == "Nuevo"
    assert len(resp.data["exercises"]) == 2


def test_delete_routine(me):
    _, client = me
    data = create(client)
    assert client.delete(f"{ROUTINES}/{data['id']}").status_code == 204
    assert not Routine.objects.filter(pk=data["id"]).exists()
    assert not RoutineExercise.objects.filter(routine_id=data["id"]).exists()


def test_no_limit_on_number_of_routines(me):
    """Hevy gratis limita las rutinas; aquí no hay límite."""
    _, client = me
    for i in range(12):
        create(client, title=f"R{i}", exercises=[bench()])
    assert len(client.get(ROUTINES).data) == 12


def test_empty_routine_is_allowed(me):
    _, client = me
    data = create(client, exercises=[])
    assert data["exercises"] == []


# ---------------------------------------------------------------- validación (400 con motivo)


@pytest.mark.parametrize(
    "exercise, field",
    [
        (bench(exercise_key="press banca"), "exercise_key"),
        (bench(exercise_key="cat:Bench Press"), "exercise_key"),
        (bench(exercise_key="custom:abc"), "exercise_key"),
        (bench(name=""), "name"),
        (bench(rest_s=-1), "rest_s"),
        (bench(rest_s=3601), "rest_s"),
        (bench(sets=[{"set_type": "heavy", "reps": 5}]), "sets"),
        (bench(sets=[{"set_type": "normal", "reps": -1}]), "sets"),
        (bench(sets=[{"set_type": "normal", "reps": 10, "reps_max": 8}]), "sets"),
        (bench(sets=[{"set_type": "normal", "reps": 5, "weight_kg": -5}]), "sets"),
        (bench(sets=[{"set_type": "normal", "reps": 5, "weight_kg": 1001}]), "sets"),
        (bench(sets=[{"set_type": "normal", "reps": 5, "rpe": 11}]), "sets"),
        (bench(sets=[{"set_type": "normal", "reps": 5, "rpe": 7.3}]), "sets"),
        (bench(sets=[{"set_type": "normal", "reps": 5, "rir": -1}]), "sets"),
    ],
)
def test_invalid_exercise_is_400_with_reason(me, exercise, field):
    _, client = me
    resp = client.post(ROUTINES, routine_body(exercises=[exercise]), format="json")
    assert resp.status_code == 400
    assert field in resp.data["exercises"][0]


def test_title_required(me):
    _, client = me
    resp = client.post(ROUTINES, routine_body(title=""), format="json")
    assert resp.status_code == 400
    assert "title" in resp.data


def test_custom_and_legacy_keys_are_valid(me):
    user, client = me
    # F17 (H): el `custom:<id>` tiene que ser un ejercicio propio de este usuario
    from exercises.models import CustomExercise
    key = f"custom:{CustomExercise.objects.create(profile=user.profile, name='Mío', primary_muscles=['chest']).pk}"
    data = create(client, exercises=[bench(exercise_key=key), bench(exercise_key=None, name="Mi ejercicio")])
    assert [e["exercise_key"] for e in data["exercises"]] == [key, None]


def test_set_defaults(me):
    """Una serie solo con reps: tipo normal y lo demás vacío."""
    _, client = me
    data = create(client, exercises=[bench(sets=[{"reps": 5}])])
    assert data["exercises"][0]["sets"] == [
        {"set_type": "normal", "reps": 5, "reps_max": None, "weight_kg": None, "rpe": None, "rir": None}
    ]


# ---------------------------------------------------------------- superseries


def test_supersets_are_normalised(me):
    """Los grupos se numeran 0, 1… en orden y un grupo de un solo ejercicio deja de serlo."""
    _, client = me
    data = create(
        client,
        exercises=[bench(superset=7), row(superset=7), bench(superset=3), row(superset=9), row(superset=9)],
    )
    assert [e["superset"] for e in data["exercises"]] == [0, 0, None, 1, 1]


# ---------------------------------------------------------------- duplicar, mover, reordenar


def test_duplicate(me):
    _, client = me
    folder = client.post(FOLDERS, {"name": "Fuerza"}, format="json").data
    a = create(client, title="A", folder=folder["id"])
    b = create(client, title="B", folder=folder["id"])
    resp = client.post(f"{ROUTINES}/{a['id']}/duplicate")
    assert resp.status_code == 201
    copy = resp.data
    assert copy["id"] != a["id"]
    assert copy["folder"] == folder["id"]
    assert copy["title"].startswith("A (")
    assert [e["sets"] for e in copy["exercises"]] == [e["sets"] for e in a["exercises"]]
    # La copia va justo detrás del original.
    in_folder = [r["id"] for r in client.get(ROUTINES).data if r["folder"] == folder["id"]]
    assert in_folder == [a["id"], copy["id"], b["id"]]
    # Editar la copia no toca el original.
    client.patch(f"{ROUTINES}/{copy['id']}", {"exercises": []}, format="json")
    assert len(client.get(f"{ROUTINES}/{a['id']}").data["exercises"]) == 2


def test_move_between_folders_goes_to_the_end(me):
    _, client = me
    f1 = client.post(FOLDERS, {"name": "Uno"}, format="json").data
    f2 = client.post(FOLDERS, {"name": "Dos"}, format="json").data
    a = create(client, title="A", folder=f1["id"])
    b = create(client, title="B", folder=f2["id"])
    resp = client.patch(f"{ROUTINES}/{a['id']}", {"folder": f2["id"]}, format="json")
    assert resp.status_code == 200
    assert resp.data["folder"] == f2["id"]
    in_f2 = [r["id"] for r in client.get(ROUTINES).data if r["folder"] == f2["id"]]
    assert in_f2 == [b["id"], a["id"]]
    # Y fuera de toda carpeta.
    resp = client.patch(f"{ROUTINES}/{a['id']}", {"folder": None}, format="json")
    assert resp.data["folder"] is None


def test_reorder_routines(me):
    _, client = me
    a, b, c = (create(client, title=t) for t in "ABC")
    resp = client.post(f"{ROUTINES}/reorder", {"folder": None, "ids": [c["id"], a["id"], b["id"]]}, format="json")
    assert resp.status_code == 200
    assert [r["id"] for r in client.get(ROUTINES).data] == [c["id"], a["id"], b["id"]]


def test_reorder_rejects_foreign_ids(me):
    _, client = me
    a = create(client)
    _, other = make_client()
    theirs = create(other)
    resp = client.post(f"{ROUTINES}/reorder", {"folder": None, "ids": [theirs["id"], a["id"]]}, format="json")
    assert resp.status_code == 400


def test_folders_crud_and_reorder(me):
    _, client = me
    f1 = client.post(FOLDERS, {"name": "Uno"}, format="json")
    assert f1.status_code == 201
    f2 = client.post(FOLDERS, {"name": "Dos"}, format="json").data
    f1 = f1.data
    assert [f["name"] for f in client.get(FOLDERS).data] == ["Uno", "Dos"]
    resp = client.post(f"{FOLDERS}/reorder", {"ids": [f2["id"], f1["id"]]}, format="json")
    assert resp.status_code == 200
    assert [f["name"] for f in client.get(FOLDERS).data] == ["Dos", "Uno"]
    resp = client.patch(f"{FOLDERS}/{f1['id']}", {"name": "Uno bis"}, format="json")
    assert resp.data["name"] == "Uno bis"
    assert client.post(FOLDERS, {"name": ""}, format="json").status_code == 400


def test_delete_folder_keeps_routines_by_default(me):
    _, client = me
    folder = client.post(FOLDERS, {"name": "Uno"}, format="json").data
    a = create(client, folder=folder["id"])
    assert client.delete(f"{FOLDERS}/{folder['id']}").status_code == 204
    assert client.get(f"{ROUTINES}/{a['id']}").data["folder"] is None


def test_delete_folder_with_routines(me):
    _, client = me
    folder = client.post(FOLDERS, {"name": "Uno"}, format="json").data
    a = create(client, folder=folder["id"])
    assert client.delete(f"{FOLDERS}/{folder['id']}?routines=delete").status_code == 204
    assert not Routine.objects.filter(pk=a["id"]).exists()
    assert not RoutineFolder.objects.filter(pk=folder["id"]).exists()


def test_folder_routine_count(me):
    _, client = me
    folder = client.post(FOLDERS, {"name": "Uno"}, format="json").data
    create(client, folder=folder["id"])
    create(client, folder=folder["id"])
    assert client.get(FOLDERS).data[0]["routine_count"] == 2


# ---------------------------------------------------------------- start (contrato con H)


def test_start_matches_contract(me):
    user, client = me
    from exercises.models import CustomExercise
    key = f"custom:{CustomExercise.objects.create(profile=user.profile, name='Mío', primary_muscles=['chest']).pk}"
    data = create(client, exercises=[bench(superset=1), row(superset=1), bench(exercise_key=key, notes="")])
    resp = client.get(f"{ROUTINES}/{data['id']}/start")
    assert resp.status_code == 200
    body = resp.data
    assert body["routine_id"] == data["id"]
    assert body["title"] == "Torso A"
    assert set(body) >= {"routine_id", "title", "exercises"}
    ex = body["exercises"]
    assert [e["exercise_key"] for e in ex] == ["cat:barbell-bench-press", "cat:barbell-row", key]
    assert [e["superset"] for e in ex] == [0, 0, None]
    for e in ex:
        assert set(e) >= {"exercise_key", "name", "notes", "rest_s", "superset", "sets"}
        for s in e["sets"]:
            assert set(s) == {"set_type", "reps", "reps_max", "weight_kg", "rpe", "rir"}
            assert s["set_type"] in {"warmup", "normal", "drop", "failure"}
    assert ex[0]["sets"][1]["weight_kg"] == 70.0
    assert ex[0]["rest_s"] == 150
    # Sin cribado, el coach pide revisar el PAR-Q+ antes de lo vigoroso: aviso, no bloqueo.
    assert body["safety"]["blocked"] is False and body["safety"]["paused"] == []
    assert [r["code"] for r in body["safety"]["reasons"]] == ["parq_unanswered_light"]


def test_start_unknown_routine_is_404(me):
    _, client = me
    assert client.get(f"{ROUTINES}/999999/start").status_code == 404
