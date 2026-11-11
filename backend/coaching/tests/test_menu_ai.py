"""Fase 14: menús con la IA del propio usuario a coste 0.

- B: token personal (se ve una vez, se guarda hasheado, se revoca; solo vale para el contexto y
  para subir menús), `GET /menu/context` y `POST /menu/import` con `dry_run`.
- A: el respaldo automático reutiliza platos de los menús anteriores y respeta Mi cocina.
- C: pegar en la app el JSON de la IA, con errores claros.

Ninguna prueba llama a una IA: el servidor no tiene a quién llamar. Datos inventados.
"""
import json
from datetime import timedelta

import pytest

from coaching import menu_context, menu_import, menu_llm, menus
from coaching.menu_tokens import MAX_ACTIVE, hash_token
from coaching.models import MealPlan, MenuApiToken

from .helpers import TODAY, client_for, fix_today, make_user
from .menu_fixtures import schema1

pytestmark = pytest.mark.django_db

TOKENS = "/api/v1/coach/menu-tokens"
CONTEXT = "/api/v1/menu/context"
IMPORT = "/api/v1/menu/import"
APP_CONTEXT = "/api/v1/coach/menu/context"
PASTE = "/api/v1/coach/menu/paste"
START = TODAY + timedelta(days=3)


@pytest.fixture(autouse=True)
def _today():
    with fix_today():
        yield


def new_token(user, name="PC de casa") -> str:
    resp = client_for(user).post(TOKENS, {"name": name}, format="json")
    assert resp.status_code == 201, resp.json()
    return resp.json()["token"]


def with_token(token: str):
    from rest_framework.test import APIClient

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


def ai_menu(start=START, days=2, **extra) -> dict:
    """Un menú como el que devolvería la IA del usuario (sin `totals`, con nombres de la tabla)."""
    data = schema1(menu_id=f"ia-{start.isoformat()}", start=start, days=days, **extra)
    data.pop("batch_sessions")
    data.pop("shopping")
    for day in data["days"]:
        day.pop("totals")
    data["dishes"]["L1"]["batch_servings"] = days
    return data


@pytest.fixture
def all_days_pass(monkeypatch):
    """Para las pruebas que solo necesitan un menú de IA guardado (tokens, contexto, ids): el motor
    da por buenos todos los días. Las de R4-1 usan el motor de verdad."""
    real = menu_import._checks

    def checks(user, today, days):
        out, result = real(user, today, days)
        return [{**c, "ok": True} for c in out], result

    monkeypatch.setattr(menu_import, "_checks", checks)


MEAL_LABELS = {"breakfast": "Desayuno", "lunch": "Comida", "dinner": "Cena", "snack": "Merienda"}


def passing_ai_menu(user, start=START, days=2, menu_id=None, title="Menú inventado que cuadra") -> dict:
    """Un menú de IA cuyos días pasan el motor de verdad: los del generador automático (sin IA)
    pasados al JSON `schema: 1`. El menú automático se borra."""
    resp = client_for(user).post("/api/v1/coach/menu", {"start_date": start.isoformat(), "days": days}, format="json")
    assert resp.status_code == 201, resp.json()
    plan = MealPlan.objects.get(pk=resp.json()["id"])
    out_days, dishes = [], {}
    for day in plan.days:
        meals = []
        for meal in day["meals"]:
            dish = meal["dishes"][0]
            key = f"{day['date']}-{meal['meal']}"
            ingredients = []
            for item in dish["items"]:
                food, _, amount = item.rpartition("=")
                unit = "ml" if amount.endswith("ml") else "grams"
                ingredients.append({"food": food, unit: float(amount.removesuffix("ml"))})
            dishes[key] = {"name": dish["dish"], "ingredients": ingredients, "seasoning": dish.get("seasoning") or []}
            meals.append({"meal": MEAL_LABELS[meal["meal"]], "dish_id": key})
        out_days.append({"date": day["date"], "meals": meals})
    plan.delete()
    return {"schema": 1, "id": menu_id or f"ia-{start.isoformat()}", "title": title, "days": out_days, "dishes": dishes}


