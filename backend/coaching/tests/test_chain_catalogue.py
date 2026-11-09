"""Catálogo de cadena privado (fase 13): importar, valorar, compra, coste y sustitutos.

Todos los productos son INVENTADOS (nombres, ids, EAN, valores y precios): nunca se copian filas de
los archivos reales del usuario, que no tienen licencia para estar en un repositorio público.
"""
from django.core.files.uploadedfile import SimpleUploadedFile
import pytest

from coaching import chain_catalogue, chain_import, product_rating
from coaching.models import ChainProduct

from .helpers import client_for, make_user

pytestmark = pytest.mark.django_db

SCORED_HEADER = (
    "mercadona_id,ean,nombre,marca,categoria,formato,precio_kilo,kcal,protein_g,carbs_g,fat_g,saturadas_g,"
    "sugars_g,salt_g,fibre_g,nutriscore,nova,bebida,azucar,saturadas,sal,grasa,valoracion,motivo,"
    "valores_coherentes,en_tabla_app,fuente\n"
)
# 1: bueno. 2: el archivo dice bueno, el motor dice evitar (azúcar). 3: aceite (solo Nutri-Score).
# 4: bebida. 5: no aplica. 6: kcal que no cuadran (revisar).
SCORED = SCORED_HEADER + (
    "90001,2000000000011,Pechuga inventada de ave,Marca Prueba,Aves,Bandeja 500 g,8.00,110,23,0,1.5,0.4,0,0.2,0,A,1,,verde,verde,verde,verde,bueno,,sí,,https://example.invalid/1\n"
    "90002,2000000000028,Galleta inventada,Marca Prueba,Galletas,Paquete 200 g,4.50,450,7,70,15,3,25,0.5,3,B,4,,rojo,ámbar,ámbar,ámbar,bueno,,sí,,https://example.invalid/2\n"
    "90003,2000000000035,Aceite inventado,Marca Prueba,Aceite de oliva,Botella 1 l,9.00,820,0,0,91,14,0,0,0,B,2,,verde,rojo,verde,rojo,bueno,,sí,,\n"
    "90004,,Bebida inventada de avena,Marca Prueba,Bebidas vegetales,Brik 1 l,1.20,45,1,7,1.5,0.2,4,0.1,0.8,C,3,sí,ámbar,verde,verde,verde,regular,,sí,,\n"
    "90005,,Cerveza inventada,Marca Prueba,Cerveza lata,Lata 33 cl,1.50,42,0.4,3,0,0,0,0,0,,,sí,,,,,no aplica,,sí,,\n"
    "90006,2000000000042,Barrita inventada,Marca Prueba,Barritas,Caja 6 uds,12.00,200,20,40,10,1,4,0.3,5,B,4,,verde,verde,verde,ámbar,bueno,,no,,\n"
)
TABLE = (
    "name_es,nombre_mercadona,equivale_a,ean,mercadona_id,kcal,protein_g,carbs_g,fat_g,fibre_g,fuente,valoracion\n"
    "pechuga inventada,Pechuga inventada de ave,\"pechuga de pollo, cruda\",2000000000011,90001,,,,,,,\n"
    "pechuga barata inventada,Pechuga barata inventada,\"pechuga de pollo, cruda\",,90010,112,23,0,2,,,\n"
)


def upload(client, text, name="catalogo.csv", **data):
    content = text.encode("utf-8") if isinstance(text, str) else text
    return client.post(
        "/api/v1/coach/chain-products/import",
        {"file": SimpleUploadedFile(name, content, content_type="text/csv"), **data},
        format="multipart",
    )


@pytest.fixture
def user():
    return make_user()


@pytest.fixture
def client(user):
    return client_for(user)


def test_preview_counts_and_saves_nothing(client, user):
    r = upload(client, "﻿" + SCORED, dry_run="1")  # con BOM
    assert r.status_code == 200, r.data
    assert r.data["dry_run"] and r.data["format"] == chain_import.SCORED
    assert (r.data["rows"], r.data["new"], r.data["updated"], r.data["discarded_total"]) == (6, 6, 0, 0)
    assert r.data["ratings"][product_rating.GOOD] == 3  # pechuga, aceite y barrita
    assert r.data["ratings"][product_rating.AVOID] == 1
    assert r.data["ratings"][product_rating.NOT_FOOD] == 1
    assert r.data["review"] == 1
    diff = r.data["differences"]
    assert diff["count"] == 1
    assert diff["examples"][0] == {"line": 3, "name": "Galleta inventada", "file": "bueno", "engine": "evitar"}
    assert not ChainProduct.objects.exists()


