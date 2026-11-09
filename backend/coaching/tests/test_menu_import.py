"""Fase 12: importar menús completos (JSON `schema: 1`, YAML del coach y copia de ParteDiario),
la lista de la compra con casillas y las tareas de la víspera que lee la F11. Datos inventados."""
import json
from datetime import timedelta
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from coaching import batch, menu_import
from coaching.models import MealCheck, MealPlan, ShoppingCheck
from notifications import reminders

from .helpers import client_for, make_user
from .menu_fixtures import COACH_YAML, START, schema1, schema1_bytes

pytestmark = pytest.mark.django_db

IMPORT = "/api/v1/coach/menu/import"
MENU = "/api/v1/coach/menu"
TODAY = START - timedelta(days=2)  # el sábado de antes


@pytest.fixture(autouse=True)
def _today():
    with mock.patch("coaching.safety_views.timezone.localdate", return_value=TODAY):
        yield


def upload(user, raw: bytes, name="menu.json", **extra):
    return client_for(user).post(IMPORT, {"file": SimpleUploadedFile(name, raw), **extra}, format="multipart")


def test_import_schema1_keeps_everything_the_app_needs():
    user = make_user()
    resp = upload(user, schema1_bytes())
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["summary"] == {
        "menu_id": "2026-11-02", "title": "Menú de prueba", "start": "2026-11-02", "end": "2026-11-06",
        "days": 5, "dishes": 3, "batch_sessions": 1, "shopping_items": 3, "source": "json",
    }
    plan = MealPlan.objects.get(profile=user.profile)
    assert plan.menu_id == "2026-11-02" and plan.source == "json" and plan.end_date.isoformat() == "2026-11-06"
    menu = body["menu"]
    day = menu["days"][0]
    assert [m["meal"] for m in day["meals"]] == ["breakfast", "lunch", "dinner"]
    assert [m["label"] for m in day["meals"]] == ["Desayuno", "Comida", "Cena"]
    lunch = day["meals"][1]
    assert lunch["tupper"] and lunch["dish_id"] == "L1"
    assert lunch["dishes"][0]["steps"] == ["Recalentar tapado hasta que humee"]  # los del día
    assert lunch["dishes"][0]["steps_batch"][1] == {
        "step": "Guisar las lentejas", "min": 40, "where": "pressure_cooker", "where_label": "olla exprés"
    }
    assert lunch["dishes"][0]["storage"]["fridge_days"] == 2
    assert day["meals"][2]["prep"] == ["Precalentar el horno a 200 °C"]
    free = menu["days"][2]["meals"][2]
    assert free["free"] and free["free_budget_kcal"] == 650.0 and free["dishes"] == []
    assert menu["days"][0]["totals"]["kcal"] == 2400.0
    # Sesión de batch con su cronograma y sus reglas (chips).
    (session,) = menu["batch_sessions"]
    assert session["date"] == "2026-11-01" and session["eve"] == ["Comprar lo de la lista"]
    assert [e["where"] for e in session["timeline"]] == ["hands", "pressure_cooker"]
    assert session["rules"][0] == batch.RULES["order"]
    # Lista por sección, con formato y semana.
    shopping = menu["shopping_list"]
    assert shopping["source"] == "menu" and shopping["weeks"] == [1]
    assert [s["section"] for s in shopping["sections"]] == ["Carnicería", "Legumbres", "Pescadería"]
    lentils = shopping["sections"][1]["items"][0]
    assert lentils["pack"] == "bote de lentejas cocidas 400 g" and lentils["when"] == [1, 2]
    assert lentils["amount_two"] == 2200.0 and lentils["checked"] is False and lentils["product"] is None
    assert {r["key"] for r in menu["batch_rules"]} == set(batch.RULES.values())


def test_nevera_lunes_y_martes_congelador_de_miercoles():
    user = make_user()
    menu = upload(user, schema1_bytes()).json()["menu"]
    where = [d["meals"][1]["storage"]["where"] for d in menu["days"]]
    assert where == ["fridge", "fridge", "freezer", "freezer", "freezer"]
    # La merluza no es de batch: sin nevera ni congelador.
    assert menu["days"][0]["meals"][0]["storage"] is None
    # Víspera del miércoles: descongelar las lentejas del congelador.
    wed = menu["days"][2]["eve"]
    assert {"kind": "defrost", "meal": "lunch", "dish": "Lentejas con pollo", "rule_key": batch.RULES["defrost"]} in wed


