"""R4-1 (ronda 4 de la prueba en móvil): un menú de «tu IA» sin ningún día válido sustituía al bueno.

- Los días que no cuadran no se guardan; si no cuadra ninguno, no se guarda nada y nunca sustituye
  al menú que ya había, con el motivo de cada día.
- «¿Lo sustituyes?» (409) solo con al menos un día válido, con cuántos tiene cada menú.
- Un alimento que no está en la tabla se marca y el motivo del día lo nombra.

Datos inventados; ninguna prueba llama a una IA.
"""
import json
from datetime import timedelta

import pytest

from coaching.models import MealPlan

from .helpers import client_for, fix_today, make_user
from .menu_fixtures import schema1
from .test_menu_ai import PASTE, START, ai_menu, passing_ai_menu

pytestmark = pytest.mark.django_db

UNKNOWN_FOOD = "chuletón de buey a la brasa"


@pytest.fixture(autouse=True)
def _today():
    with fix_today():
        yield


def _with_unknown(data: dict, day: int) -> dict:
    """El día `day` con un alimento que no está en la tabla (en un plato solo suyo)."""
    meal = data["days"][day]["meals"][0]
    dish = {**data["dishes"][meal["dish_id"]]}
    dish["ingredients"] = [*dish["ingredients"], {"food": UNKNOWN_FOOD, "grams": 247}]
    data["dishes"][f"{meal['dish_id']}-x"] = dish
    meal["dish_id"] = f"{meal['dish_id']}-x"
    return data


def test_ai_menu_without_any_valid_day_saves_nothing_and_never_replaces():
    user = make_user()
    client = client_for(user)
    good = client.post(PASTE, {"menu": passing_ai_menu(user)}, format="json")
    assert good.status_code == 201, good.json()
    assert good.json()["days_ok"] == 2 and good.json()["rejected"] == []
    bad = _with_unknown(ai_menu(), 0)
    bad["id"], bad["title"] = "malo", "Menú malo inventado"
    for replace in (False, True):
        resp = client.post(PASTE, {"menu": bad, "replace_start": replace}, format="json")
        assert resp.status_code == 422, resp.json()
        body = resp.json()
        assert body["code"] == "no_valid_days" and "no se ha guardado nada" in body["detail"]
        assert [r["date"] for r in body["rejected"]] == [START.isoformat(), (START + timedelta(days=1)).isoformat()]
        # El motivo de cada día; el del alimento que no está en la tabla lo nombra.
        assert body["rejected"][0]["unknown"] == [UNKNOWN_FOOD]
        assert all(r["check"] for r in body["rejected"])
    plans = list(MealPlan.objects.filter(profile=user.profile))
    assert [p.title for p in plans] == ["Menú inventado que cuadra"] and len(plans[0].days) == 2


def test_ai_menu_keeps_only_the_valid_days_and_asks_with_the_counts():
    user = make_user()
    client = client_for(user)
    data = _with_unknown(passing_ai_menu(user), 1)
    # (el generador automático borra los menús de esas fechas: se prepara antes de guardar)
    other = passing_ai_menu(user, menu_id="otro", title="Otro inventado")
    resp = client.post(PASTE, {"menu": data}, format="json")
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["summary"]["days"] == 1 and body["days_ok"] == 1
    assert body["days_failing"] == [(START + timedelta(days=1)).isoformat()]
    assert body["rejected"][0]["unknown"] == [UNKNOWN_FOOD]
    plan = MealPlan.objects.get(profile=user.profile)
    assert [d["date"] for d in plan.days] == [START.isoformat()]
    assert plan.rejected[0]["unknown"] == [UNKNOWN_FOOD]
    assert all(c["ok"] for c in plan.checks)
    assert UNKNOWN_FOOD not in json.dumps(plan.dishes, ensure_ascii=False)
    # Otro menú que empieza el mismo día: pregunta, con cuántos días válidos tiene cada uno.
    taken = client.post(PASTE, {"menu": other}, format="json")
    assert taken.status_code == 409, taken.json()
    assert taken.json()["code"] == "start_taken"
    params = taken.json()["params"]
    assert {k: params[k] for k in ("old_ok", "old_days", "new_ok", "new_days")} == {
        "old_ok": 1, "old_days": 1, "new_ok": 2, "new_days": 2}


def test_unknown_food_is_marked_in_an_imported_menu():
    """Un menú importado de la F12 se guarda entero (son los menús del propio usuario); el alimento
    que no está en la tabla sale marcado (`known: false`) y su día, con el motivo."""
    from django.core.files.uploadedfile import SimpleUploadedFile

    user = make_user()
    data = _with_unknown(schema1(start=START, days=2), 0)
    raw = json.dumps(data, ensure_ascii=False).encode()
    resp = client_for(user).post("/api/v1/coach/menu/import", {"file": SimpleUploadedFile("m.json", raw)}, format="multipart")
    assert resp.status_code == 201, resp.json()
    day = resp.json()["menu"]["days"][0]
    items = [i for m in day["meals"] for d in m["dishes"] for i in d["items"]]
    assert [i["known"] for i in items if i["name"] == UNKNOWN_FOOD] == [False]
    assert day["check"]["ok"] is False and day["check"]["totals"]["unknown"] == [UNKNOWN_FOOD]