def test_import_then_reimport_does_not_duplicate(client, user):
    assert upload(client, SCORED).status_code == 201
    assert ChainProduct.objects.filter(profile=user.profile).count() == 6
    again = upload(client, SCORED).data
    assert (again["new"], again["updated"], again["unchanged"]) == (0, 0, 6)
    changed = upload(client, SCORED.replace("Bandeja 500 g,8.00", "Bandeja 1 kg,7.50")).data
    assert (changed["new"], changed["updated"], changed["unchanged"]) == (0, 1, 5)
    p = ChainProduct.objects.get(chain_ref="90001")
    assert (p.pack, p.price_per_kg, p.chain) == ("Bandeja 1 kg", 7.5, "Mercadona")
    assert p.rating == product_rating.GOOD and p.label_check == "ok"
    drink = ChainProduct.objects.get(chain_ref="90004")
    assert drink.per == "100 ml" and drink.drink is True
    assert ChainProduct.objects.get(chain_ref="90006").label_check == product_rating.REVIEW


def test_app_table_merges_equivalents_without_wiping_values(client, user):
    upload(client, SCORED)
    r = upload(client, TABLE).data
    assert r["format"] == chain_import.TABLE
    assert (r["new"], r["updated"]) == (1, 1)
    p = ChainProduct.objects.get(chain_ref="90001")
    assert p.equivalent_of == "pechuga de pollo, cruda" and p.alias == "pechuga inventada"
    assert p.kcal == 110 and p.saturates_g == 0.4 and p.price_per_kg == 8.0  # las celdas vacías no borran


def test_discarded_rows_say_why_and_where(client):
    text = SCORED_HEADER + (
        ",,Sin clave inventado,,,,,100,1,1,1,,,,,,,,,,,,bueno,,,,\n"
        "90020,,,,,,,100,1,1,1,,,,,,,,,,,,bueno,,,,\n"
        "90021,,Kcal rara inventada,,,,,mucho,1,1,1,,,,,,,,,,,,bueno,,,,\n"
        "90022,,Grasa imposible inventada,,,,,100,1,1,120,,,,,,,,,,,,bueno,,,,\n"
        "90023,,Repetido inventado,,,,,100,10,10,2,,,,,,,,,,,,bueno,,,,\n"
        "90023,,Repetido inventado otra vez,,,,,100,10,10,2,,,,,,,,,,,,bueno,,,,\n"
        "90024,12AB,EAN raro inventado,,,,,100,10,10,2,,,,,,,,,,,,bueno,,,,\n"
    )
    r = upload(client, text, dry_run="1").data
    by_code = {(d["code"], d["field"]): d for d in r["discarded"]}
    assert by_code[("no_key", "")]["lines"] == [2]
    assert by_code[("no_name", "")]["lines"] == [3]
    assert by_code[("bad_number", "kcal")]["lines"] == [4]
    assert by_code[("out_of_range", "fat_g")]["lines"] == [5]
    assert by_code[("duplicate_in_file", "")]["lines"] == [7]
    assert r["new"] == 2 and r["discarded_total"] == 5
    assert {"code": "ean_invalid", "count": 1} in r["notices"]


def test_semicolons_and_decimal_commas(client):
    text = SCORED_HEADER.replace(",", ";") + (
        "90030;;Yogur inventado;Marca Prueba;Yogures;Pack 4;2,50;61,5;4;5,5;3;2;5;0,1;;A;1;;;;;;bueno;;;;\n"
    )
    r = upload(client, text)
    assert r.status_code == 201, r.data
    p = ChainProduct.objects.get(chain_ref="90030")
    assert (p.kcal, p.carbs_g, p.price_per_kg) == (61.5, 5.5, 2.5)


def test_unknown_columns_and_bad_files(client):
    r = upload(client, "a,b,c\n1,2,3\n")
    assert r.status_code == 400 and r.data["code"] == "unknown_columns"
    assert upload(client, SCORED, name="catalogo.xlsx").data["code"] == "not_csv"
    assert client.post("/api/v1/coach/chain-products/import", {}, format="multipart").data["code"] == "missing_file"


def test_catalogue_is_private_and_can_be_deleted(client, user):
    upload(client, SCORED)
    other = make_user()
    other_client = client_for(other)
    assert other_client.get("/api/v1/coach/chain-products").data["total"] == 0
    assert other_client.delete("/api/v1/coach/chain-products").data["deleted"] == 0
    listing = client.get("/api/v1/coach/chain-products").data
    assert listing["total"] == 6 and listing["chains"] == ["Mercadona"]
    assert {t["source"] for t in listing["thresholds"]} >= {"fsa_2016", "nutriscore_2023", "convention"}
    oil = next(p for p in listing["products"] if p["chain_ref"] == "90003")
    assert oil["rule_key"] == product_rating.FATS_RULE
    assert client.get("/api/v1/coach/chain-products", {"rating": "evitar"}).data["matched"] == 1
    assert client.get("/api/v1/coach/chain-products", {"q": "galleta"}).data["matched"] == 1
    assert client.get("/api/v1/coach/chain-products", {"rating": "malo"}).status_code == 400
    assert client.delete("/api/v1/coach/chain-products").data["deleted"] == 6
    assert not ChainProduct.objects.exists()


