"""`SetLog` (Task 6.1): series de gimnasio desde `sets` o `detail.exercises`, y la migración."""
import importlib
from datetime import timedelta
from decimal import Decimal

import pytest
from django.apps import apps
from django.core.cache import cache
from django.utils import timezone

from activities.models import Activity, SetLog
from activities.sets import sets_from_detail

from .test_sync_api import item, make_client

SYNC = "/api/v1/activities/sync"
EXERCISES = [
    {"name": "Press banca", "sets": [{"kg": 60, "reps": 10}, {"kg": 62.5, "reps": 8}]},
    {"name": "Dominadas", "sets": [{"kg": 0, "reps": 8}]},
]


@pytest.fixture
def auth_client(db):
    cache.clear()
    return make_client("gym@test.com")


def gym(cid, **over):
    return item(cid, kind="GYM", title="Full body", rpe=8, kcal=None, **over)


@pytest.mark.django_db
def test_sets_field_creates_set_logs(auth_client):
    sets = [
        {"exercise": "Press banca", "exercise_index": 0, "set_index": 0, "weight_kg": "60", "reps": 10, "rir": 2},
        {"exercise": "Press banca", "exercise_index": 0, "set_index": 1, "weight_kg": "62.5", "reps": 8},
        {"exercise": "Dominadas", "exercise_index": 1, "set_index": 0, "weight_kg": None, "reps": 8},
    ]
    resp = auth_client.post(SYNC, {"items": [gym("cid-gym00001", detail={"focus": None}, sets=sets)]}, format="json")
    assert resp.data["created"] == 1
    logs = list(SetLog.objects.order_by("exercise_index", "set_index"))
    assert [(s.exercise, s.weight_kg, s.reps) for s in logs] == [
        ("Press banca", Decimal("60.00"), 10),
        ("Press banca", Decimal("62.50"), 8),
        ("Dominadas", None, 8),
    ]
    assert logs[0].rir == Decimal("2.0")
    assert not Activity.objects.get().sets_truncated


@pytest.mark.django_db
def test_detail_exercises_are_used_when_sets_are_missing(auth_client):
    detail = {"focus": "Full body", "volume_kg": 1100, "exercises": EXERCISES}
    auth_client.post(SYNC, {"items": [gym("cid-gym00002", detail=detail)]}, format="json")
    logs = list(SetLog.objects.all())
    assert len(logs) == 3
    # 0 kg en el gimnasio de la app es una serie con el peso corporal, como en el coach.
    assert [s.weight_kg for s in logs if s.exercise == "Dominadas"] == [None]


@pytest.mark.django_db
def test_truncated_detail_is_marked_and_nothing_is_invented(auth_client):
    detail = {"focus": "Full body", "volume_kg": 15000}  # el cliente quitó el desglose
    auth_client.post(SYNC, {"items": [gym("cid-gym00003", detail=detail)]}, format="json")
    assert Activity.objects.get().sets_truncated
    assert SetLog.objects.count() == 0


@pytest.mark.django_db
def test_other_kinds_get_no_set_logs(auth_client):
    auth_client.post(SYNC, {"items": [item("cid-sport001", detail={"exercises": EXERCISES})]}, format="json")
    assert SetLog.objects.count() == 0
    assert not Activity.objects.get().sets_truncated


@pytest.mark.django_db
def test_duplicated_sets_make_the_item_invalid(auth_client):
    dup = {"exercise": "Sentadilla", "exercise_index": 0, "set_index": 0, "weight_kg": "80", "reps": 5}
    resp = auth_client.post(SYNC, {"items": [gym("cid-gym00004", sets=[dup, dup])]}, format="json")
    assert resp.data["invalid"] == 1
    assert Activity.objects.count() == 0


def test_sets_from_detail_skips_bad_rows():
    rows, truncated = sets_from_detail({"exercises": [
        {"name": "Sentadilla", "sets": [{"kg": 100, "reps": 5}, {"kg": "x", "reps": 5}, {"kg": 90, "reps": 0},
                                        {"kg": 90, "reps": 2.5}, {"kg": -1, "reps": 5}, "basura"]},
        {"sets": [{"kg": 1, "reps": 1}]},
    ]})
    assert truncated is False
    # Una carga ilegible ("x") no se adivina: la serie se descarta.
    assert [(r["weight_kg"], r["reps"], r["set_index"]) for r in rows] == [(Decimal("100"), 5, 0)]
    assert sets_from_detail(None) == ([], False)
    assert sets_from_detail({"focus": "x"}) == ([], False)


@pytest.mark.django_db
def test_data_migration_moves_untruncated_detail_and_marks_truncated():
    from users.services import user_create

    profile = user_create(email="mig@test.com", password="pw-strong-123").profile
    started = timezone.now() - timedelta(days=1)
    full = Activity.objects.create(profile=profile, kind="GYM", started_at=started, duration_sec=3600,
                                   detail={"focus": None, "volume_kg": 1100, "exercises": EXERCISES})
    cut = Activity.objects.create(profile=profile, kind="GYM", started_at=started, duration_sec=3600,
                                  detail={"focus": None, "volume_kg": 20000})
    bare = Activity.objects.create(profile=profile, kind="GYM", started_at=started, duration_sec=3600)
    migration = importlib.import_module("activities.migrations.0003_setlog_from_detail")
    migration.forwards(apps, None)
    migration.forwards(apps, None)  # idempotente
    assert SetLog.objects.filter(activity=full).count() == 3
    cut.refresh_from_db()
    bare.refresh_from_db()
    assert cut.sets_truncated and not SetLog.objects.filter(activity=cut).exists()
    assert not bare.sets_truncated