# ---------------------------------------------------------------- B: token


def test_token_is_shown_once_and_stored_hashed():
    user = make_user()
    client = client_for(user)
    resp = client.post(TOKENS, {"name": "  PC   de casa "}, format="json")
    assert resp.status_code == 201
    body = resp.json()
    raw = body["token"]
    assert raw.startswith("flm_") and len(raw) > 40
    assert body["name"] == "PC de casa" and body["prefix"] == raw[:10]
    assert body["scope"] == ["menu:context", "menu:import"]
    row = MenuApiToken.objects.get(profile=user.profile)
    assert row.token_hash == hash_token(raw) and raw not in (row.token_hash, row.prefix)
    listed = client.get(TOKENS).json()
    assert [t["id"] for t in listed["tokens"]] == [row.id]
    assert "token" not in listed["tokens"][0]
    assert raw not in json.dumps(listed)


def test_token_reads_the_context_and_records_its_use():
    user = make_user()
    token = new_token(user)
    resp = with_token(token).get(CONTEXT)
    assert resp.status_code == 200, resp.json()
    assert resp["Cache-Control"] == "private, no-store"
    assert MenuApiToken.objects.get(profile=user.profile).last_used_at is not None


def test_token_scope_is_only_context_and_import(all_days_pass):
    user = make_user()
    token = new_token(user)
    client = with_token(token)
    for path in ("/api/v1/coach/menu", "/api/v1/coach/today", "/api/v1/me/profile", TOKENS, APP_CONTEXT):
        assert client.get(path).status_code == 401, path
    assert client.post(PASTE, {"menu": ai_menu()}, format="json").status_code == 401
    assert client.post(TOKENS, {"name": "otro"}, format="json").status_code == 401
    assert client.post(IMPORT, {"menu": ai_menu()}, format="json").status_code == 201


def test_revoked_or_unknown_token_is_refused():
    user = make_user()
    token = new_token(user)
    row = MenuApiToken.objects.get(profile=user.profile)
    assert with_token("flm_" + "x" * 43).get(CONTEXT).status_code == 401
    other = make_user()
    assert client_for(other).delete(f"{TOKENS}/{row.id}").status_code == 404
    assert client_for(user).delete(f"{TOKENS}/{row.id}").status_code == 204
    resp = with_token(token).get(CONTEXT)
    assert resp.status_code == 401 and "Perfil" in resp.json()["detail"]
    assert client_for(user).get(TOKENS).json()["tokens"] == []
    assert client_for(user).delete(f"{TOKENS}/{row.id}").status_code == 404


def test_inactive_user_token_is_refused():
    user = make_user()
    token = new_token(user)
    user.is_active = False
    user.save()
    assert with_token(token).get(CONTEXT).status_code == 401


def test_active_tokens_are_limited():
    user = make_user()
    for i in range(MAX_ACTIVE):
        new_token(user, f"t{i}")
    resp = client_for(user).post(TOKENS, {"name": "uno más"}, format="json")
    assert resp.status_code == 409 and resp.json()["code"] == "menu_token_limit"
    first = MenuApiToken.objects.filter(profile=user.profile).last()
    client_for(user).delete(f"{TOKENS}/{first.id}")
    assert client_for(user).post(TOKENS, {"name": "uno más"}, format="json").status_code == 201


# ---------------------------------------------------------------- B: contexto


