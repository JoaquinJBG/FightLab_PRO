"""Escáner de código de barras: `GET/POST /coach/barcode/<código>`.

Orden de búsqueda: el catálogo de cadena privado (`ChainProduct` por EAN), los productos guardados
del usuario (`CatalogueProduct`, de OFF o creados a mano) y, por último, el proxy de Open Food Facts
con su caché. Nunca hay red de verdad: `urlopen` está simulado y el contacto es inventado. Todos los
productos y códigos son INVENTADOS.
"""
import io
import json
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from coaching import barcode
from coaching.models import CatalogueProduct, ChainProduct, OffLookup

from .helpers import TODAY, client_for, make_user, today_fixed  # noqa: F401

pytestmark = pytest.mark.django_db

CONTACT = "test@example.invalid"
CHAIN_EAN = "2000000000059"
OFF_EAN = "8400000000017"
UPC_A = "036000291452"  # 12 cifras: en el catálogo como EAN-13 con un 0 delante
RAW = {
    "code": OFF_EAN,
    "product_name": "Yogur inventado",
    "brands": "Marca Prueba",
    "product_quantity_unit": "g",
    "serving_quantity": "125",
    "nutriscore_grade": "a",
    "categories_tags": ["en:yogurts"],
    "nutriments": {"energy-kcal_100g": 60, "proteins_100g": 4, "carbohydrates_100g": 5, "fat_100g": 2.5,
                   "fiber_100g": 0, "sugars_100g": 4, "saturated-fat_100g": 1.5, "salt_100g": 0.1},
}
HEADER = (
    "mercadona_id,ean,nombre,marca,categoria,formato,precio_kilo,kcal,protein_g,carbs_g,fat_g,saturadas_g,"
    "sugars_g,salt_g,fibre_g,nutriscore,nova,bebida,azucar,saturadas,sal,grasa,valoracion,motivo,"
    "valores_coherentes,en_tabla_app,fuente\n"
)
CSV = HEADER + (
    f"91001,{CHAIN_EAN},Pechuga inventada,Marca Prueba,Aves,Bandeja 500 g,8.00,110,23,0,1.5,0.4,0,0.2,0,A,1,,,,,,bueno,,sí,,\n"
    f"91002,0{UPC_A},Cereales inventados,Marca Prueba,Cereales,Caja 375 g,4.00,380,8,80,2,0.5,8,0.6,6,A,3,,,,,,bueno,,sí,,\n"
)


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def answer(payload: dict):
    return FakeResponse(json.dumps(payload).encode())


@pytest.fixture
def net():
    with mock.patch("coaching.off_proxy.urllib.request.urlopen") as urlopen:
        yield urlopen


@pytest.fixture
def contact():
    with override_settings(COACH_OFF_CONTACT=CONTACT):
        yield


@pytest.fixture
def user():
    return make_user()


@pytest.fixture
def client(user):
    return client_for(user)


def import_chain(client):
    r = client.post(
        "/api/v1/coach/chain-products/import",
        {"file": SimpleUploadedFile("catalogo.csv", CSV.encode(), content_type="text/csv")},
        format="multipart",
    )
    assert r.status_code == 201, r.data
    assert ChainProduct.objects.filter(ean=CHAIN_EAN).exists()


# ---------------------------------------------------------------- variantes del código


@pytest.mark.parametrize("code, variants", [
    ("12345670", ["12345670"]),
    (UPC_A, [UPC_A, "0" + UPC_A]),
    ("0" + UPC_A, ["0" + UPC_A, UPC_A]),
    ("00" + UPC_A, ["00" + UPC_A, "0" + UPC_A, UPC_A]),
])
def test_variants_cover_upc_a_and_gtin_14(code, variants):
    assert barcode.variants(code) == variants


# ---------------------------------------------------------------- orden de búsqueda


