"""Proxy de Open Food Facts (Task 8.3) y catálogo de productos.

Nunca hay red de verdad: `urlopen` está simulado en todos los tests y el contacto es inventado
(`test@example.invalid`). Sin contacto configurado no se llama nunca a OFF.
"""
import io
import json
import urllib.error
from datetime import timedelta
from unittest import mock

import pytest
from coach import off
from django.test import override_settings
from django.utils import timezone

from coaching import off_proxy
from coaching.models import CatalogueProduct, OffLookup

from .helpers import TODAY, client_for, make_user, today_fixed  # noqa: F401

pytestmark = pytest.mark.django_db

CONTACT = "test@example.invalid"
BARCODE = "8480000123456"
RAW = {
    "code": BARCODE,
    "product_name": "Revuelto de verduras",
    "product_name_es": "Revuelto de verduras congelado",
    "brands": "Hacendado",
    "stores": "Mercadona",
    "product_quantity_unit": "g",
    "allergens_tags": ["en:celery"],
    "nutriments": {"energy-kcal_100g": 45, "proteins_100g": 2.1, "carbohydrates_100g": 5.2, "fat_100g": 1.1,
                   "fiber_100g": 2.8},
}


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def answer(payload: dict):
    return FakeResponse(json.dumps(payload).encode())


def product_answer():
    return answer({"status": "success", "code": BARCODE, "product": RAW})


@pytest.fixture
def net():
    """La red simulada: cualquier `urlopen` de este módulo pasa por aquí."""
    with mock.patch("coaching.off_proxy.urllib.request.urlopen") as urlopen:
        yield urlopen


@pytest.fixture
def contact():
    with override_settings(COACH_OFF_CONTACT=CONTACT):
        yield


# ---------------------------------------------------------------- sin configurar


def test_contact_variable_is_the_one_the_coach_reads():
    assert off.CONTACT_ENV == "COACH_OFF_CONTACT"


@override_settings(COACH_OFF_CONTACT="")
def test_without_contact_off_is_never_called(net, today_fixed):
    c = client_for(make_user())
    for url in ("/api/v1/coach/products/search?q=revuelto", f"/api/v1/coach/products/lookup/{BARCODE}"):
        resp = c.get(url)
        assert resp.status_code == 503
        assert resp.json()["code"] == "off_not_configured"
    add = c.post("/api/v1/coach/products", {"barcode": BARCODE}, format="json")
    assert add.status_code == 503 and add.json()["code"] == "off_not_configured"
    net.assert_not_called()


@override_settings(COACH_OFF_CONTACT="")
def test_without_contact_the_cache_is_not_used_either(net):
    OffLookup.objects.create(kind="product", key=BARCODE, payload={"barcode": BARCODE}, fetched_at=timezone.now())
    with pytest.raises(off_proxy.OffError, match="off_not_configured"):
        off_proxy.product(BARCODE)
    net.assert_not_called()


# ---------------------------------------------------------------- con contacto


def test_user_agent_is_fightlab_with_the_configured_contact(net, contact):
    net.return_value = product_answer()
    found = off_proxy.product(BARCODE)
    request = net.call_args.args[0]
    assert request.get_header("User-agent") == f"FightLab/{off_proxy.APP_VERSION} ({CONTACT})"
    assert request.full_url == off_proxy.product_url(BARCODE)
    assert net.call_args.kwargs["timeout"] == off.OFF_TIMEOUT_S
    assert found["name"] == "Revuelto de verduras congelado"
    assert found["url"] == f"https://world.openfoodfacts.org/product/{BARCODE}"
    assert found["per"] == "100 g"


def test_urls_match_the_coach_module(contact):
    """Contrato con `coach.off`: las mismas URL que construiría el motor, con los dos campos que
    pide la valoración de la fase 13 (`EXTRA_FIELDS`) al final de `fields`."""
    seen = []
    with mock.patch.object(off, "_get_json", side_effect=lambda url: seen.append(url) or {"hits": []}):
        off.search(["revuelto", "verduras"], "Hacendado", language="es")
        off.product(BARCODE)
    terms = off_proxy.search_terms(["revuelto", "verduras"], "Hacendado")
    extra = "%2C" + "%2C".join(off_proxy.EXTRA_FIELDS)
    assert off_proxy.search_url(terms, "es") == seen[0].replace("%2Cnutriments", "%2Cnutriments" + extra)
    assert off_proxy.product_url(BARCODE) == seen[1].replace("%2Cnutriments", "%2Cnutriments" + extra)
    assert off_proxy.FIELDS[: len(off.FIELDS)] == off.FIELDS


def test_products_are_cached(net, contact):
    net.side_effect = lambda *a, **k: product_answer()
    off_proxy.product(BARCODE)
    off_proxy.product(BARCODE)
    assert net.call_count == 1
    OffLookup.objects.update(fetched_at=timezone.now() - off_proxy.CACHE_TTL["product"] - timedelta(minutes=1))
    off_proxy.product(BARCODE)
    assert net.call_count == 2


def test_rate_limit_for_the_whole_server(net, contact):
    now = timezone.now()
    OffLookup.objects.bulk_create(
        OffLookup(kind="search", key=f"k{i}", payload=[], fetched_at=now) for i in range(off_proxy.LIMITS_PER_MINUTE["search"])
    )
    with pytest.raises(off_proxy.OffError, match="off_rate_limited"):
        off_proxy.search(["leche"], None, "es")
    net.assert_not_called()