def test_stale_ratings_are_recomputed_on_read(client, user):
    upload(client, SCORED)
    ChainProduct.objects.update(rating="", rating_version=0)
    client.get("/api/v1/coach/chain-products")
    assert not ChainProduct.objects.filter(rating="").exists()


# ---------------------------------------------------------------- compra y coste


def test_product_for_picks_the_best_rated_then_the_cheapest(client, user):
    upload(client, SCORED)
    upload(client, TABLE)
    # La barata solo viene en la tabla de la app, sin azúcar, saturada ni sal: "sin datos" pierde.
    assert ChainProduct.objects.get(chain_ref="90010").rating == product_rating.NO_DATA
    assert chain_catalogue.product_for(user, "pechuga de pollo, cruda").chain_ref == "90001"
    # Con sus valores completos las dos son "bueno" y gana la más barata por kilo.
    upload(client, SCORED_HEADER + "90010,,Pechuga barata inventada,,Aves,Bandeja 1 kg,6.00,112,23,0,2,0.5,0,0.2,0,A,1,,,,,,,,,,\n")
    assert chain_catalogue.product_for(user, "Pechuga de pollo, CRUDA").chain_ref == "90010"
    # El nombre inglés del alimento del motor también vale.
    assert chain_catalogue.product_for(user, "chicken breast, raw").chain_ref == "90010"
    assert chain_catalogue.product_for(user, "tofu firme") is None


def test_shopping_list_gives_product_pack_and_cost(client, user):
    upload(client, SCORED)
    upload(client, TABLE)
    r = client.post(
        "/api/v1/coach/chain-products/shopping",
        {"items": [{"name": "pechuga de pollo, cruda", "grams": 750}, {"name": "tofu firme", "grams": 200}]},
        format="json",
    )
    assert r.status_code == 200, r.data
    first, second = r.data["items"]
    assert first["product"]["name"] == "Pechuga inventada de ave"
    assert first["product"]["pack"] == "Bandeja 500 g"
    assert first["cost_eur"] == 6.0  # 0,75 kg × 8 €/kg
    assert second["product"] is None and second["cost_eur"] is None
    assert (r.data["total_eur"], r.data["priced"], r.data["unpriced"]) == (6.0, 1, 1)


def test_shopping_list_of_another_user_is_empty(client, user):
    upload(client, SCORED)
    upload(client, TABLE)
    r = chain_catalogue.shopping_for(make_user(), [{"name": "pechuga de pollo, cruda", "grams": 100}])
    assert r["items"][0]["product"] is None and r["total_eur"] is None


# ---------------------------------------------------------------- sustitutos


def test_substitutes_are_isocaloric_and_penalise_avoid(client, user):
    text = SCORED_HEADER + (
        "90040,,Lomo magro inventado,,Carne,,10,120,22,0,3.5,1,0,0.2,0,A,1,,,,,,,,,,\n"
        "90041,,Embutido magro inventado,,Charcutería,,10,120,22,0,3.5,1,0,2.5,0,D,4,,,,,,,,,,\n"
    )
    upload(client, text)
    result = chain_catalogue.substitutes(user, "pechuga de pollo, cruda", 150, limit=500)
    assert result["food"]["kcal"] == 180  # 150 g × 120 kcal/100 g
    names = [s["name"] for s in result["substitutes"]]
    good, avoid = names.index("Lomo magro inventado"), names.index("Embutido magro inventado")
    assert good < avoid
    lean = result["substitutes"][good]
    assert lean["grams"] == 150 and lean["kcal"] == 180 and not lean["penalised"]
    assert result["substitutes"][avoid]["penalised"]
    # Todo lo que va delante del "evitar" no está penalizado.
    assert not any(s["penalised"] for s in result["substitutes"][:avoid])


def test_substitutes_api(client, user):
    r = client.get("/api/v1/coach/substitutes", {"food": "pechuga de pollo, cruda", "grams": "100"})
    assert r.status_code == 200 and r.data["substitutes"]
    assert all(abs(s["kcal"] - 120) <= 15 for s in r.data["substitutes"])  # redondeo a 5 g
    assert client.get("/api/v1/coach/substitutes", {"food": "no existe inventado"}).status_code == 404
    assert client.get("/api/v1/coach/substitutes", {"food": "x", "grams": "0"}).status_code == 400
