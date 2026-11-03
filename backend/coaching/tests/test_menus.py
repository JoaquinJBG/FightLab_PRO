"""Menús y lista de la compra (fase 8, Tasks 8.1, 8.2 y 8.4).

Aceptación: el LLM (simulado) propone y el motor comprueba cada día contra los objetivos; no se
repiten platos en 7 días; una alergia por nombre bloquea el plato; un día que el motor rechaza no
se guarda; la lista de la compra sale de `mealplan.shopping`. Y los flags mandan: sin objetivos de
kcal no hay menú, con `no_deficit` no hay menú de déficit y nunca sale una cifra de peso.
"""
from datetime import date, timedelta
from unittest import mock

import pytest
from coach import foods, mealplan, regions
from coach.tastes import matches
from django.test import override_settings

from coaching import menu_dishes, menu_llm, menus
from coaching.models import MealPlan, Recipe

from .helpers import TODAY, client_for, make_user, today_fixed  # noqa: F401

pytestmark = pytest.mark.django_db

MENU = "/api/v1/coach/menu"
CHECK = "/api/v1/coach/menu/check"


def post_menu(user, **body):
    return client_for(user).post(MENU, {"start_date": TODAY.isoformat(), **body}, format="json")


def dishes_of(menu: dict) -> list[str]:
    return [d["dish"] for day in menu["days"] for meal in day["meals"] for d in meal["dishes"]]


def item_names(day: dict) -> list[str]:
    return [i for meal in day["meals"] for d in meal.get("dishes") or [] for i in d["items"]]


def keys_anywhere(value, out=None) -> set[str]:
    out = set() if out is None else out
    if isinstance(value, dict):
        for k, v in value.items():
            out.add(k)
            keys_anywhere(v, out)
    elif isinstance(value, list):
        for v in value:
            keys_anywhere(v, out)
    return out


class BadDayProposer(menu_llm.FakeMenuProposer):
    """Como el simulado, pero el día `bad` es siempre una tostada: el motor lo rechaza."""

    def __init__(self, bad: set[str]):
        self.bad = bad

    def propose(self, ctx, dates, attempt, feedback):
        days = super().propose(ctx, dates, attempt, feedback)
        return [
            {"date": d["date"], "meals": [{"meal": "breakfast", "dishes": [{"dish": f"Tostada {d['date']}", "items": ["pan integral=40"]}]}]}
            if d["date"] in self.bad else d
            for d in days
        ]


# ---------------------------------------------------------------- 8.1: tabla del motor


def test_dish_library_uses_engine_food_names():
    table = regions.menu_table(None)  # la tabla base: vale para un perfil sin región
    for dish in menu_dishes.DISHES:
        for name, _ in dish["items"]:
            assert foods.find(name, table) is not None, (dish["key"], name)
        assert dish["es"] and dish["en"]


def test_each_meal_has_enough_dishes_for_a_week_without_repeats():
    for meal in menus.MEALS:
        assert sum(meal in d["meals"] for d in menu_dishes.DISHES) > mealplan.NO_REPEAT_DAYS
    assert all(len(d["meals"]) == 1 for d in menu_dishes.DISHES)


def test_engine_names_in_both_languages(today_fixed):
    user = make_user()
    found = client_for(user).get("/api/v1/coach/foods", {"q": "pollo"}, HTTP_ACCEPT_LANGUAGE="en").json()["foods"]
    names = {f["name"] for f in found}
    assert "chicken breast, raw" in names
    es = client_for(user).get("/api/v1/coach/foods", {"q": "chicken breast"}, HTTP_ACCEPT_LANGUAGE="es").json()["foods"]
    assert "pechuga de pollo, cruda" in {f["name"] for f in es}
    # Cada palabra empieza una palabra del nombre: "pollo" no es "repollo".
    assert "repollo" not in {f["name_es"] for f in found}


# ---------------------------------------------------------------- 8.4: generar