def test_context_has_what_the_ai_needs_and_nothing_personal():
    user = make_user()
    client = client_for(user)
    client.put("/api/v1/coach/tastes", {"allergies": ["cacahuete"], "disliked_foods": ["calamar"]}, format="json")
    client.put("/api/v1/coach/kitchen", {"equipment": {"oven": True, "pots": 2}, "diners": [
        {"name": "Nombre Privado", "restrictions": [{"meals": ["dinner"], "exclude": ["pescado"], "allow": ["gambas"]}]}]},
        format="json")
    token = new_token(user)
    resp = with_token(token).get(CONTEXT, {"start": START.isoformat(), "days": 3, "meals": "lunch,breakfast",
                                           "tupper": "lunch"})
    assert resp.status_code == 200, resp.json()
    ctx = resp.json()
    assert ctx["context_version"] == 1 and ctx["lang"] == "es"
    req = ctx["request"]
    assert req["start"] == START.isoformat() and req["end"] == (START + timedelta(days=2)).isoformat()
    assert req["meals"] == ["breakfast", "lunch"] and req["tupper_meals"] == ["lunch"]
    assert req["meal_labels"] == {"breakfast": "Desayuno", "lunch": "Comida"}
    assert req["id"] == f"ia-{START.isoformat()}"
    assert set(ctx["targets"]) >= {"kcal", "protein_g", "fat_min_g", "fibre_g"} and ctx["targets"]["kcal"] > 0
    assert ctx["tastes"]["allergies"] == ["cacahuete"]
    assert ctx["kitchen"]["equipment"] == {"oven": True, "pots": 2}
    assert ctx["kitchen"]["diners"] == [{"diner": 1, "restrictions": [{"meals": ["dinner"], "exclude": ["pescado"], "allow": ["gambas"]}]}]
    assert "pescado" in ctx["kitchen"]["categories"]
    assert ctx["foods_columns"][0] == "name"
    names = {f[0] for f in ctx["foods"]}
    assert {"copos de avena", "pechuga de pollo, cruda"} <= names
    assert ctx["format"]["schema"] == 1 and ctx["format"]["dishes"]["D1"]["ingredients"]
    assert all(i["food"] in names for i in ctx["format"]["dishes"]["D1"]["ingredients"])
    assert "Del " + START.isoformat() in ctx["instructions"] and "Desayuno, Comida" in ctx["instructions"]
    text = json.dumps(ctx, ensure_ascii=False)
    for private in ("Nombre Privado", user.email, "weight", "date_of_birth", "height"):
        assert private not in text


def test_context_in_english_and_with_recent_menus_and_dishes_to_avoid(all_days_pass):
    user = make_user()
    client_for(user).post(PASTE, {"menu": ai_menu(start=TODAY - timedelta(days=2))}, format="json")
    user.profile.language = "en"
    user.profile.save()
    # Con el token, el idioma es el del perfil (la petición de la skill no lleva el del navegador).
    ctx = with_token(new_token(user)).get(CONTEXT, {"start": START.isoformat()}, HTTP_ACCEPT_LANGUAGE="es").json()
    assert ctx["lang"] == "en" and ctx["request"]["meal_labels"]["lunch"] == "Lunch"
    assert "oats" in {f[0] for f in ctx["foods"]} or any("oat" in f[0] for f in ctx["foods"])
    assert ctx["instructions"].startswith("You are FightLab")
    assert ctx["recent_menus"][0]["origin"] == "user_ai"
    assert "Lentejas con pollo" in ctx["avoid_dishes"]


def test_context_default_start_is_after_the_last_menu(all_days_pass):
    user = make_user()
    client_for(user).post(PASTE, {"menu": ai_menu(start=TODAY, days=2)}, format="json")
    ctx = client_for(user).get(APP_CONTEXT).json()
    assert ctx["request"]["start"] == (TODAY + timedelta(days=2)).isoformat()
    assert ctx["request"]["days"] == 7


def test_context_refuses_bad_requests_and_missing_targets():
    user = make_user()
    client = with_token(new_token(user))
    assert client.get(CONTEXT, {"days": 15}).json()["code"] == "days_invalid"
    assert client.get(CONTEXT, {"meals": "brunch"}).json()["code"] == "meals_invalid"
    assert client.get(CONTEXT, {"start": "mañana"}).json()["code"] == "start_invalid"
    minor = make_user(profile={"date_of_birth": TODAY.replace(year=TODAY.year - 15)})
    resp = with_token(new_token(minor)).get(CONTEXT)
    assert resp.status_code == 409 and resp.json()["code"] == "no_calorie_targets"


# ---------------------------------------------------------------- B: subir


