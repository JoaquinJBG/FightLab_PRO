"""Fase 12: cronograma de batch por aparato, nevera o congelador, perfil de cocina (menaje y
comensales) y su efecto en el generador y la comprobación del motor. Datos inventados."""
from datetime import date, timedelta

import pytest

from coaching import batch, kitchen, menus
from coaching.batch import Task, schedule
from coaching.models import Diner, MealPlan

from .helpers import TODAY, client_for, make_user, today_fixed  # noqa: F401

KITCHEN = "/api/v1/coach/kitchen"
FULL = {"pots": 2, "pressure_cookers": 1, "wok": False, "frying_pans": 1, "air_fryer": True,
        "air_fryer_model": "Cesta 5 l", "oven": True, "microwave": True, "burners_large": 2, "burners_small": 1}


# ---------------------------------------------------------------- cronograma


def test_longest_first_and_in_parallel_by_appliance():
    chains = [
        [Task("Arroz", "Cocer", 20, "pot")],
        [Task("Garbanzos", "Picar", 10, "hands"), Task("Garbanzos", "Olla exprés", 45, "pressure_cooker")],
        [Task("Verdura", "Asar", 30, "oven")],
    ]
    out = schedule(chains, FULL)
    by_step = {(e["dish"], e["step"]): (e["min"], e["until"], e["where"]) for e in out.timeline}
    # Lo más largo (garbanzos, 55 min en total) empieza primero; el horno y la olla van a la vez.
    assert by_step[("Garbanzos", "Picar")] == (0, 10, "hands")
    assert by_step[("Garbanzos", "Olla exprés")] == (10, 55, "pressure_cooker")
    assert by_step[("Verdura", "Asar")] == (0, 30, "oven")
    assert by_step[("Arroz", "Cocer")] == (0, 20, "pot")
    assert out.total_min == 55 and out.checked and not out.missing


def test_only_owned_appliances_with_substitutes_and_missing():
    equipment = {"pots": 1, "burners_large": 1, "microwave": False, "oven": True}
    chains = [
        [Task("Puchero", "Presión", 30, "pressure_cooker")],
        [Task("Pollo", "Air fryer", 20, "air_fryer")],
        [Task("Brócoli", "Vapor", 5, "microwave")],
    ]
    out = schedule(chains, equipment)
    wheres = {e["dish"]: (e["where"], e["until"] - e["min"], e.get("substituted_from")) for e in out.timeline}
    assert wheres["Puchero"] == ("pot", 90, "pressure_cooker")  # convention: x3 sin olla exprés
    assert wheres["Pollo"] == ("oven", 25, "air_fryer")
    # Sin microondas, el brócoli va a la olla, que comparte el único fuego con el puchero.
    assert wheres["Brócoli"][0] == "pot"
    assert {e["where"] for e in out.timeline} <= kitchen.owned(equipment)
    starts = sorted((e["min"], e["until"]) for e in out.timeline if e["where"] == "pot")
    assert starts[0][1] <= starts[1][0]  # una sola olla y un solo fuego: una cosa detrás de otra


def test_a_step_with_no_appliance_or_substitute_is_missing():
    out = schedule([[Task("Tostar", "Horno", 10, "oven")]], {"pots": 1, "burners_small": 1})
    assert out.timeline == [] and out.missing == [{"dish": "Tostar", "step": "Horno", "where": "oven"}]


def test_empty_kitchen_profile_is_not_checked():
    out = schedule([[Task("A", "x", 5, "wok")]], {})
    assert out.timeline[0]["where"] == "wok" and out.checked is False


def test_imported_timeline_is_rebuilt_if_it_uses_an_appliance_the_user_lacks():
    session = {"date": "2026-11-01", "dishes": ["L1"], "eve": [],
               "timeline": [{"min": 0, "until": 40, "where": "pressure_cooker", "step": "Guisar", "dish": "L1"}]}
    dishes = {"L1": {"name": "Lentejas"}}
    kept = batch.session_view(session, dishes, FULL)
    assert kept["timeline"] == session["timeline"] and not kept["rebuilt"]
    rebuilt = batch.session_view(session, dishes, {"pots": 1, "burners_small": 1})
    assert rebuilt["rebuilt"] and rebuilt["timeline"][0]["where"] == "pot"
    assert rebuilt["timeline"][0]["until"] == 120


