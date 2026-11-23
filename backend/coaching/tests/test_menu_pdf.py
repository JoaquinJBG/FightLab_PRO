"""El menú y la lista de la compra en PDF (Task 8.5).

El PDF se hace en memoria (nunca se escribe en disco ni se usa `coach.export.write`), en el idioma
del usuario, con la atribución de las recetas y de los datos. Solo lo descarga el dueño del menú y
con los mismos bloqueos que preparar un menú.
"""
import base64
import builtins
import re
import zlib
from datetime import date, timedelta
from unittest import mock

import pytest
from rest_framework.test import APIClient

from coaching.menu_pdf import day_text
from coaching.models import MealPlan

from .helpers import TODAY, client_for, make_user, today_fixed  # noqa: F401

pytestmark = pytest.mark.django_db

MENU = "/api/v1/coach/menu"
SOURCE = "https://example.invalid/receta-de-lentejas"


def pdf_text(data: bytes) -> str:
    """El texto de las páginas: los flujos del PDF (ASCII85 y Flate, como los escribe reportlab)
    descomprimidos, en Latin-1 (la fuente del PDF)."""
    out = []
    for raw in re.findall(rb"stream\r?\n(.*?)endstream", data, re.S):
        raw = raw.strip()
        try:
            if raw.endswith(b"~>"):
                raw = base64.a85decode(raw[:-2].replace(b"\n", b"").replace(b"\r", b""))
            out.append(zlib.decompress(raw))
        except (ValueError, zlib.error):
            out.append(raw)
    text = b"\n".join(out).decode("latin-1")
    return re.sub(r"\\(\d{3})", lambda m: chr(int(m.group(1), 8)), text)


def make_menu(user, days=2, lang="es"):
    resp = client_for(user).post(MENU, {"start_date": TODAY.isoformat(), "days": days}, format="json",
                                 HTTP_ACCEPT_LANGUAGE=lang)
    assert resp.status_code == 201, resp.json()
    return resp.json()


def get_pdf(user, menu_id, lang="es"):
    return client_for(user).get(f"{MENU}/{menu_id}/pdf", HTTP_ACCEPT_LANGUAGE=lang)


def test_pdf_is_valid_and_has_the_menu_and_the_shopping_list(today_fixed):
    user = make_user()
    menu = make_menu(user)
    resp = get_pdf(user, menu["id"])
    assert resp.status_code == 200
    assert resp["Content-Type"] == "application/pdf"
    assert resp["Content-Disposition"] == f'attachment; filename="fightlab-menu-{TODAY.isoformat()}.pdf"'
    assert resp["Cache-Control"] == "private, no-store"
    data = resp.content
    assert data.startswith(b"%PDF-") and data.rstrip().endswith(b"%%EOF")
    text = pdf_text(data)
    assert "Lista de la compra" in text and "Desayuno" in text
    first_dish = menu["days"][0]["meals"][0]["dishes"][0]["dish"]
    assert first_dish in text
    for credit in ("USDA", "Open Food Facts", "ODbL", "ai-personal-coach"):  # la línea se parte al ajustar
        assert credit in text, credit
    assert "Plato de ejemplo de FightLab" in text
    # F12: fechas como en la app («9 de noviembre»), no en ISO
    assert TODAY.isoformat() not in text
    assert day_text("es", TODAY.isoformat()) in text


def test_pdf_in_english(today_fixed):
    user = make_user()
    menu = make_menu(user, days=1, lang="en")
    text = pdf_text(get_pdf(user, menu["id"], lang="en").content)
    assert "Shopping list" in text and "Breakfast" in text
    assert "Lista de la compra" not in text
    assert TODAY.isoformat() not in text
    assert day_text("en", TODAY.isoformat()) in text
    # Los ingredientes con el nombre de la tabla del motor en inglés.
    item = menu["days"][0]["meals"][0]["dishes"][0]["items"][0]["name"]
    assert item in text


def test_pdf_credits_the_recipe_source(today_fixed):
    user = make_user()
    menu = make_menu(user, days=1)
    lunch = next(m for m in menu["days"][0]["meals"] if m["meal"] == "lunch")["dishes"][0]["dish"]
    rate = client_for(user).post(f"{MENU}/rate", {"dish": lunch, "rating": "loved", "source": SOURCE}, format="json")
    assert rate.status_code == 200
    later = client_for(user).post(MENU, {"start_date": (TODAY + timedelta(days=14)).isoformat(), "days": 1}, format="json").json()
    dish = next(m for m in later["days"][0]["meals"] if m["meal"] == "lunch")["dishes"][0]
    assert dish["dish"] == lunch and dish["source"] == SOURCE
    data = get_pdf(user, later["id"]).content
    assert SOURCE.encode() in data  # el enlace de la receta (y su QR)
    assert SOURCE in pdf_text(data)


def test_pdf_is_made_in_memory(today_fixed):
    user = make_user()
    menu = make_menu(user, days=1)
    real_open = builtins.open

    def no_writes(file, mode="r", *args, **kwargs):
        assert not any(c in mode for c in "wax+"), f"escritura en disco: {file} ({mode})"
        return real_open(file, mode, *args, **kwargs)

    with mock.patch("coach.export.write", side_effect=AssertionError("export.write escribe en disco")), \
            mock.patch("builtins.open", no_writes):
        resp = get_pdf(user, menu["id"])
    assert resp.status_code == 200 and resp.content.startswith(b"%PDF-")


def test_only_the_owner_can_download_it(today_fixed):
    owner, other = make_user(), make_user()
    menu = make_menu(owner, days=1)
    assert get_pdf(other, menu["id"]).status_code == 404
    assert APIClient().get(f"{MENU}/{menu['id']}/pdf").status_code == 401
    assert get_pdf(owner, 999999).status_code == 404


def test_pdf_follows_todays_flags(today_fixed):
    user = make_user()
    menu = make_menu(user, days=1)
    p = user.profile
    p.date_of_birth = date(2010, 1, 1)  # ahora es menor: sin objetivos de kcal
    p.save()
    resp = get_pdf(user, menu["id"])
    assert resp.status_code == 409 and resp.json()["code"] == "no_calorie_targets"
    p.date_of_birth, p.gender = date(1996, 5, 1), "OTHER"  # sin sexo para la ecuación
    p.save()
    resp = get_pdf(user, menu["id"])
    assert resp.status_code == 409 and resp.json()["code"] == "profile_incomplete"
    assert MealPlan.objects.filter(pk=menu["id"]).exists()  # no se borra nada


def test_positive_screen_pdf_has_no_weight(today_fixed):
    user = make_user(profile={"goal": "fat_loss"}, screening={"scoff_yes_count": 2})
    menu = make_menu(user, days=1)
    text = pdf_text(get_pdf(user, menu["id"]).content)
    assert not re.search(r"\d\s?kg\b", text)
    assert "Lista de la compra" in text


def test_day_text_writes_dates_like_the_app():
    # F12 de la prueba en móvil: «9 de noviembre», no «2026-11-09»
    assert day_text("es", "2026-11-09") == "9 de noviembre"
    assert day_text("es", "2026-11-09", year=True) == "9 de noviembre de 2026"
    assert day_text("en", "2026-11-09", year=True) == "9 November 2026"
    assert day_text("es", "no es fecha") == "no es fecha"
