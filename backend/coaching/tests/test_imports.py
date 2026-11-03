"""Importar CSV de Hevy o genérico a `SetLog` (Task 9.1). Los CSV son inventados."""
from datetime import datetime, timezone

import pytest
from coach.sessions.importers import hevy_csv
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from activities.models import Activity, SetLog
from coaching.bridge import importers

from .helpers import client_for, make_user, today_fixed  # noqa: F401

pytestmark = pytest.mark.django_db

HEVY_HEADER = (
    "title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,"
    "set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe\n"
)
HEVY_A = HEVY_HEADER + (
    'Push A,"3 Sep 2026, 18:00","3 Sep 2026, 19:10",,Bench Press (Barbell),,,0,warmup,40,10,,,\n'
    'Push A,"3 Sep 2026, 18:00","3 Sep 2026, 19:10",,Bench Press (Barbell),,"Slow, paused",1,normal,80,6,,,8\n'
    'Push A,"3 Sep 2026, 18:00","3 Sep 2026, 19:10",,Bench Press (Barbell),,,2,normal,80,5,,,9\n'
    'Push A,"3 Sep 2026, 18:00","3 Sep 2026, 19:10",,Pull Up,,,0,normal,,9,,,\n'
    'Push A,"3 Sep 2026, 18:00","3 Sep 2026, 19:10",,Pull Up,,,1,normal,,,,,\n'
    'Legs,"5 Sep 2026, 09:30","5 Sep 2026, 10:30",,Squat (Barbell),,,0,normal,100,5,,,\n'
    'Legs,"5 Sep 2026, 09:30","5 Sep 2026, 10:30",,Plank,,,0,normal,,,,60,\n'
)
# Un export posterior: repite lo anterior, añade una serie a "Legs" y una sesión nueva.
HEVY_B = HEVY_A + (
    'Legs,"5 Sep 2026, 09:30","5 Sep 2026, 10:30",,Squat (Barbell),,,1,normal,100,5,,,\n'
    'Push B,"8 Sep 2026, 18:00","8 Sep 2026, 19:00",,Bench Press (Barbell),,,0,normal,82.5,5,,,\n'
)
GENERIC = (
    "date,exercise,weight_kg,reps,rir,set_type,session\n"
    "2026-09-10,Press banca,70,8,2,,Torso\n"
    "2026-09-10,Press banca,70,8,1,,Torso\n"
    "2026-09-10 19:30,Sentadilla,90,5,,warmup,Pierna\n"
)


def upload(client, text: str | bytes, name="export.csv", **data):
    content = text.encode("utf-8") if isinstance(text, str) else text
    return client.post(
        "/api/v1/coach/import",
        {"file": SimpleUploadedFile(name, content, content_type="text/csv"), **data},
        format="multipart",
    )


def warnings(response) -> dict:
    return {w["code"]: w["count"] for w in response.data["warnings"]}


# ---------------------------------------------------------------- Hevy


def test_hevy_export_becomes_sessions_and_sets(today_fixed):
    user = make_user(profile={"timezone": "Europe/Madrid"})
    response = upload(client_for(user), HEVY_A)
    assert response.status_code == 201, response.data
    assert response.data["importer"] == "hevy_csv"
    assert response.data["sessions"] == {"new": 2, "updated": 0, "total": 2}
    assert response.data["sets"] == {"imported": 6, "duplicates": 0, "in_file": 7}
    assert response.data["range"] == {"first": "2026-09-03", "last": "2026-09-05"}
    # La serie de "Pull Up" sin nada es un resto de plantilla: no se importa y se avisa.
    assert warnings(response) == {"template_rows": 1}

    push = Activity.objects.get(profile=user.profile, title="Push A")
    assert push.kind == "GYM" and push.source == "IMPORT" and push.rpe is None
    assert push.external_id == "hevy_csv:2026-09-03T18:00:00"
    # La hora del archivo es local del perfil; la duración, fin − inicio.
    assert push.started_at == datetime(2026, 9, 3, 16, 0, tzinfo=timezone.utc)
    assert push.duration_sec == 70 * 60
    assert push.detail == {"import": {"source": "hevy_csv"}, "duration_known": True}
    sets = list(push.sets.values_list("exercise", "exercise_index", "set_index", "set_type", "weight_kg", "reps", "rpe"))
    assert [(e, ei, si, t, float(w) if w is not None else None, r) for e, ei, si, t, w, r, _ in sets] == [
        ("Bench Press (Barbell)", 0, 0, "warmup", 40.0, 10),
        ("Bench Press (Barbell)", 0, 1, "normal", 80.0, 6),
        ("Bench Press (Barbell)", 0, 2, "normal", 80.0, 5),
        ("Pull Up", 1, 0, "normal", None, 9),
    ]
    assert float(push.sets.get(set_index=1, exercise_index=0).rpe) == 8
    plank = SetLog.objects.get(activity__title="Legs", exercise="Plank")
    assert plank.duration_s == 60 and plank.reps is None