def test_chain_product_first_and_off_is_never_called(client, net, contact):
    import_chain(client)
    r = client.get(f"/api/v1/coach/barcode/{CHAIN_EAN}")
    assert r.status_code == 200, r.data
    assert r.data["source"] == "chain"
    p = r.data["product"]
    assert (p["barcode"], p["name"], p["chain"], p["per"], p["kcal"], p["protein_g"]) == (
        CHAIN_EAN, "Pechuga inventada", "Mercadona", "100 g", 110, 23)
    assert p["pack_g"] == 500
    assert p["rating"]["rating"] == "bueno" and p["rating"]["rule_key"]
    assert net.call_count == 0


def test_upc_a_finds_the_ean_13_of_the_chain(client, net, contact):
    import_chain(client)
    r = client.get(f"/api/v1/coach/barcode/{UPC_A}")
    assert r.status_code == 200
    assert r.data["product"]["name"] == "Cereales inventados"
    assert net.call_count == 0


def test_saved_product_before_off(client, user, net, contact):
    CatalogueProduct.objects.create(
        profile=user.profile, barcode=OFF_EAN, product_name="Yogur guardado", per="100 g", kcal=60, protein_g=4,
        carbs_g=5, fat_g=2.5, url=f"https://world.openfoodfacts.org/product/{OFF_EAN}", fetched_on=TODAY,
    )
    r = client.get(f"/api/v1/coach/barcode/{OFF_EAN}")
    assert r.status_code == 200
    assert (r.data["source"], r.data["product"]["name"]) == ("catalogue", "Yogur guardado")
    assert net.call_count == 0


def test_off_last_with_rating_serving_and_attribution(client, net, contact):
    net.return_value = answer({"status": "success", "code": OFF_EAN, "product": RAW})
    r = client.get(f"/api/v1/coach/barcode/{OFF_EAN}")
    assert r.status_code == 200, r.data
    assert r.data["source"] == "off"
    assert r.data["attribution"]["licence"] == "ODbL"
    p = r.data["product"]
    assert (p["name"], p["brand"], p["kcal"], p["serving_g"], p["unverified"]) == (
        "Yogur inventado", "Marca Prueba", 60, 125, True)
    assert p["url"].endswith(OFF_EAN)
    assert p["rating"]["nutriscore"] == "A"


def test_same_code_twice_calls_off_once(client, net, contact):
    net.return_value = answer({"status": "success", "code": OFF_EAN, "product": RAW})
    assert client.get(f"/api/v1/coach/barcode/{OFF_EAN}").status_code == 200
    assert client.get(f"/api/v1/coach/barcode/{OFF_EAN}").status_code == 200
    assert net.call_count == 1


def test_not_found_is_404_and_is_not_asked_again(client, net, contact):
    net.return_value = answer({"status": "failure", "code": "8400000000024"})
    for _ in range(2):
        r = client.get("/api/v1/coach/barcode/8400000000024")
        assert r.status_code == 404
        assert r.data == {"code": "not_found", "barcode": "8400000000024", "off": None}
    assert net.call_count == 1
    assert OffLookup.objects.get(key="8400000000024").payload is None


@override_settings(COACH_OFF_CONTACT="")
def test_without_off_the_private_catalogue_still_works(client, net):
    import_chain(client)
    assert client.get(f"/api/v1/coach/barcode/{CHAIN_EAN}").data["source"] == "chain"
    r = client.get(f"/api/v1/coach/barcode/{OFF_EAN}")
    assert r.status_code == 404
    assert r.data == {"code": "not_found", "barcode": OFF_EAN, "off": "off_not_configured"}
    assert net.call_count == 0


def test_off_down_says_so(client, net, contact):
    net.side_effect = TimeoutError("lento")
    r = client.get(f"/api/v1/coach/barcode/{OFF_EAN}")
    assert r.status_code == 404
    assert r.data["off"] == "off_unavailable"


@pytest.mark.parametrize("code", ["123", "abcdefghijk", "123456789012345"])
def test_bad_code_is_400(client, net, contact, code):
    r = client.get(f"/api/v1/coach/barcode/{code}")
    assert r.status_code == 400
    assert r.data["code"] == "barcode_invalid"
    assert net.call_count == 0