def test_reimport_same_id_replaces_in_place_and_keeps_ticks_and_meal_marks():
    user = make_user()
    first = upload(user, schema1_bytes()).json()["menu"]
    client = client_for(user)
    resp = client.put(f"{MENU}/{first['id']}/shopping", {"item": "Lentejas, cocidas", "checked": True}, format="json")
    assert resp.status_code == 200 and resp.json()["checked"] == 1
    MealCheck.objects.create(profile=user.profile, date=START, meal="comida", state="hecho")
    data = schema1(title="Menú corregido")
    data["shopping"]["items"][0]["grams"] = 1500.0
    resp = upload(user, json.dumps(data).encode())
    assert resp.status_code == 200
    body = resp.json()
    assert body["replaced"] is True and body["kept_checks"] == 1
    assert body["menu"]["id"] == first["id"] and body["menu"]["title"] == "Menú corregido"
    assert MealPlan.objects.filter(profile=user.profile).count() == 1
    lentils = body["menu"]["shopping_list"]["sections"][1]["items"][0]
    assert lentils["checked"] is True and lentils["amount"] == 1500.0
    assert MealCheck.objects.filter(profile=user.profile, date=START).exists()


def test_another_menu_on_the_same_start_needs_confirmation():
    user = make_user()
    upload(user, schema1_bytes())
    resp = upload(user, schema1_bytes(menu_id="otro"))
    assert resp.status_code == 409 and resp.json()["code"] == "start_taken"
    resp = upload(user, schema1_bytes(menu_id="otro"), replace_start="true")
    assert resp.status_code == 201
    assert list(MealPlan.objects.filter(profile=user.profile).values_list("menu_id", flat=True)) == ["otro"]


def test_coach_yaml_is_imported_with_its_date_as_id():
    user = make_user()
    resp = upload(user, COACH_YAML.encode(), name="2026-11-09.yaml")
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["summary"]["menu_id"] == "coach-2026-11-09" and body["summary"]["source"] == "yaml"
    plan = MealPlan.objects.get(profile=user.profile)
    assert plan.days[0]["meals"][1]["dish_id"] == "lentejas-con-pollo"
    assert plan.dishes["lentejas-con-pollo"]["batch_servings"] == 2
    assert body["menu"]["shopping_list"]["source"] == "engine"  # sin lista propia: la del motor


@pytest.mark.parametrize("raw, code", [
    (b"not a menu", "import_invalid"),
    (b'{"schema": 2, "days": []}', "import_invalid"),
    (json.dumps(schema1(days=36)).encode(), "import_too_long"),
])
def test_bad_files_are_refused(raw, code):
    user = make_user()
    resp = upload(user, raw)
    assert resp.status_code == 400 and resp.json()["code"] == code
    assert not MealPlan.objects.filter(profile=user.profile).exists()


def test_a_dish_id_that_does_not_exist_is_refused():
    data = schema1()
    data["days"][0]["meals"][0]["dish_id"] = "NOPE"
    with pytest.raises(menu_import.ImportInvalid):
        menu_import.parse_schema1(data)


def test_shopping_check_only_for_the_owner():
    owner, other = make_user(), make_user()
    plan = upload(owner, schema1_bytes()).json()["menu"]
    resp = client_for(other).put(f"{MENU}/{plan['id']}/shopping", {"item": "x", "checked": True}, format="json")
    assert resp.status_code == 404


def test_other_menu_by_id_and_delete():
    user = make_user()
    a = upload(user, schema1_bytes()).json()["menu"]
    b = upload(user, schema1_bytes(menu_id="b", start=START + timedelta(days=7))).json()["menu"]
    client = client_for(user)
    state = client.get(MENU).json()
    assert state["menu"]["id"] == b["id"] and [m["id"] for m in state["menus"]] == [b["id"], a["id"]]
    assert client.get(f"{MENU}?id={a['id']}").json()["menu"]["id"] == a["id"]
    assert client.delete(f"{MENU}/{a['id']}").status_code == 204
    assert not MealPlan.objects.filter(pk=a["id"]).exists()


def test_today_tonight_and_the_eve_reminder_read_the_new_eve_tasks():
    user = make_user()
    upload(user, schema1_bytes())
    from coaching import today

    sunday = START - timedelta(days=1)
    saturday = sunday - timedelta(days=1)
    # Sábado por la noche: lo de la sesión de batch del domingo.
    assert today.tonight(user, saturday)["tasks"] == [{"kind": "batch", "text": "Comprar lo de la lista"}]
    # Domingo por la noche: lo que el lunes trae en `eve`.
    assert today.tonight(user, sunday)["tasks"] == [{"kind": "meal", "meal": "lunch", "text": "Remojar las lentejas"}]
    # Martes por la noche: pasar a la nevera las lentejas del miércoles.
    tasks = today.tonight(user, START + timedelta(days=1))["tasks"]
    assert tasks[0]["kind"] == "defrost" and tasks[0]["dish"] == "Lentejas con pollo"
    with mock.patch.object(reminders, "texts", return_value={**reminders.TEXTS["es"]}):
        payload = reminders._eve(user, reminders.datetime(2026, 11, 3, 22, tzinfo=reminders.UTC))
    assert payload["body"] == "Deja hecho: pasa Lentejas con pollo del congelador a la nevera"