def test_reimporting_the_same_file_duplicates_nothing(today_fixed):
    user = make_user()
    client = client_for(user)
    upload(client, HEVY_A)
    again = upload(client, HEVY_A)
    assert again.status_code == 201
    assert again.data["sessions"] == {"new": 0, "updated": 0, "total": 2}
    assert again.data["sets"]["imported"] == 0 and again.data["sets"]["duplicates"] == 6
    assert again.data["range"] is None
    assert Activity.objects.filter(profile=user.profile).count() == 2
    assert SetLog.objects.filter(activity__profile=user.profile).count() == 6


def test_an_overlapping_export_only_adds_what_is_new(today_fixed):
    user = make_user()
    client = client_for(user)
    upload(client, HEVY_A)
    response = upload(client, HEVY_B)
    assert response.data["sessions"] == {"new": 1, "updated": 1, "total": 3}
    assert response.data["sets"] == {"imported": 2, "duplicates": 6, "in_file": 9}
    assert SetLog.objects.filter(activity__title="Legs", exercise="Squat (Barbell)").count() == 2


def test_the_stored_set_wins_when_the_same_position_changed_exercise(today_fixed):
    user = make_user()
    client = client_for(user)
    upload(client, HEVY_A)
    edited = HEVY_A.replace("Squat (Barbell)", "Front Squat (Barbell)")
    response = upload(client, edited)
    assert response.data["sets"]["imported"] == 0
    assert not SetLog.objects.filter(exercise="Front Squat (Barbell)").exists()


def test_dry_run_reports_without_saving(today_fixed):
    user = make_user()
    response = upload(client_for(user), HEVY_A, dry_run="1")
    assert response.status_code == 200
    assert response.data["dry_run"] is True
    assert response.data["sets"]["imported"] == 6
    assert not Activity.objects.filter(profile=user.profile).exists()


def test_imported_sets_are_per_user(today_fixed):
    a, b = make_user(), make_user()
    upload(client_for(a), HEVY_A)
    response = upload(client_for(b), HEVY_A)
    assert response.data["sets"]["imported"] == 6
    assert SetLog.objects.filter(activity__profile=a.profile).count() == 6


def test_lbs_exports_are_converted_to_kg(today_fixed):
    text = HEVY_HEADER.replace("weight_kg", "weight_lbs").replace("distance_km", "distance_miles") + (
        'Push,"3 Sep 2026, 18:00","3 Sep 2026, 19:00",,Bench Press (Barbell),,,0,normal,135,5,,,\n'
    )
    user = make_user()
    assert upload(client_for(user), text).status_code == 201
    assert float(SetLog.objects.get(activity__profile=user.profile).weight_kg) == pytest.approx(61.23, abs=0.01)


# ---------------------------------------------------------------- CSV genérico


def test_generic_csv_is_detected_and_imported(today_fixed):
    user = make_user()
    response = upload(client_for(user), GENERIC)
    assert response.status_code == 201, response.data
    assert response.data["importer"] == "generic_csv"
    assert response.data["sessions"]["new"] == 2  # "2026-09-10" y "2026-09-10 19:30"
    torso = Activity.objects.get(profile=user.profile, title="Torso")
    assert [float(r) for r in torso.sets.values_list("rir", flat=True)] == [2.0, 1.0]
    # Sin hora de fin ni duraciones, la duración no se conoce.
    assert torso.duration_sec == 1 and torso.detail["duration_known"] is False


def test_the_importer_can_be_chosen(today_fixed):
    response = upload(client_for(make_user()), GENERIC, importer="hevy_csv")
    assert response.status_code == 400
    assert response.data["code"] == "missing_columns"