def test_another_users_catalogue_is_not_seen(client, net):
    import_chain(client)
    other = client_for(make_user())
    with override_settings(COACH_OFF_CONTACT=""):
        assert other.get(f"/api/v1/coach/barcode/{CHAIN_EAN}").status_code == 404


def test_login_required(net):
    from rest_framework.test import APIClient

    assert APIClient().get(f"/api/v1/coach/barcode/{OFF_EAN}").status_code == 401


# ---------------------------------------------------------------- crear a mano


MANUAL = {"name": "Galleta Zumbulix", "brand": "Casa", "per": "100 g", "kcal": 520, "protein_g": 10,
          "carbs_g": 50, "fat_g": 30, "sugars_g": 40, "saturates_g": 4, "salt_g": 0.1}


def test_create_by_hand_then_scan_finds_it(client, user, net, today_fixed):
    r = client.post("/api/v1/coach/barcode/8400000000031", MANUAL, format="json")
    assert r.status_code == 201, r.data
    assert r.data["source"] == "manual"
    p = r.data["product"]
    assert (p["name"], p["kcal"], p["url"], p["unverified"]) == ("Galleta Zumbulix", 520, None, False)
    assert p["rating"]["rating"] == "evitar"  # 40 g de azúcar: rojo
    saved = CatalogueProduct.objects.get(profile=user.profile, barcode="8400000000031")
    assert (saved.source, saved.unverified, saved.fetched_on) == (barcode.MANUAL_SOURCE, False, TODAY)

    with override_settings(COACH_OFF_CONTACT=""):
        again = client.get("/api/v1/coach/barcode/8400000000031")
    assert again.status_code == 200
    assert again.data["source"] == "manual"
    assert net.call_count == 0

    # Sale en la búsqueda de alimentos de Nutrición.
    foods = client.get("/api/v1/coach/foods?q=zumbulix").data["foods"]
    assert [f["name"] for f in foods] == ["Galleta Zumbulix"]


def test_create_by_hand_edits_its_own(client, today_fixed):
    assert client.post("/api/v1/coach/barcode/8400000000031", MANUAL, format="json").status_code == 201
    r = client.post("/api/v1/coach/barcode/8400000000031", {**MANUAL, "kcal": 500}, format="json")
    assert r.status_code == 201
    assert r.data["product"]["kcal"] == 500
    assert CatalogueProduct.objects.filter(barcode="8400000000031").count() == 1


def test_create_by_hand_does_not_overwrite_off_or_chain(client, user, today_fixed):
    import_chain(client)
    CatalogueProduct.objects.create(
        profile=user.profile, barcode=OFF_EAN, product_name="Yogur guardado", per="100 g", kcal=60,
        url=f"https://world.openfoodfacts.org/product/{OFF_EAN}", fetched_on=TODAY,
    )
    for code in (CHAIN_EAN, OFF_EAN):
        r = client.post(f"/api/v1/coach/barcode/{code}", MANUAL, format="json")
        assert r.status_code == 409
        assert r.data["code"] == "barcode_taken"


@pytest.mark.parametrize("change, field", [
    ({"kcal": 950}, "kcal"),
    ({"kcal": None}, "kcal"),
    ({"protein_g": 120}, "protein_g"),
    ({"name": " "}, "name"),
    ({"per": "1 kg"}, "per"),
])
def test_create_by_hand_validates(client, today_fixed, change, field):
    r = client.post("/api/v1/coach/barcode/8400000000031", {**MANUAL, **change}, format="json")
    assert r.status_code == 400
    assert field in r.data


def test_create_by_hand_name_of_an_engine_food_is_refused(client, today_fixed):
    r = client.post("/api/v1/coach/barcode/8400000000031", {**MANUAL, "name": "pechuga de pollo, cruda"}, format="json")
    assert r.status_code == 400
    assert r.data["code"] == "name_taken"


def test_create_by_hand_warns_when_energy_does_not_match(client, today_fixed):
    r = client.post("/api/v1/coach/barcode/8400000000031", {**MANUAL, "kcal": 100}, format="json")
    assert r.status_code == 201
    assert r.data["warnings"] == ["kcal_gap"]
