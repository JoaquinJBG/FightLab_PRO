"""F17 (H): un `custom:<id>` solo vale si el ejercicio propio es del usuario, en rutinas y en
series; y la API no deja al cliente poner `source` ni `source_ref` (solo el importador)."""
import pytest
from django.utils import timezone

from activities.models import SetLog
from exercises.models import CustomExercise

from .helpers import ROUTINES, bench, make_client, routine_body

pytestmark = pytest.mark.django_db


def _custom(user, name="Mío"):
    return f"custom:{CustomExercise.objects.create(profile=user.profile, name=name, primary_muscles=['chest']).pk}"


def test_a_routine_cannot_use_someone_elses_custom_exercise():
    me, client = make_client()
    other, _ = make_client()
    mine, theirs = _custom(me), _custom(other)
    ok = client.post(ROUTINES, routine_body(exercises=[bench(exercise_key=mine)]), format="json")
    assert ok.status_code == 201, ok.data
    bad = client.post(ROUTINES, routine_body(exercises=[bench(exercise_key=theirs)]), format="json")
    assert bad.status_code == 400
    assert "exercise_key" in bad.data["exercises"][0]
    # Tampoco al editarla
    put = client.patch(f"{ROUTINES}/{ok.data['id']}", {"exercises": [bench(exercise_key=theirs)]}, format="json")
    assert put.status_code == 400


def test_the_client_cannot_set_the_source():
    _, client = make_client()
    resp = client.post(ROUTINES, routine_body(source="import", source_ref="Push A"), format="json")
    assert resp.status_code == 201
    from routines.models import Routine
    routine = Routine.objects.get(pk=resp.data["id"])
    assert (routine.source, routine.source_ref) == ("user", "")


def test_a_set_cannot_use_someone_elses_custom_exercise():
    me, client = make_client()
    other, _ = make_client()
    theirs = _custom(other)
    item = {
        "client_id": "cid-owner-0001", "kind": "GYM", "title": "Torso", "duration_sec": 600,
        "started_at": (timezone.now() - timezone.timedelta(hours=1)).isoformat(),
        "sets": [{"exercise": "Ajeno", "exercise_key": theirs, "exercise_index": 0, "set_index": 0, "weight_kg": "50", "reps": 5}],
    }
    resp = client.post("/api/v1/activities", item, format="json")
    assert resp.status_code == 400
    assert "exercise_key" in resp.data["errors"]["sets"][0]
    item["sets"][0]["exercise_key"] = _custom(me)
    assert client.post("/api/v1/activities", item, format="json").status_code == 201
    assert SetLog.objects.get().exercise_key.startswith("custom:")