def test_generate_saves_days_the_engine_accepts(today_fixed):
    user = make_user()
    resp = post_menu(user, days=3)
    assert resp.status_code == 201, resp.json()
    menu = resp.json()
    assert menu["provider"] == "fake"
    assert [d["date"] for d in menu["days"]] == [(TODAY + timedelta(days=i)).isoformat() for i in range(3)]
    for day in menu["days"]:
        assert day["check"]["ok"] is True
        assert set(day["check"]["check"].values()) == {"ok"}
        assert [m["meal"] for m in day["meals"]] == list(menus.DEFAULT_MEALS)
        assert not day["check"]["totals"]["unknown"]
    assert menu["rejected"] == []
    # Los objetivos son los de /coach/targets y llevan sus reglas.
    targets = client_for(user).get("/api/v1/coach/targets").json()
    assert menu["targets"]["kcal"] == targets["kcal"]
    for name in ("kcal", "protein_g", "fat_g", "fibre_g"):
        assert menu["rules"][name], name
    assert menu["shopping"]["chains"] and menu["shopping"]["chains"][0]["items"]
    assert MealPlan.objects.filter(profile=user.profile).count() == 1


def test_kcal_within_the_engine_margin(today_fixed):
    user = make_user(profile={"goal": "fat_loss"})
    menu = post_menu(user, days=2).json()
    kcal = menu["targets"]["kcal"]
    for day in menu["days"]:
        total = day["check"]["totals"]["kcal"]
        assert kcal <= total <= kcal * 1.05


def test_generation_is_deterministic(today_fixed):
    a, b = make_user(), make_user()
    assert dishes_of(post_menu(a, days=3).json()) == dishes_of(post_menu(b, days=3).json())


@override_settings(ANTHROPIC_API_KEY="sk-test-not-used")
def test_never_calls_anthropic_even_with_a_key(today_fixed):
    user = make_user()
    with mock.patch("ai.services._client", side_effect=AssertionError("Anthropic llamado")) as client, \
            mock.patch("urllib.request.urlopen", side_effect=AssertionError("red")):
        resp = post_menu(user, days=2)
    assert resp.status_code == 201
    client.assert_not_called()


@override_settings(MENU_LLM_PROVIDER="anthropic")
def test_only_the_fake_provider_exists():
    with pytest.raises(Exception, match="simulado"):
        menu_llm.get_proposer()


def test_rejected_day_is_not_saved(today_fixed):
    user = make_user()
    second = (TODAY + timedelta(days=1)).isoformat()
    req = menus.MenuRequest(start_date=TODAY, days=3)
    plan, rejected = menus.generate(user, TODAY, req, "es", BadDayProposer({second}))
    saved = [d["date"] for d in plan.days]
    assert second not in saved and len(saved) == 2
    assert [r["date"] for r in rejected] == [second]
    assert rejected[0]["check"]["kcal"] == "under"
    assert "dishes" not in rejected[0] and "meals" not in rejected[0]
    assert plan.rejected == rejected


def test_all_days_rejected_saves_nothing(today_fixed):
    user = make_user()
    with mock.patch("coaching.menu_views.get_proposer", return_value=BadDayProposer({TODAY.isoformat()})):
        resp = post_menu(user, days=1)
    assert resp.status_code == 422
    assert resp.json()["code"] == "menu_rejected"
    assert not MealPlan.objects.filter(profile=user.profile).exists()


def test_no_dish_repeats_within_seven_days_across_menus(today_fixed):
    user = make_user()
    week = post_menu(user, days=7).json()
    names = dishes_of(week)
    assert len(names) == len(set(names)) == 28
    nxt = client_for(user).post(MENU, {"start_date": (TODAY + timedelta(days=7)).isoformat(), "days": 3}, format="json")
    assert nxt.status_code == 201, nxt.json()
    later = nxt.json()
    assert not set(dishes_of(later)) & set(names[-4 * 6:])  # los 6 días anteriores
    assert MealPlan.objects.filter(profile=user.profile).count() == 2