def test_off_busy_and_not_found(net, contact):
    net.side_effect = urllib.error.HTTPError("u", 503, "busy", {}, None)
    with pytest.raises(off_proxy.OffError, match="off_busy"):
        off_proxy.product(BARCODE)
    net.side_effect = urllib.error.HTTPError("u", 404, "nf", {}, io.BytesIO(b'{"status": "failure"}'))
    assert off_proxy.product("8480000999999") is None


def test_bad_input_never_reaches_off(net, contact):
    with pytest.raises(off_proxy.OffError, match="barcode_invalid"):
        off_proxy.product("123")
    with pytest.raises(off_proxy.OffError, match="search_empty"):
        off_proxy.search(['"*:'], None, "es")
    net.assert_not_called()


def test_search_api_keeps_attribution(net, contact, today_fixed):
    net.return_value = answer({"hits": [RAW]})
    resp = client_for(make_user()).get("/api/v1/coach/products/search", {"q": "revuelto", "brand": "Hacendado"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "Open Food Facts (unverified)" and body["licence"] == "ODbL"
    assert body["hits"][0]["url"].startswith("https://world.openfoodfacts.org/product/")
    # Fase 13: cada resultado lleva su valoración (sin Nutri-Score ni saturada: sin datos).
    assert body["hits"][0]["rating"]["rating"] == "sin datos"


RATED_RAW = {**RAW, "nutriscore_grade": "a", "categories_tags": ["en:frozen-foods", "en:vegetables"],
             "nutriments": {**RAW["nutriments"], "saturated-fat_100g": 0.2, "sugars_100g": 2.5, "salt_100g": 0.3}}


def test_off_products_are_rated_with_the_same_engine(net, contact, today_fixed):
    """Los productos del proxy (F8) se valoran como los de la cadena, y se guarda lo que hace falta."""
    net.side_effect = lambda *a, **k: answer({"status": "success", "code": BARCODE, "product": RATED_RAW})
    user = make_user()
    c = client_for(user)
    looked = c.get(f"/api/v1/coach/products/lookup/{BARCODE}").json()
    assert looked["product"]["rating"]["rating"] == "bueno"
    assert looked["product"]["rating"]["nutriscore"] == "A"
    assert looked["product"]["rating"]["rule_key"].startswith("food-products/")
    assert c.post("/api/v1/coach/products", {"barcode": BARCODE}, format="json").status_code == 201
    row = CatalogueProduct.objects.get(profile=user.profile)
    assert (row.nutriscore, row.sugars_g, row.saturates_g, row.salt_g) == ("A", 2.5, 0.2, 0.3)
    assert row.off_tags == ["en:frozen-foods", "en:vegetables"]
    listed = c.get("/api/v1/coach/products").json()["products"][0]
    assert listed["rating"]["rating"] == "bueno" and listed["rating"]["lights"]["salt"] == "green"


# ---------------------------------------------------------------- catálogo


def test_add_product_is_unverified_with_its_url_and_used_in_menus(net, contact, today_fixed):
    net.return_value = product_answer()
    user = make_user()
    c = client_for(user)
    resp = c.post("/api/v1/coach/products", {"barcode": BARCODE, "chain": "Mercadona"}, format="json")
    assert resp.status_code == 201, resp.json()
    product = resp.json()["product"]
    assert product["unverified"] is True and product["source"] == "Open Food Facts (unverified)"
    assert product["url"].endswith(BARCODE) and product["allergens"] == ["en:celery"]
    row = CatalogueProduct.objects.get(profile=user.profile)
    assert row.kcal == 45 and row.fibre_g == 2.8
    # El producto ya es un alimento para el motor: por su nombre o por su código de barras.
    found = c.get("/api/v1/coach/foods", {"q": BARCODE}).json()["foods"]
    assert found[0]["kind"] == "product" and found[0]["unverified"] is True
    draft = {"days": [{"date": TODAY.isoformat(), "meals": [
        {"meal": "lunch", "dishes": [{"dish": "Revuelto", "items": [f"{BARCODE}=200"]}]}]}]}
    checked = c.post("/api/v1/coach/menu/check", draft, format="json").json()
    assert checked["days"][0]["totals"]["kcal"] == 90
    assert c.delete(f"/api/v1/coach/products/{BARCODE}").status_code == 204


def test_add_product_needs_name_and_unit(net, contact, today_fixed):
    raw = {**RAW, "product_name": "", "product_name_es": "", "product_quantity_unit": None}
    net.side_effect = lambda *a, **k: answer({"status": "success", "code": BARCODE, "product": raw})
    c = client_for(make_user())
    assert c.post("/api/v1/coach/products", {"barcode": BARCODE}, format="json").json()["code"] == "name_needed"
    resp = c.post("/api/v1/coach/products", {"barcode": BARCODE, "name": "Mi revuelto"}, format="json")
    assert resp.json()["code"] == "per_needed"
    ok = c.post("/api/v1/coach/products", {"barcode": BARCODE, "name": "Mi revuelto", "per": "100 g"}, format="json")
    assert ok.status_code == 201


def test_add_product_refuses_a_name_already_in_the_table(net, contact, today_fixed):
    net.return_value = product_answer()
    resp = client_for(make_user()).post(
        "/api/v1/coach/products", {"barcode": BARCODE, "name": "tomate"}, format="json"
    )
    assert resp.json()["code"] == "name_taken"
