from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from activities.models import Activity
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token


def make_client(email: str) -> APIClient:
    user = user_create(email=email, password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": email, "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return client


@pytest.fixture
def auth_client(db):
    cache.clear()  # resetea el throttle de sync entre tests (la pk de usuario se repite)
    return make_client("atleta@test.com")


def item(cid="cid-0000001", **over):
    base = {
        "client_id": cid,
        "kind": "SPORT",
        "title": "Correr",
        "started_at": (timezone.now() - timedelta(hours=2)).isoformat(),
        "duration_sec": 1800,
        "rpe": 7,
        "kcal": 320,
        "detail": {"sport_key": "run", "intensity": "Moderado"},
    }
    base.update(over)
    return base


def test_sync_requires_auth(db):
    resp = APIClient().post("/api/v1/activities/sync", {"items": [item()]}, format="json")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_sync_crea_y_es_idempotente(auth_client):
    payload = {"items": [item("cid-aaaa0001"), item("cid-aaaa0002", kind="MMA", title="BJJ")]}
    first = auth_client.post("/api/v1/activities/sync", payload, format="json")
    assert first.status_code == 200
    assert first.data["created"] == 2
    assert all(r["status"] == "created" and r["id"] for r in first.data["results"])

    again = auth_client.post("/api/v1/activities/sync", payload, format="json")
    assert again.status_code == 200
    assert again.data["created"] == 0
    assert again.data["exists"] == 2
    assert Activity.objects.count() == 2


@pytest.mark.django_db
def test_sync_duplicado_dentro_del_lote(auth_client):
    payload = {"items": [item("cid-bbbb0001"), item("cid-bbbb0001")]}
    resp = auth_client.post("/api/v1/activities/sync", payload, format="json")
    assert resp.data["created"] == 1
    assert resp.data["exists"] == 1
    assert Activity.objects.count() == 1


@pytest.mark.django_db
def test_sync_item_invalido_no_envenena_el_lote(auth_client):
    payload = {"items": [item("cid-cccc0001", duration_sec=0), item("cid-cccc0002")]}
    resp = auth_client.post("/api/v1/activities/sync", payload, format="json")
    assert resp.status_code == 200
    assert resp.data["created"] == 1
    assert resp.data["invalid"] == 1
    bad = next(r for r in resp.data["results"] if r["status"] == "invalid")
    assert bad["client_id"] == "cid-cccc0001"
    assert "duration_sec" in bad["errors"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "bad",
    [
        {"client_id": "corto"},  # < 8 chars
        {"client_id": "        "},  # solo espacios
        {"rpe": 11},
        {"kcal": 50_000},
        {"kind": "YOGA"},
        {"started_at": "2019-12-31T23:00:00Z"},  # antes del suelo
        {"note": "x" * 2001},
        {"detail": {"blob": "x" * 9000}},  # > 8 KB
    ],
)
def test_sync_validaciones_por_item(auth_client, bad):
    resp = auth_client.post("/api/v1/activities/sync", {"items": [item(**bad)]}, format="json")
    assert resp.status_code == 200
    assert resp.data["invalid"] == 1
    assert Activity.objects.count() == 0


@pytest.mark.django_db
def test_sync_fecha_futura_invalida(auth_client):
    future = (timezone.now() + timedelta(hours=1)).isoformat()
    resp = auth_client.post(
        "/api/v1/activities/sync", {"items": [item(started_at=future)]}, format="json"
    )
    assert resp.data["invalid"] == 1


@pytest.mark.django_db
def test_sync_limite_de_lote(auth_client):
    items = [item(f"cid-lote-{i:04d}") for i in range(501)]
    resp = auth_client.post("/api/v1/activities/sync", {"items": items}, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_sync_payload_invalido(auth_client):
    for payload in ({}, {"items": []}, {"items": "no-lista"}):
        resp = auth_client.post("/api/v1/activities/sync", payload, format="json")
        assert resp.status_code == 400


@pytest.mark.django_db
def test_list_y_filtros(auth_client):
    auth_client.post(
        "/api/v1/activities/sync",
        {"items": [item("cid-list-0001"), item("cid-list-0002", kind="GYM", title="Pierna")]},
        format="json",
    )
    todo = auth_client.get("/api/v1/activities")
    assert todo.status_code == 200
    assert len(todo.data) == 2
    assert todo.data[0]["load_au"] == 210  # 1800s = 30 min × RPE 7
    assert todo.data[0]["client_id"]

    gym = auth_client.get("/api/v1/activities?kind=GYM")
    assert len(gym.data) == 1
    assert auth_client.get("/api/v1/activities?kind=YOGA").status_code == 400
    assert auth_client.get("/api/v1/activities?limit=abc").status_code == 400


@pytest.mark.django_db
def test_delete_solo_lo_propio(auth_client):
    created = auth_client.post(
        "/api/v1/activities/sync", {"items": [item("cid-del-00001")]}, format="json"
    )
    pk = created.data["results"][0]["id"]

    other = make_client("otro@test.com")
    assert other.delete(f"/api/v1/activities/{pk}").status_code == 404

    assert auth_client.delete(f"/api/v1/activities/{pk}").status_code == 204
    assert Activity.objects.count() == 0


@pytest.mark.django_db
def test_delete_masivo_por_kind(auth_client):
    auth_client.post(
        "/api/v1/activities/sync",
        {"items": [item("cid-bulk-0001"), item("cid-bulk-0002", kind="MMA")]},
        format="json",
    )
    # sin kind ni all=1 -> 400 (nada de borrados accidentales)
    assert auth_client.delete("/api/v1/activities").status_code == 400
    resp = auth_client.delete("/api/v1/activities?kind=SPORT")
    assert resp.data["deleted"] == 1
    assert Activity.objects.filter(kind="MMA").count() == 1