def test_allergy_keeps_the_food_out_and_blocks_a_draft(today_fixed):
    user = make_user()
    client_for(user).put("/api/v1/coach/tastes", {"allergies": ["pollo"]}, format="json")
    menu = post_menu(user, days=3).json()
    for day in menu["days"]:
        for meal in day["meals"]:
            for d in meal["dishes"]:
                assert not any(matches("pollo", i["name"]) for i in d["items"]), d
    draft = {"days": [{"date": TODAY.isoformat(), "meals": [
        {"meal": "lunch", "dishes": [{"dish": "Pollo con arroz", "items": ["pechuga de pollo, cruda=200", "arroz blanco, cocido=200"]}]}
    ]}]}
    checked = client_for(user).post(CHECK, draft, format="json").json()
    day = checked["days"][0]
    assert day["ok"] is False
    assert {f["kind"] for f in day["blocking"]} == {"allergy"}


def test_taste_matching_is_by_whole_words(today_fixed):
    user = make_user()
    client_for(user).put("/api/v1/coach/tastes", {"allergies": ["pollo"]}, format="json")
    draft = {"days": [{"date": TODAY.isoformat(), "meals": [
        {"meal": "lunch", "dishes": [{"dish": "Repollo salteado", "items": ["repollo=300"]}]}]}]}
    day = client_for(user).post(CHECK, draft, format="json").json()["days"][0]
    assert day["blocking"] == []


def test_check_reports_engine_statuses_without_saving(today_fixed):
    user = make_user()
    draft = {"days": [{"date": TODAY.isoformat(), "meals": [
        {"meal": "lunch", "dishes": [{"dish": "Arroz", "items": ["arroz blanco, cocido=200", "zzz inventado=50"]}]}]}]}
    checked = client_for(user).post(CHECK, draft, format="json").json()
    day = checked["days"][0]
    assert day["check"]["kcal"] == "under" and day["ok"] is False
    assert day["totals"]["unknown"] == ["zzz inventado"]
    assert not MealPlan.objects.exists()


def test_check_refuses_a_free_meal_after_a_positive_screen(today_fixed):
    user = make_user(screening={"scoff_yes_count": 2})
    draft = {"days": [{"date": TODAY.isoformat(), "meals": [
        {"meal": "lunch", "dishes": [{"dish": "Arroz", "items": ["arroz blanco, cocido=200"]}]},
        {"meal": "dinner", "free": True}]}]}
    resp = client_for(user).post(CHECK, draft, format="json")
    assert resp.status_code == 400 and resp.json()["code"] == "free_meal_refused"


# ---------------------------------------------------------------- seguridad


def test_no_menu_without_calorie_targets(today_fixed):
    user = make_user(profile={"date_of_birth": date(2010, 1, 1)})  # menor de 18
    resp = post_menu(user, days=1)
    assert resp.status_code == 409
    assert resp.json()["code"] == "no_calorie_targets"
    assert resp.json()["reasons"][0]["rule_key"]
    state = client_for(user).get(MENU).json()
    assert state["blocked"]["code"] == "no_calorie_targets"


def test_no_menu_without_equation_sex(today_fixed):
    user = make_user(profile={"gender": "OTHER"})
    resp = post_menu(user, days=1)
    assert resp.status_code == 409
    assert resp.json()["code"] == "profile_incomplete"
    assert client_for(user).get(MENU).json()["missing"]


def test_positive_screen_menu_is_at_maintenance_and_has_no_weight(today_fixed):
    user = make_user(profile={"goal": "fat_loss"}, screening={"scoff_yes_count": 2})
    menu = post_menu(user, days=1).json()
    targets = client_for(user).get("/api/v1/coach/targets").json()
    assert menu["targets"]["in_deficit"] is False
    assert menu["targets"]["kcal"] == targets["maintenance_kcal"]
    keys = keys_anywhere(menu) | keys_anywhere(client_for(user).get(MENU).json())
    assert not {"weight", "weight_kg", "kg", "goal_weight_kg"} & keys


