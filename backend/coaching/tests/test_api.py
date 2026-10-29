from pathlib import Path

import pytest
from rest_framework.test import APIClient

from coaching.engine import ENGINE_SHA
from coaching.models import KnowledgeRule, RuleTranslation
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token

RMR_KEY = "nutrition/default-rmr-equation-mifflin-st-jeor"


@pytest.fixture
def auth_client(db):
    user = user_create(email="k@test.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": "k@test.com", "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return client


@pytest.mark.parametrize(
    "path",
    [
        f"/api/v1/knowledge/rules/{RMR_KEY}",
        "/api/v1/knowledge/rules?q=rmr",
        "/api/v1/knowledge/sources/S819",
        "/api/v1/coach/engine",
    ],
)
@pytest.mark.django_db
def test_endpoints_require_auth(path):
    assert APIClient().get(path).status_code == 401


@pytest.mark.django_db
def test_rule_detail_with_sources(auth_client, real_knowledge):
    resp = auth_client.get(f"/api/v1/knowledge/rules/{RMR_KEY}")
    assert resp.status_code == 200
    d = resp.json()
    assert d["key"] == RMR_KEY
    assert d["heading"] == "Default RMR equation: Mifflin-St Jeor"
    assert d["grade"] == "moderate"
    assert d["file"] == "nutrition" and d["origin"] == "upstream"
    assert "Mifflin-St Jeor" in d["rule_text"]
    assert d["applies_to"].startswith("Healthy ambulatory adults")
    assert d["conflicts"]
    assert [s["sid"] for s in d["sources"]][:3] == ["S161", "S163", "S267"]
    s819 = next(s for s in d["sources"] if s["sid"] == "S819")
    assert s819["doi"] == "10.1093/ajcn/51.2.241"
    assert d["translation"] is None


@pytest.mark.django_db
def test_rule_detail_unknown_key_is_404(auth_client, real_knowledge):
    assert auth_client.get("/api/v1/knowledge/rules/nutrition/inventada").status_code == 404


@pytest.mark.django_db
def test_rule_detail_returns_the_translation_of_the_request_language(auth_client, real_knowledge):
    rule = KnowledgeRule.objects.get(key=RMR_KEY)
    RuleTranslation.objects.create(
        rule=rule, lang="es", heading="Ecuación de RMR por defecto", rule_text="Usa Mifflin-St Jeor.",
        status="machine", source_hash=rule.source_hash,
    )
    es = auth_client.get(f"/api/v1/knowledge/rules/{RMR_KEY}", HTTP_ACCEPT_LANGUAGE="es").json()
    assert es["translation"]["lang"] == "es"
    assert es["translation"]["status"] == "machine"
    assert es["translation"]["rule_text"] == "Usa Mifflin-St Jeor."
    en = auth_client.get(f"/api/v1/knowledge/rules/{RMR_KEY}", HTTP_ACCEPT_LANGUAGE="en").json()
    assert en["translation"] is None  # en: se muestra el original
    assert en["rule_text"].startswith("Use Mifflin-St Jeor")


@pytest.mark.django_db
def test_search_by_heading_and_section(auth_client, real_knowledge):
    d = auth_client.get("/api/v1/knowledge/rules?q=mifflin").json()
    keys = [r["key"] for r in d["results"]]
    assert RMR_KEY in keys
    assert set(d["results"][0]) >= {"key", "heading", "section", "grade", "file"}
    by_section = auth_client.get("/api/v1/knowledge/rules?q=estimating energy").json()["results"]
    assert any(r["key"] == RMR_KEY for r in by_section)


@pytest.mark.django_db
def test_search_matches_translated_heading_and_skips_retired(auth_client, real_knowledge):
    rule = KnowledgeRule.objects.get(key=RMR_KEY)
    RuleTranslation.objects.create(rule=rule, lang="es", heading="Ecuación de metabolismo basal", status="machine")
    es = auth_client.get("/api/v1/knowledge/rules?q=metabolismo basal", HTTP_ACCEPT_LANGUAGE="es").json()["results"]
    assert [r["key"] for r in es] == [RMR_KEY]
    assert es[0]["title"] == "Ecuación de metabolismo basal"
    KnowledgeRule.objects.filter(key=RMR_KEY).update(retired=True)
    assert auth_client.get("/api/v1/knowledge/rules?q=mifflin").json()["results"] == []


@pytest.mark.django_db
def test_search_without_query_is_empty_and_limited(auth_client, real_knowledge):
    assert auth_client.get("/api/v1/knowledge/rules").json()["results"] == []
    assert len(auth_client.get("/api/v1/knowledge/rules?q=a").json()["results"]) <= 50


@pytest.mark.django_db
def test_source_detail_has_no_supports_text(auth_client, real_knowledge):
    d = auth_client.get("/api/v1/knowledge/sources/S819").json()
    assert set(d) == {"sid", "citation", "type", "doi", "url"}
    assert "498 healthy subjects" not in str(d)
    assert auth_client.get("/api/v1/knowledge/sources/S99999").status_code == 404


@pytest.mark.django_db
def test_engine_endpoint(auth_client, real_knowledge):
    d = auth_client.get("/api/v1/coach/engine").json()
    assert d == {"sha": "69e5537", "sha_full": ENGINE_SHA, "knowledge_checked_on": "2026-10-24"}


@pytest.mark.django_db
def test_engine_endpoint_without_loaded_knowledge_reads_the_files(auth_client):
    assert auth_client.get("/api/v1/coach/engine").json()["knowledge_checked_on"] == "2026-10-24"


def test_engine_sha_matches_upstream_md():
    upstream = Path(__file__).resolve().parents[2] / "vendor" / "UPSTREAM.md"
    assert ENGINE_SHA in upstream.read_text(encoding="utf-8")