# ---------------------------------------------------------------- nevera y congelador


SUNDAY = date(2026, 11, 1)


@pytest.mark.parametrize("offset, where", [(1, "fridge"), (2, "fridge"), (3, "freezer"), (5, "freezer")])
def test_two_days_in_the_fridge_then_the_freezer(offset, where):
    dish = {"name": "Pollo en pepitoria", "ingredients": [{"food": "pechuga de pollo, cruda"}]}
    assert batch.storage_for(dish, SUNDAY, SUNDAY + timedelta(days=offset))["where"] == where


def test_rice_only_one_day_in_the_fridge_and_potatoes_do_not_freeze():
    rice = {"name": "Arroz con pollo", "ingredients": [{"food": "arroz blanco, cocido"}]}
    assert batch.storage_for(rice, SUNDAY, SUNDAY + timedelta(days=2))["where"] == "freezer"
    stew = {"name": "Guiso", "ingredients": [{"food": "patata, cruda"}]}
    out = batch.storage_for(stew, SUNDAY, SUNDAY + timedelta(days=3))
    assert out["no_freeze"] == ["patata"] and batch.RULES["no_freeze"] in out["rules"]


# ---------------------------------------------------------------- perfil de cocina


@pytest.mark.django_db
def test_kitchen_profile_round_trip_and_validation():
    user = make_user()
    client = client_for(user)
    empty = client.get(KITCHEN).json()
    assert empty["filled"] is False and empty["diners"] == [] and "pescado" in empty["categories"]
    body = {"equipment": FULL, "diners": [
        {"name": "Pareja", "restrictions": [{"meals": ["dinner"], "exclude": ["pescado"], "allow": ["gambas"]}]},
    ]}
    resp = client.put(KITCHEN, body, format="json")
    assert resp.status_code == 200
    data = resp.json()
    assert data["filled"] and data["equipment"]["air_fryer_model"] == "Cesta 5 l"
    assert data["diners"][0]["restrictions"] == [{"meals": ["dinner"], "exclude": ["pescado"], "allow": ["gambas"]}]
    for bad in ({"equipment": {"pots": 99}}, {"equipment": {"laser": True}}, {"diners": [{"name": ""}]},
                {"diners": [{"name": "X", "restrictions": [{"meals": ["brunch"], "exclude": ["x"]}]}]},
                {"diners": [{"name": "X", "restrictions": [{"exclude": []}]}]}):
        resp = client.put(KITCHEN, bad, format="json")
        assert resp.status_code == 400, bad
    assert Diner.objects.filter(profile=user.profile).count() == 1


def test_restriction_with_category_and_exception():
    rule = {"meals": ["dinner"], "exclude": ["pescado"], "allow": ["gambas"]}
    assert kitchen.restriction_hit(rule, ("merluza, cruda",)) == "pescado"
    assert kitchen.restriction_hit(rule, ("gambas, crudas",)) is None
    assert kitchen.restriction_hit(rule, ("pechuga de pollo, cruda",)) is None
    assert kitchen.applies(rule, "dinner") and not kitchen.applies(rule, "lunch")
    shellfish = {"meals": [], "exclude": ["marisco"], "allow": ["gambas"]}
    assert kitchen.restriction_hit(shellfish, ("mejillones",)) == "marisco"
    assert kitchen.restriction_hit(shellfish, ("gambas",)) is None


@pytest.mark.django_db
def test_engine_check_blocks_a_dinner_a_diner_does_not_eat(today_fixed):
    user = make_user()
    Diner.objects.create(profile=user.profile, name="Pareja",
                         restrictions=[{"meals": ["dinner"], "exclude": ["pescado"], "allow": ["gambas"]}])
    day = {"date": TODAY.isoformat(), "meals": [
        {"meal": "dinner", "dishes": [{"dish": "Merluza al horno", "items": ["merluza, cruda=250"]}]},
        {"meal": "lunch", "dishes": [{"dish": "Merluza a la plancha", "items": ["merluza, cruda=250"]}]},
    ]}
    result = menus.check_days(user, TODAY, [day])
    blocking = result["days"][0]["blocking"]
    assert result["days"][0]["ok"] is False
    assert [(f["kind"], f["dish"], f["diner"], f["entry"]) for f in blocking] == [("diner", "Merluza al horno", "Pareja", "pescado")]


