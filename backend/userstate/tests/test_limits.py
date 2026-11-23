import importlib
import threading
from datetime import timedelta
from unittest import mock

import pytest
from django.db import connection
from django.utils import timezone

from userstate import services
from userstate.models import UserState
from userstate.tests.test_api import auth_client, user_state_throttle_rate  # noqa: F401


def put(client, key, value=None, updated_at=None):
    body = {"value": value if value is not None else {"x": 1}}
    if updated_at:
        body["updated_at"] = updated_at
    return client.put(f"/api/v1/me/state/{key}", body, format="json")


def day(offset_days):
    return (timezone.localdate() + timedelta(days=offset_days)).isoformat()


@pytest.mark.django_db
@pytest.mark.parametrize("key", ["nutri_9999-99-99", "nutri_2026-02-30", "water_9999-12-31", f"nutri_{'2000-01-01'}"])
def test_dated_keys_outside_real_window_are_rejected(auth_client, key):
    resp = put(auth_client, key)
    assert resp.status_code == 400
    assert not UserState.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize("prefix", ["nutri_", "water_"])
def test_dated_keys_inside_window_are_accepted(auth_client, prefix):
    assert put(auth_client, f"{prefix}{day(0)}").status_code == 200
    assert put(auth_client, f"{prefix}{day(-700)}").status_code == 200
    assert put(auth_client, f"{prefix}{day(700)}").status_code == 200


@pytest.mark.django_db
def test_out_of_window_legacy_row_can_still_be_read_and_deleted(auth_client):
    from profiles.models import UserProfile
    UserState.objects.create(
        profile=UserProfile.objects.get(), key="nutri_2001-01-01", value={"a": 1}, updated_at=timezone.now()
    )
    assert auth_client.get("/api/v1/me/state?keys=nutri_2001-01-01").status_code == 200
    assert auth_client.delete("/api/v1/me/state/nutri_2001-01-01").status_code == 204


@pytest.mark.django_db
def test_bulk_reports_bad_dated_key_per_item(auth_client):
    resp = auth_client.post(
        "/api/v1/me/state/bulk",
        {"items": [{"key": "nutri_9999-99-99", "value": {"a": 1}}, {"key": f"nutri_{day(0)}", "value": {"a": 1}}]},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.data["results"]["nutri_9999-99-99"]["ok"] is False
    assert resp.data["results"][f"nutri_{day(0)}"]["ok"] is True


@pytest.mark.django_db
def test_total_bytes_per_user_is_capped(auth_client, monkeypatch):
    monkeypatch.setattr(services, "MAX_USER_BYTES", 3_000)
    blob = {"b": "x" * 1_000}
    assert put(auth_client, "coach_fb", blob).status_code == 200
    assert put(auth_client, "coach_memory", blob).status_code == 200
    resp = put(auth_client, "gym_week", {"b": "x" * 2_000})
    assert resp.status_code == 400
    assert "límite" in str(resp.data)
    # sobrescribir una clave existente no cuenta dos veces su tamaño anterior
    assert put(auth_client, "coach_fb", {"b": "y" * 1_200}).status_code == 200


@pytest.mark.django_db
def test_far_future_updated_at_is_clamped_and_does_not_lock_the_key(auth_client):
    first = put(auth_client, "weigh", {"kg": 1}, "9999-01-01T00:00:00Z")
    assert first.status_code == 200
    stored = UserState.objects.get(key="weigh").updated_at
    assert stored <= timezone.now() + timedelta(minutes=5, seconds=5)

    later = timezone.now() + timedelta(minutes=10)
    with mock.patch("userstate.services.timezone.now", return_value=later):
        second = put(auth_client, "weigh", {"kg": 2}, later.isoformat())
    assert second.status_code == 200
    assert second.data["accepted"] is True
    assert UserState.objects.get(key="weigh").value == {"kg": 2}


@pytest.mark.django_db
def test_legacy_row_with_future_updated_at_does_not_lock_the_key(auth_client):
    from profiles.models import UserProfile
    UserState.objects.create(
        profile=UserProfile.objects.get(), key="weigh", value={"kg": 1},
        updated_at=timezone.now().replace(year=9000),
    )
    resp = put(auth_client, "weigh", {"kg": 2})
    assert resp.status_code == 200
    assert resp.data["accepted"] is True
    assert UserState.objects.get(key="weigh").value == {"kg": 2}


@pytest.mark.django_db
def test_migration_clamps_future_rows_and_keeps_others(auth_client):
    from django.apps import apps as django_apps
    from profiles.models import UserProfile
    migration = importlib.import_module("userstate.migrations.0002_clamp_future_updated_at")
    profile = UserProfile.objects.get()
    past = timezone.now() - timedelta(days=3)
    UserState.objects.create(profile=profile, key="weigh", value={"k": 1}, updated_at=timezone.now().replace(year=9000))
    UserState.objects.create(profile=profile, key="coach_fb", value={"k": 1}, updated_at=past)

    migration.clamp_future(django_apps, None)

    assert UserState.objects.get(key="weigh").updated_at <= timezone.now()
    assert UserState.objects.get(key="coach_fb").updated_at == past


@pytest.mark.django_db
def test_total_cap_counts_real_bytes_not_characters(auth_client, monkeypatch):
    monkeypatch.setattr(services, "MAX_USER_BYTES", 1_500)
    assert put(auth_client, "coach_fb", {"b": "á" * 400}).status_code == 200  # ~800 bytes
    assert put(auth_client, "coach_memory", {"b": "á" * 400}).status_code == 400


@pytest.mark.django_db(transaction=True)
def test_concurrent_first_puts_never_500(auth_client):
    from profiles.models import UserProfile
    profile = UserProfile.objects.get()
    threads_n, keys = 8, [f"coach_dismissed_{day(-i)}" for i in range(10)]
    barrier = threading.Barrier(threads_n)
    errors = []

    def worker(n):
        try:
            for key in keys:
                barrier.wait()
                services.state_put(profile=profile, key=key, value={"n": n})
        except Exception as exc:  # noqa: BLE001
            errors.append(repr(exc))
            barrier.abort()
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(threads_n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert UserState.objects.filter(profile=profile).count() == len(keys)