def test_import_with_token_saves_a_user_ai_menu_checked_by_the_engine(all_days_pass):
    user = make_user()
    resp = with_token(new_token(user)).post(IMPORT, {"menu": ai_menu()}, format="json")
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["checked"] is True and body["days_ok"] + len(body["days_failing"]) == 2
    menu = body["menu"]
    assert menu["source"] == "user_ai" and menu["origin"] == "user_ai" and menu["provider"] == "user_ai"
    assert menu["menu_id"] == f"ia-{START.isoformat()}"
    assert all(day["check"] for day in menu["days"])
    plan = MealPlan.objects.get(profile=user.profile)
    assert plan.source == MealPlan.Source.USER_AI
    state = client_for(user).get("/api/v1/coach/menu").json()
    assert state["menus"][0]["origin"] == "user_ai"


def test_dry_run_checks_without_saving_and_names_unknown_foods():
    user = make_user()
    data = ai_menu()
    data["dishes"]["D1"]["ingredients"].append({"food": "harina de grillo", "grams": 20})
    resp = with_token(new_token(user)).post(IMPORT, {"menu": data, "dry_run": True}, format="json")
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["dry_run"] is True and body["checked"] is True and body["ok"] is False
    assert body["unknown_foods"] == ["harina de grillo"]
    assert {d["date"] for d in body["days"]} == {START.isoformat(), (START + timedelta(days=1)).isoformat()}
    assert body["summary"]["source"] == "user_ai" and body["summary"]["menu_id"].startswith("ia-")
    assert not MealPlan.objects.filter(profile=user.profile).exists()


def test_same_id_replaces_and_another_menu_on_the_same_day_asks_first(all_days_pass):
    user = make_user()
    client = with_token(new_token(user))
    assert client.post(IMPORT, {"menu": ai_menu()}, format="json").status_code == 201
    again = client.post(IMPORT, {"menu": ai_menu()}, format="json")
    assert again.status_code == 200 and again.json()["replaced"] is True
    other = ai_menu()
    other["id"] = "otro"
    taken = client.post(IMPORT, {"menu": other}, format="json")
    assert taken.status_code == 409 and taken.json()["code"] == "start_taken"
    ok = client.post(IMPORT, {"menu": other, "replace_start": True}, format="json")
    assert ok.status_code == 201 and ok.json()["menu"]["menu_id"] == "ia-otro"
    assert MealPlan.objects.filter(profile=user.profile).count() == 1


def test_an_ai_menu_never_overwrites_an_imported_menu_with_the_same_id(all_days_pass):
    user = make_user()
    from django.core.files.uploadedfile import SimpleUploadedFile

    raw = json.dumps(schema1(menu_id="2026-12-01", start=START + timedelta(days=10), days=2)).encode()
    client_for(user).post("/api/v1/coach/menu/import", {"file": SimpleUploadedFile("m.json", raw)}, format="multipart")
    data = ai_menu()
    data["id"] = "2026-12-01"
    resp = client_for(user).post(PASTE, {"menu": data}, format="json")
    assert resp.status_code == 201 and resp.json()["menu"]["menu_id"] == "ia-2026-12-01"
    assert MealPlan.objects.filter(profile=user.profile).count() == 2


# ---------------------------------------------------------------- C: pegar


def test_paste_accepts_the_ai_reply_with_fences_and_chatter(all_days_pass):
    user = make_user()
    text = "Aquí tienes tu menú:\n```json\n" + json.dumps(ai_menu(), ensure_ascii=False, indent=2) + "\n```\n¡Que aproveche!"
    resp = client_for(user).post(PASTE, {"menu": text}, format="json")
    assert resp.status_code == 201, resp.json()
    assert resp.json()["menu"]["origin"] == "user_ai"


@pytest.mark.parametrize(
    ("text", "code", "words"),
    [
        ("   ", "paste_empty", "Pega"),
        ('{"schema": 1, "days": [}', "paste_not_json", "línea 1, columna 24"),
        ('{"days": []}', "paste_no_schema", "schema"),
        ('{"schema": 1, "days": []}', "import_invalid", "menú"),
    ],
)
def test_paste_errors_are_clear(text, code, words):
    user = make_user()
    resp = client_for(user).post(PASTE, {"menu": text}, format="json")
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == code and words in body["detail"], body
    assert not MealPlan.objects.filter(profile=user.profile).exists()


