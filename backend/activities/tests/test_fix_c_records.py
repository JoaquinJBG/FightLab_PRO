"""Arreglo C: los récords salen igual se empiece el entreno como se empiece."""
import pytest

from .test_f17_registro import _session, client  # noqa: F401 (la fixture `client`)


@pytest.mark.django_db
def test_records_asked_by_plain_name_come_back_under_that_name(client):  # noqa: F811
    """El foco semanal y el plan abren el gimnasio con ejercicios sin clave (solo el nombre,
    «Sentadilla»). El cliente pide los récords con ese nombre y los busca en la respuesta por ese
    mismo texto: tiene que estar ahí, igual que si empezó desde una rutina."""
    _session(client, "cid-c0000001", 5, [
        {"exercise": "Sentadilla", "exercise_index": 0, "set_index": 0, "weight_kg": "100", "reps": 5},
        {"exercise": "Curl Zottman casero", "exercise_index": 1, "set_index": 0, "weight_kg": "8", "reps": 12},
    ])
    # El mismo ejercicio desde una rutina, con clave: se agrupa con el que no la tiene
    _session(client, "cid-c0000002", 2, [
        {"exercise": "Sentadilla", "exercise_key": "cat:barbell-back-squat", "exercise_index": 0, "set_index": 0,
         "weight_kg": "110", "reps": 3},
    ])
    resp = client.get("/api/v1/gym/records", {"exercise": ["Sentadilla", "Curl Zottman casero", "Nunca hecho"]})
    assert resp.status_code == 200
    records = resp.data["records"]
    assert records["Sentadilla"]["max_weight_kg"] == 110.0 and records["Sentadilla"]["sessions"] == 2
    assert records["cat:barbell-back-squat"] == records["Sentadilla"]
    assert records["Curl Zottman casero"]["max_weight_kg"] == 8.0
    assert records["Nunca hecho"] is None
    # Con la clave sigue saliendo por la clave
    by_key = client.get("/api/v1/gym/records", {"exercise": "cat:barbell-back-squat"}).data["records"]
    assert by_key["cat:barbell-back-squat"]["max_weight_kg"] == 110.0
