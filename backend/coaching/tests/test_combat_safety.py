"""E.5: el flag `no_contact` por golpe en la cabeza y el bloqueo del contenido de corte.

Reglas del anexo (`knowledge_fightlab/combat-sports.md`): "A head blow with symptoms sets
no-contact and refers" y "No sparring until symptom-free with exertion and cleared" (el flag
solo se quita cuando el atleta confirma el alta de un clínico, nunca por tiempo), "Red flags
after a head blow mean emergency care" y "No weight-cut content for minors, and refer
repeated cutters". Sustituyen a la convención de la spec §8.3.
"""
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from coaching import combat
from coaching.models import HeadImpact
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token

from .flag_rows import ADULT_DOB, TODAY

SAFETY = "/api/v1/coach/safety"
IMPACTS = "/api/v1/coach/head-impacts"
ANNEX = Path(__file__).resolve().parents[2] / "knowledge_fightlab"


def _client(email="hi@b.com", dob=ADULT_DOB):
    user = user_create(email=email, password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    profile = user.profile
    profile.date_of_birth = dob
    profile.height_cm = 175
    profile.gender = "MALE"
    profile.region = "es"
    profile.save()
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": email, "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return user, client


@pytest.fixture
def user_client(db):
    return _client()


@pytest.fixture
def annex(db):
    call_command("load_knowledge", "--dir", str(ANNEX), "--origin", "fightlab", verbosity=0)


@pytest.fixture(autouse=True)
def fixed_today():
    with mock.patch("coaching.safety_views.timezone.localdate", return_value=TODAY):
        yield


def report(client, **over):
    body = {"occurred_on": TODAY.isoformat(), "symptoms": True, "red_flags": False, "origin": "mma_session"}
    body.update(over)
    return client.post(IMPACTS, body, format="json")


def test_without_head_blows_there_is_no_contact_block(user_client):
    _, client = user_client
    data = client.get(SAFETY).data
    assert data["flags"]["no_contact"] is False
    assert not [r for r in data["reasons"] if r["code"].startswith("head_blow")]


def test_a_head_blow_with_symptoms_sets_no_contact_with_its_rule(user_client, annex):
    _, client = user_client
    assert report(client).status_code == 201
    data = client.get(SAFETY).data
    assert data["flags"]["no_contact"] is True
    [reason] = [r for r in data["reasons"] if r["code"] == "head_blow_no_contact"]
    assert reason["rule_key"] == combat.NO_CONTACT_RULE
    assert reason["grade"] == "strong"
    assert reason["severity"] == "refer"
    assert "clínico" in reason["text"] and "CRT6" in reason["text"]
    assert reason["professional"]
    # Deriva: termina con la línea de derivación y enlaza al CRT6 oficial, sin copiarlo.
    assert data["refer_gp"] is True and data["deferral_line"]
    assert data["crt6_url"].startswith("https://")


def test_a_head_blow_without_symptoms_does_not_block(user_client):
    _, client = user_client
    report(client, symptoms=False)
    assert client.get(SAFETY).data["flags"]["no_contact"] is False


def test_red_flags_add_an_emergency_reason_on_the_day(user_client, annex):
    _, client = user_client
    report(client, red_flags=True)
    data = client.get(SAFETY).data
    codes = [r["code"] for r in data["reasons"]]
    assert codes[:2] == ["head_blow_red_flags", "head_blow_no_contact"]  # urgencias primero
    red = data["reasons"][0]
    assert red["severity"] == "stop" and red["grade"] == "strong"
    assert red["rule_key"] == combat.RED_FLAGS_RULE
    assert data["emergency_number"] == "112"
    # Con señales de alarma cuenta como síntoma aunque no se marque.
    assert data["flags"]["no_contact"] is True


def test_red_flags_of_an_older_blow_leave_only_the_block(user_client):
    _, client = user_client
    report(client, occurred_on=(TODAY - timedelta(days=3)).isoformat(), red_flags=True)
    codes = [r["code"] for r in client.get(SAFETY).data["reasons"]]
    assert "head_blow_red_flags" not in codes and "head_blow_no_contact" in codes


def test_the_block_never_lifts_on_a_timer(user_client):
    _, client = user_client
    report(client, occurred_on=(TODAY - timedelta(days=120)).isoformat())
    assert client.get(SAFETY).data["flags"]["no_contact"] is True


def test_clinician_clearance_lifts_the_block(user_client):
    _, client = user_client
    impact = report(client).data
    resp = client.patch(f"{IMPACTS}/{impact['id']}", {"cleared_on": TODAY.isoformat(), "cleared_by": "médico del club"}, format="json")
    assert resp.status_code == 200 and resp.data["cleared_on"] == TODAY.isoformat()
    assert client.get(SAFETY).data["flags"]["no_contact"] is False


def test_clearance_cannot_predate_the_blow(user_client):
    _, client = user_client
    impact = report(client).data
    resp = client.patch(f"{IMPACTS}/{impact['id']}", {"cleared_on": (TODAY - timedelta(days=1)).isoformat()}, format="json")
    assert resp.status_code == 400


def test_a_blow_cannot_be_in_the_future(user_client):
    _, client = user_client
    assert report(client, occurred_on=(TODAY + timedelta(days=1)).isoformat()).status_code == 400


def test_one_open_blow_is_enough_and_the_list_is_private(user_client, db):
    user, client = user_client
    first = report(client).data
    report(client, occurred_on=(TODAY - timedelta(days=1)).isoformat())
    client.patch(f"{IMPACTS}/{first['id']}", {"cleared_on": TODAY.isoformat()}, format="json")
    assert client.get(SAFETY).data["flags"]["no_contact"] is True  # el otro sigue sin alta
    assert len(client.get(IMPACTS).data) == 2

    _, other = _client("other@b.com")
    assert other.get(IMPACTS).data == []
    assert other.patch(f"{IMPACTS}/{first['id']}", {"cleared_on": TODAY.isoformat()}, format="json").status_code == 404


def test_flags_helper_reads_the_model(user_client):
    user, _ = user_client
    HeadImpact.objects.create(profile=user.profile, occurred_on=TODAY, symptoms=True)
    flags = combat.combat_flags(user.profile, TODAY)
    assert flags.no_contact is True and [r.code for r in flags.reasons] == ["head_blow_no_contact"]


def test_minors_get_no_weight_cut_content(db):
    _, client = _client("teen@b.com", dob=date(2010, 1, 1))
    assert client.get(SAFETY).data["flags"]["no_cut_content"] is True


def test_adults_may_see_weight_cut_information(user_client):
    _, client = user_client
    assert client.get(SAFETY).data["flags"]["no_cut_content"] is False