def test_paste_says_where_the_menu_is_wrong():
    user = make_user()
    data = ai_menu()
    data["days"][0]["meals"][0]["dish_id"] = "NOPE"
    body = client_for(user).post(PASTE, {"menu": data}, format="json").json()
    assert body["code"] == "import_invalid" and "NOPE" in body["info"]


def test_paste_refuses_a_free_meal_after_a_positive_screen():
    user = make_user(screening={"scoff_yes_count": 3, "scoff_positive": True})
    data = ai_menu()
    data["days"][0]["meals"][2] = {"meal": "Cena", "free": True}
    for dry in (True, False):
        resp = client_for(user).post(PASTE, {"menu": data, "dry_run": dry}, format="json")
        assert resp.status_code == 409 and resp.json()["code"] == "free_meal_refused"


# ---------------------------------------------------------------- A: respaldo automático


def _ctx(user, **extra):
    return menus.ProposalContext(
        lang="es", targets={"kcal": 2500}, tastes=menus.coach_tastes_for(user), meals=["lunch"], tupper_meals=[],
        avoid_dishes=set(), favoured=[], table=menus.menu_table(user), **extra,
    )


def test_auto_reuses_dishes_from_previous_menus(all_days_pass):
    user = make_user()
    data = ai_menu(start=TODAY - timedelta(days=20))
    data["days"][1]["meals"][1]["tupper"] = False
    client_for(user).post(PASTE, {"menu": data}, format="json")
    previous = {d["dish"]: d for d in menus._previous_dishes(user)}
    assert previous["Merluza al horno"]["meal"] == "dinner"
    assert previous["Avena con yogur"]["items"] == ["copos de avena=60", "yogur griego desnatado=250"]
    # La tanda (`batch_servings`) no se reutiliza como plato suelto: sus cantidades son de una tanda.
    assert "Lentejas con pollo" not in previous
    dinner = menu_llm.FakeMenuProposer()._candidates(_ctx(user, previous=list(previous.values())), "dinner")
    assert dinner[-1]["dish"] == "Merluza al horno"  # después de la tabla de platos
    assert "meal" not in dinner[-1]


def test_auto_respects_my_kitchen_with_stand_ins():
    user = make_user()
    proposer = menu_llm.FakeMenuProposer()
    all_lunch = [d["dish"] for d in proposer._candidates(_ctx(user), "lunch")]
    no_oven = {"pots": 1, "burners_large": 1, "frying_pans": 1, "microwave": True}
    from coaching import kitchen

    limited = [d["dish"] for d in proposer._candidates(_ctx(user, owned=kitchen.owned(no_oven)), "lunch")]
    # Sin horno ni air fryer no salen los platos de la tabla que los necesitan (los del horno).
    assert "Quinoa con salmón y espárragos" in " ".join(all_lunch) or len(all_lunch) > len(limited)
    assert len(limited) == len(all_lunch) - 3
    # Con air fryer, lo del horno se hace en ella: vuelven esos platos.
    with_fryer = [d["dish"] for d in proposer._candidates(_ctx(user, owned=kitchen.owned({**no_oven, "air_fryer": True})), "lunch")]
    assert set(with_fryer) == set(all_lunch)


def test_auto_menu_says_it_is_automatic():
    user = make_user()
    resp = client_for(user).post("/api/v1/coach/menu", {"start_date": TODAY.isoformat(), "days": 1}, format="json")
    assert resp.status_code == 201, resp.json()
    assert resp.json()["origin"] == "auto" and resp.json()["provider"] == "fake"


def test_origin_of_every_source():
    assert menus.origin_of("generated") == "auto"
    assert menus.origin_of("user_ai") == "user_ai"
    assert {menus.origin_of(s) for s in ("json", "yaml", "partediario")} == {"import"}
    assert menu_context.ai_menu_id("ia-x") == "ia-x" and menu_context.ai_menu_id("x") == "ia-x"