def test_partediario_backup_menus_and_ticks_are_imported():
    user = make_user()
    backup = {
        "kind": "parte-diario-copia", "format": 1, "app_version": "1.9.3", "days": [], "meal_checks": [],
        "cardio_sessions": [],
        "menus": [{"id": "pd-7", "title": "Semana inventada", "start": "2026-11-02", "end": "2026-11-06",
                   "imported_at": 1, "json": json.dumps(schema1(menu_id="pd-7"))}],
        "shopping_checks": [{"menu_id": "pd-7", "item": "Merluza, cruda"}, {"menu_id": "pd-7", "item": "merluza, cruda"}],
        "ticket_photos": [{"menu_id": "pd-7", "uri": "content://x"}],
    }
    client = client_for(user)
    raw = SimpleUploadedFile("copia.json", json.dumps(backup).encode())
    resp = client.post("/api/v1/coach/import/history", {"files": raw}, format="multipart")
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["menus"] == {"total": 1, "new": 1, "replaced": 0, "kept": 0, "invalid": 0, "checks": 1}
    assert {n["code"]: n["count"] for n in body["notices"]} == {"tickets_not_in_backup": 1}
    plan = MealPlan.objects.get(profile=user.profile, menu_id="pd-7")
    assert plan.source == "partediario"
    assert list(ShoppingCheck.objects.filter(plan=plan).values_list("item_key", flat=True)) == ["merluza, cruda"]
    # Otra vez con `keep`: el menú ya está y no se pisa.
    raw = SimpleUploadedFile("copia.json", json.dumps(backup).encode())
    again = client.post("/api/v1/coach/import/history", {"files": raw}, format="multipart").json()
    assert again["menus"]["kept"] == 1 and again["menus"]["new"] == 0


def test_pdf_of_an_imported_menu_has_batch_sessions_and_the_list_by_section():
    from .test_menu_pdf import pdf_text

    user = make_user()
    plan = upload(user, schema1_bytes()).json()["menu"]
    resp = client_for(user).get(f"{MENU}/{plan['id']}/pdf")
    assert resp.status_code == 200
    text = pdf_text(resp.content)
    for piece in ("Sesiones de batch", "Olla expr", "Guisar las lentejas", "Legumbres", "bote de lentejas",
                  "semanas", "del congelador", "La v"):
        assert piece in text, piece


def test_chain_product_comes_from_the_configured_provider_with_the_engine_food_key(settings):
    from . import fake_chain

    user = make_user()
    plan = upload(user, schema1_bytes()).json()["menu"]
    # Sin proveedor (por defecto): ninguna línea lleva producto.
    assert all(i["product"] is None for s in plan["shopping_list"]["sections"] for i in s["items"])
    settings.SHOPPING_CHAIN_PROVIDER = "coaching.tests.fake_chain.chain_product"
    fake_chain.CALLS.clear()
    menu = client_for(user).get(MENU).json()["menu"]
    # La clave es la del motor (nombre en inglés de la tabla), no el texto que ve el usuario.
    assert ("lentils, cooked", 1100.0) in fake_chain.CALLS and ("hake, raw", 1000.0) in fake_chain.CALLS
    lines = {i["key"]: (s["section"], i) for s in menu["shopping_list"]["sections"] for i in s["items"]}
    section, lentils = lines["lentejas, cocidas"]
    assert section == "Conservas"  # la sección de la cadena sustituye a la del menú
    assert lentils["product"] == {
        "chain": "Súper", "product": "Lentejas cocidas Marca", "pack": "bote 400 g", "pack_grams": 400.0, "packs": 3,
        "section": "Conservas", "rating": "bueno", "review": False, "price": 2.85, "price_per_kg": 2.37,
    }
    section, hake = lines["merluza, cruda"]
    assert section == "Pescadería"  # sin sección de la cadena, la del menú
    assert hake["product"]["rating"] is None and hake["product"]["review"] is True  # valor desconocido: nada
    assert lines["pechuga de pollo, cruda"][1]["product"] is None
