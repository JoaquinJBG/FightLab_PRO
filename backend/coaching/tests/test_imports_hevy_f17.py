"""Importar de Hevy de forma completa (F17, rama H). El CSV es inventado, con la cabecera real
de `workout_data.csv`: todas las series, tipos, RPE, notas, superseries y la descripción, y una
rutina por título distinto con los ejercicios y series de su última vez."""
import pytest

from activities import contract
from activities.models import Activity, ImportedRoutine, SetLog
from routines.models import Routine

from .helpers import client_for, make_user, today_fixed  # noqa: F401
from .test_imports import HEVY_HEADER, upload

pytestmark = pytest.mark.django_db

HEVY = HEVY_HEADER + (
    'Push A,"20 Oct 2026, 18:00","20 Oct 2026, 19:00","Old push",Bench Press (Barbell),,,0,normal,75,8,,,\n'
    'Push A,"27 Oct 2026, 18:00","27 Oct 2026, 19:10","Felt strong",Bench Press (Barbell),,"Pause 1 s",0,warmup,40,10,,,\n'
    'Push A,"27 Oct 2026, 18:00","27 Oct 2026, 19:10","Felt strong",Bench Press (Barbell),,"Pause 1 s",1,normal,80,6,,,8.5\n'
    'Push A,"27 Oct 2026, 18:00","27 Oct 2026, 19:10","Felt strong",Bench Press (Barbell),,"Pause 1 s",2,dropset,60,10,,,\n'
    'Push A,"27 Oct 2026, 18:00","27 Oct 2026, 19:10","Felt strong",Lateral Raise (Dumbbell),0,,0,normal,10,15,,,\n'
    'Push A,"27 Oct 2026, 18:00","27 Oct 2026, 19:10","Felt strong",Zottman Wobble Curl,0,"Mine",0,failure,12,12,,,\n'
    'Legs,"25 Oct 2026, 10:00","25 Oct 2026, 11:00",,Squat (Barbell),,,0,normal,100,5,,,\n'
)


def test_everything_in_the_csv_is_kept(today_fixed):
    user = make_user()
    response = upload(client_for(user), HEVY)
    assert response.status_code == 201, response.data
    push = Activity.objects.get(profile=user.profile, external_id="hevy_csv:2026-10-27T18:00:00")
    # La descripción de la sesión pasa a su nota.
    assert push.note == "Felt strong"
    rows = list(push.sets.order_by("exercise_index", "set_index"))
    assert [r.set_type for r in rows] == ["warmup", "normal", "drop", "normal", "failure"]
    assert float(rows[1].rpe) == 8.5
    assert [r.notes for r in rows] == ["Pause 1 s", "Pause 1 s", "Pause 1 s", "", "Mine"]
    # superset_id de Hevy (0) → grupo de superserie; sin él, suelto.
    assert [r.superset for r in rows] == [None, None, None, 0, 0]
    # El ejercicio del catálogo lleva su clave; uno desconocido, la de un ejercicio propio nuevo.
    assert rows[0].exercise_key == contract.legacy_key("Bench Press (Barbell)") is not None
    assert rows[4].exercise_key.startswith("custom:")
    assert response.data["routines"] == {"new": 2, "existing": 0, "unavailable": 0}


def test_one_routine_per_title_with_its_last_session(today_fixed):
    user = make_user()
    upload(client_for(user), HEVY)
    routines = {r.title: r for r in Routine.objects.filter(profile=user.profile)}
    assert set(routines) == {"Push A", "Legs"}
    # Hechas desde el servidor: `source=import` y el título de Hevy (el cliente no puede ponerlos)
    assert {(r.source, r.source_ref) for r in routines.values()} == {("import", "Push A"), ("import", "Legs")}
    push = list(routines["Push A"].exercises.order_by("order"))
    assert [e.name for e in push] == ["Bench Press (Barbell)", "Lateral Raise (Dumbbell)", "Zottman Wobble Curl"]
    bench = push[0]
    assert bench.notes == "Pause 1 s" and bench.exercise_key == contract.legacy_key("Bench Press (Barbell)")
    # Las series de la última vez (27 oct), no las del 20.
    assert [(s["set_type"], s["reps"], s["weight_kg"], s["rpe"]) for s in bench.sets] == [
        ("warmup", 10, 40.0, None), ("normal", 6, 80.0, 8.5), ("drop", 10, 60.0, None),
    ]
    assert push[1].superset == push[2].superset is not None


def test_reimporting_duplicates_nothing(today_fixed):
    user = make_user()
    client = client_for(user)
    upload(client, HEVY)
    customs = SetLog.objects.filter(exercise_key__startswith="custom:").values_list("exercise_key", flat=True).distinct()
    again = upload(client, HEVY)
    assert again.status_code == 201
    assert again.data["routines"] == {"new": 0, "existing": 2, "unavailable": 0}
    assert again.data["sets"]["imported"] == 0
    assert Routine.objects.filter(profile=user.profile).count() == 2
    assert SetLog.objects.filter(activity__profile=user.profile).count() == 7
    assert set(SetLog.objects.filter(exercise_key__startswith="custom:").values_list("exercise_key", flat=True)) == set(customs)


def test_an_old_import_is_completed_when_imported_again(today_fixed):
    # Lo importado antes de F17 no tenía notas, superseries ni clave: se rellenan sin duplicar.
    user = make_user()
    client = client_for(user)
    upload(client, HEVY)
    SetLog.objects.filter(activity__profile=user.profile).update(notes="", superset=None, exercise_key=None)
    upload(client, HEVY)
    bench = SetLog.objects.get(activity__external_id="hevy_csv:2026-10-27T18:00:00", exercise_index=0, set_index=1)
    assert bench.notes == "Pause 1 s" and bench.exercise_key is not None
    assert SetLog.objects.filter(activity__profile=user.profile).count() == 7


def test_dry_run_counts_routines_without_creating_anything(today_fixed):
    user = make_user()
    response = upload(client_for(user), HEVY, dry_run="1")
    assert response.data["routines"] == {"new": 2, "existing": 0, "unavailable": 0}
    assert not Routine.objects.filter(profile=user.profile).exists()
    assert not ImportedRoutine.objects.exists()


def test_without_the_routines_api_the_history_is_still_imported(today_fixed, monkeypatch):
    monkeypatch.setattr(contract, "create_routine", lambda user, payload, **kw: None)
    user = make_user()
    response = upload(client_for(user), HEVY)
    assert response.status_code == 201
    assert response.data["routines"] == {"new": 0, "existing": 0, "unavailable": 2}
    assert Activity.objects.filter(profile=user.profile).count() == 3
    # Se reintenta la próxima vez: no queda apuntada como creada.
    assert not ImportedRoutine.objects.exists()


def test_the_payload_follows_the_contract(today_fixed, monkeypatch):
    sent = []
    monkeypatch.setattr(contract, "create_routine", lambda user, payload, **kw: sent.append(payload) or 99)
    upload(client_for(make_user()), HEVY)
    legs = next(p for p in sent if p["title"] == "Legs")
    assert legs == {
        "title": "Legs",
        "notes": "",
        "exercises": [{
            "exercise_key": contract.legacy_key("Squat (Barbell)"),
            "name": "Squat (Barbell)", "notes": "", "rest_s": None, "superset": None,
            "sets": [{"set_type": "normal", "reps": 5, "reps_max": None, "weight_kg": 100.0, "rpe": None, "rir": None}],
        }],
    }