@pytest.mark.django_db
def test_generator_avoids_fish_at_dinner_for_a_diner_and_builds_a_batch_session(today_fixed):
    user = make_user()
    client = client_for(user)
    client.put(KITCHEN, {"equipment": {"pots": 1, "frying_pans": 1, "burners_large": 2, "oven": True},
                         "diners": [{"name": "Pareja", "restrictions": [{"meals": ["dinner"], "exclude": ["pescado", "marisco"]}]}]},
               format="json")
    resp = client.post("/api/v1/coach/menu", {"start_date": TODAY.isoformat(), "days": 4, "meals": ["breakfast", "lunch", "dinner"],
                                              "tupper_meals": ["lunch"], "batch": True}, format="json")
    assert resp.status_code == 201, resp.json()
    menu = resp.json()
    fish = kitchen.categories()["pescado"] + kitchen.categories()["marisco"]
    for day in menu["days"]:
        dinner = next(m for m in day["meals"] if m["meal"] == "dinner")
        names = [i["name"] for d in dinner["dishes"] for i in d["items"]] + [d["dish"] for d in dinner["dishes"]]
        assert not any(kitchen.matches(w, n) for w in fish for n in names), names
    (session,) = menu["batch_sessions"]
    assert session["date"] == TODAY.isoformat()  # la víspera ya ha pasado: el mismo día
    assert session["timeline"] and session["checked"]
    assert {e["where"] for e in session["timeline"]} <= {"pot", "frying_pan", "oven", "hands"}
    plan = MealPlan.objects.get(pk=menu["id"])
    assert all(m.get("dish_id") for d in plan.days for m in d["meals"] if m["meal"] == "lunch")


def test_diner_categories_are_annex_data_labelled_as_convention():
    import yaml

    data = yaml.safe_load(kitchen.CATEGORIES_FILE.read_text(encoding="utf-8"))
    assert data["label"] == "FightLab convention"
    assert set(kitchen.categories()) == {"pescado", "marisco", "carne", "cerdo", "lacteos"}
    assert "hake" in kitchen.categories()["pescado"] and "merluza" in kitchen.categories()["pescado"]
    assert kitchen.category_names()["seafood"] == "marisco"
    assert kitchen.expand("fish")[0] == "fish" and "tuna" in kitchen.expand("fish")


@pytest.mark.django_db
def test_r3_1_seven_days_with_tupper_dinners_and_a_diner_never_drop_the_dinner_silently(today_fixed):
    """R3-1 (ronda 3 en el móvil): 7 días, tupper en comida y cena, batch, comensal «cena sin pescado
    salvo gambas» y calamar en «No te gusta». De jueves a domingo salía sin cena y «Comprobado»."""
    user = make_user()
    client = client_for(user)
    client.put(KITCHEN, {"equipment": FULL, "diners": [
        {"name": "Pareja", "restrictions": [{"meals": ["dinner"], "exclude": ["pescado"], "allow": ["gambas"]}]}]}, format="json")
    client.put("/api/v1/coach/tastes", {"disliked_foods": ["calamar"]}, format="json")
    resp = client.post("/api/v1/coach/menu", {"start_date": TODAY.isoformat(), "days": 7, "meals": list(menus.MEALS),
                                              "tupper_meals": ["lunch", "dinner"], "batch": True}, format="json")
    assert resp.status_code in (201, 422), resp.json()
    body = resp.json()
    saved = body.get("days", [])
    rejected = body.get("rejected", [])
    # Cada día guardado trae las 4 comidas pedidas; los que no, salen rechazados con la comida que falta.
    for day in saved:
        assert {m["meal"] for m in day["meals"]} == set(menus.MEALS), day["date"]
        assert day["check"]["ok"] is True
    assert len(saved) + len(rejected) == 7
    for r in rejected:
        assert "missing" in r
    # Con los platos de la comida como reserva, no falta la cena ningún día.
    assert all("dinner" not in r["missing"] for r in rejected)


def test_missing_meals_marks_a_day_without_a_requested_meal():
    draft = {"date": "2026-11-05", "meals": [{"meal": "breakfast"}, {"meal": "lunch"}]}
    assert menus.missing_meals(draft, ["breakfast", "lunch", "dinner"]) == ["dinner"]
    assert menus.missing_meals(draft, ["breakfast"]) == []