def test_requests_out_of_range_are_refused(today_fixed):
    user = make_user()
    assert post_menu(user, days=8).status_code == 400
    assert post_menu(user, meals=["brunch"]).status_code == 400
    far = client_for(user).post(MENU, {"start_date": (TODAY + timedelta(days=60)).isoformat()}, format="json")
    assert far.json()["code"] == "start_invalid"


# ---------------------------------------------------------------- 8.2: gustos y recetario


def test_tastes_round_trip_and_validation(today_fixed):
    user = make_user()
    c = client_for(user)
    first = c.get("/api/v1/coach/tastes").json()
    assert "allergies" in first["missing"] and "postal_code" not in first["missing"]
    saved = c.put("/api/v1/coach/tastes", {"allergies": [], "cooking_skill": "beginner", "pantry": ["aceite de oliva"]},
                  format="json").json()
    assert saved["allergies"] == [] and "allergies" not in saved["missing"]
    assert c.put("/api/v1/coach/tastes", {"cooking_skill": "chef"}, format="json").status_code == 400
    assert c.put("/api/v1/coach/tastes", {"postal_code": "28001"}, format="json").status_code == 400


def test_pantry_is_left_off_the_shopping_list(today_fixed):
    user = make_user()
    client_for(user).put("/api/v1/coach/tastes", {"pantry": ["aceite de oliva"]}, format="json")
    menu = post_menu(user, days=2).json()
    listed = {i["name"] for c in menu["shopping"]["chains"] for i in c["items"]}
    assert "aceite de oliva" not in listed
    assert "aceite de oliva" in menu["shopping"]["pantry_skipped"]


def test_rating_saves_the_recipe_and_never_again_is_not_offered(today_fixed):
    user = make_user()
    c = client_for(user)
    menu = post_menu(user, days=1).json()
    lunch = next(m for m in menu["days"][0]["meals"] if m["meal"] == "lunch")["dishes"][0]["dish"]
    loved = c.post("/api/v1/coach/menu/rate", {"dish": lunch, "rating": "loved"}, format="json").json()
    assert loved["recipe"]["items"] and loved["recipe"]["meal"] == "lunch"
    assert lunch in loved["tastes"]["favoured"]
    breakfast = menu["days"][0]["meals"][0]["dishes"][0]["dish"]
    c.post("/api/v1/coach/menu/rate", {"dish": breakfast, "rating": "never_again"}, format="json")
    assert Recipe.objects.get(profile=user.profile, dish=breakfast).rating == "never_again"
    later = c.post(MENU, {"start_date": (TODAY + timedelta(days=14)).isoformat(), "days": 7}, format="json").json()
    assert breakfast not in dishes_of(later)
    assert lunch in dishes_of(later)  # el recetario se reutiliza antes que los platos nuevos
    recipes = c.get("/api/v1/coach/recipes").json()["recipes"]
    assert [r["rating"] for r in recipes] == ["loved", "never_again"]


def test_items_are_shown_in_the_user_language(today_fixed):
    user = make_user()
    post_menu(user, days=1)
    en = client_for(user).get(MENU, HTTP_ACCEPT_LANGUAGE="en").json()["menu"]
    names = {i["name"] for m in en["days"][0]["meals"] for d in m["dishes"] for i in d["items"]}
    es = client_for(user).get(MENU, HTTP_ACCEPT_LANGUAGE="es").json()["menu"]
    names_es = {i["name"] for m in es["days"][0]["meals"] for d in m["dishes"] for i in d["items"]}
    table = regions.menu_table("es")
    assert names and all(foods.find(n, table).name_en == n for n in names)
    assert all(foods.find(n, table).name_es == n for n in names_es)