# ---------------------------------------------------------------- validación del archivo


@pytest.mark.parametrize(
    ("content", "name", "code"),
    [
        ("", "a.csv", "empty_file"),
        (b"\x89PNG\r\n\x1a\n\x00\x00", "a.csv", "not_csv"),
        ("date,exercise\n2026-09-10,Press\n".encode("utf-8"), "a.xlsx", "not_csv"),
        ("date,exercise,notes\n2026-09-10,Press banca,ñandú\n".encode("latin-1"), "a.csv", "encoding"),
        ("foo,bar\n1,2\n", "a.csv", "unknown_format"),
        ("date,exercise,weight_kg,reps\n2026-09-10,Press banca,12,5,8\n", "a.csv", "decimal_comma"),
        ("date,exercise,reps\n2026-09-10,Press banca,cinco\n", "a.csv", "not_a_number"),
        ("date,exercise,reps\n2026-09-10,Press banca,5.5\n", "a.csv", "not_whole"),
        ("date,exercise,reps\n10/09/2026,Press banca,5\n", "a.csv", "bad_date"),
        ("date,exercise,reps\n2026-09-10,Press banca,\n", "a.csv", "no_sets"),
    ],
)
def test_bad_files_are_refused_with_a_code(today_fixed, content, name, code):
    response = upload(client_for(make_user()), content, name=name)
    assert response.status_code == 400
    assert response.data["code"] == code
    assert "fl-import-" not in response.data["detail"]  # nunca la ruta temporal


def test_error_codes_carry_their_line():
    with pytest.raises(importers.ImportFileError) as exc:
        importers.parse(b"date,exercise,reps\n2026-09-10,Press,5\n2026-09-10,Press,x\n")
    assert exc.value.code == "not_a_number"
    assert exc.value.params == {"line": 3, "column": "reps", "value": "x"}


def test_missing_file_and_too_large(today_fixed, monkeypatch):
    client = client_for(make_user())
    assert client.post("/api/v1/coach/import", {}, format="multipart").data["code"] == "missing_file"
    monkeypatch.setattr(importers, "MAX_IMPORT_BYTES", 100)
    response = upload(client, GENERIC)
    assert response.status_code == 400 and response.data["code"] == "too_large"


def test_import_needs_a_login():
    assert upload(APIClient(), GENERIC).status_code == 401


def test_out_of_range_values_are_dropped_with_a_warning(today_fixed):
    text = "date,exercise,weight_kg,reps,rpe\n2026-09-10,Press banca,5000,5,\n2026-09-10,Press banca,80,5,14\n"
    user = make_user()
    response = upload(client_for(user), text)
    assert warnings(response) == {"set_out_of_range": 1, "value_dropped": 1}
    kept = SetLog.objects.get(activity__profile=user.profile)
    assert float(kept.weight_kg) == 80 and kept.rpe is None


def test_sessions_out_of_range_are_skipped(today_fixed):
    text = "date,exercise,weight_kg,reps\n1999-01-01,Press banca,80,5\n2026-09-10,Press banca,80,5\n"
    response = upload(client_for(make_user()), text)
    assert warnings(response) == {"session_out_of_range": 1}
    assert response.data["sessions"]["new"] == 1


# ---------------------------------------------------------------- saltos de línea (U16)

CRLF_HEVY = (HEVY_HEADER + (
    'Push A,"3 Sep 2026, 18:00","3 Sep 2026, 19:10",,Pull Up,,"Line one\nline two",0,normal,,9,,,\n'
)).replace("\n", "\r\n")


def test_the_coach_keeps_crlf_inside_quoted_fields(tmp_path):
    """Lo que arregla el puente (U16). Si el motor empieza a normalizarlo, este test avisa de que
    la normalización del puente ya sobra."""
    path = tmp_path / "crlf.csv"
    path.write_bytes(CRLF_HEVY.encode("utf-8"))
    assert hevy_csv.HevyCsv().read(path)[0].notes == "Line one\r\nline two"


def test_the_bridge_normalises_line_breaks():
    parsed = importers.parse(CRLF_HEVY.encode("utf-8"))
    assert parsed.sets[0].notes == "Line one\nline two"
    assert parsed.end_times == {datetime(2026, 9, 3, 18, 0): datetime(2026, 9, 3, 19, 10)}
