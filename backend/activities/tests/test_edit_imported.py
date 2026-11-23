"""Editar una sesión importada con una fecha que el registro normal no acepta (fix G1-3).

Hevy deja importar sesiones desde el año 2000 y con un día de margen hacia el futuro (el día local
del archivo puede ir por delante del UTC). Editar solo el título o la nota de una de ellas daba 500
(`KeyError` sobre un `validated_data` vacío): ahora solo se validan los campos editados.
"""
from datetime import datetime, timedelta, timezone as dt_timezone

import pytest
from django.core.cache import cache
from django.utils import timezone

from activities.models import Activity
from activities.serializers import STARTED_AT_FLOOR
from coaching.imports import IMPORT_FLOOR
from profiles.models import UserProfile

from .test_sync_api import make_client

LIST = "/api/v1/activities"


@pytest.fixture
def client(db):
    cache.clear()
    return make_client("edit@test.com")


def imported(started_at) -> Activity:
    return Activity.objects.create(
        profile=UserProfile.objects.get(user__email="edit@test.com"), kind=Activity.Kind.GYM, title="Push A",
        started_at=started_at, duration_sec=3600, source=Activity.Source.IMPORT, external_id="hevy_csv:x",
    )


@pytest.mark.django_db
@pytest.mark.parametrize("started_at", [
    datetime(2015, 3, 1, 18, tzinfo=dt_timezone.utc),  # anterior a 2020
    timezone.now() + timedelta(hours=12),  # dentro del margen de la importación
])
def test_editing_title_of_an_imported_session_keeps_its_date(client, started_at):
    act = imported(started_at)
    res = client.patch(f"{LIST}/{act.pk}", {"title": "Torso", "note": "Bien"}, format="json")
    assert res.status_code == 200, res.data
    act.refresh_from_db()
    assert (act.title, act.note, act.started_at) == ("Torso", "Bien", started_at)


@pytest.mark.django_db
def test_editing_a_bad_field_still_fails_with_its_error(client):
    act = imported(datetime(2015, 3, 1, 18, tzinfo=dt_timezone.utc))
    res = client.patch(f"{LIST}/{act.pk}", {"rpe": 11}, format="json")
    assert res.status_code == 400 and "rpe" in res.data
    res = client.patch(f"{LIST}/{act.pk}", {"started_at": "1999-12-31T23:00:00Z"}, format="json")
    assert res.status_code == 400 and "started_at" in res.data


@pytest.mark.django_db
def test_an_imported_date_can_be_set_again_by_hand(client):
    act = imported(datetime(2015, 3, 1, 18, tzinfo=dt_timezone.utc))
    res = client.patch(f"{LIST}/{act.pk}", {"started_at": "2015-03-02T18:00:00Z"}, format="json")
    assert res.status_code == 200, res.data


def test_import_and_log_share_the_date_floor():
    assert IMPORT_FLOOR == STARTED_AT_FLOOR
