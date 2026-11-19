"""500 menores (fix G1-9): JSON anidado sin fin, CSV roto, tipos raros y fechas que desbordan.
Todo debe salir como un error de importación o un 400, nunca un 500."""
import pytest

from coaching import chain_import, menu_context, menu_import
from coaching.bridge import history_files
from coaching.bridge.importers import ImportFileError

from .helpers import client_for, make_user, today_fixed  # noqa: F401

DEEP = "[" * 100_000 + "]" * 100_000


# ---------------------------------------------------------------- JSON/YAML anidado sin fin


def test_menu_file_nested_too_deep_is_an_import_error():
    with pytest.raises(menu_import.ImportInvalid):
        menu_import.parse_file("menu.json", ('{"schema": 1, "days": ' + DEEP + "}").encode())
    with pytest.raises(menu_import.ImportInvalid):
        menu_import.parse_file("menu.yaml", ("schema: 1\ndays: " + "[" * 5_000 + "]" * 5_000).encode())


def test_pasted_menu_nested_too_deep_is_an_import_error():
    with pytest.raises(menu_import.ImportInvalid):
        menu_context.parse_pasted('{"schema": 1, "days": ' + DEEP + "}")


def test_backup_nested_too_deep_is_an_import_error():
    with pytest.raises(ImportFileError):
        history_files.parse_backup("copia.json", '{"version": 1, "days": ' + DEEP + "}")


# ---------------------------------------------------------------- CSV de la cadena


def test_chain_csv_with_a_huge_field_is_an_import_error():
    data = ("mercadona_id;nombre;kcal;valoracion\n" + '123;"' + "a" * 200_000 + '";100;A\n').encode()
    with pytest.raises(ImportFileError) as exc:
        chain_import.parse(data)
    assert exc.value.code == "bad_csv"


# ---------------------------------------------------------------- cardio de hoy


@pytest.mark.django_db
@pytest.mark.parametrize("body", [
    {"type": ["walking"], "minutes": 30},
    {"type": {"a": 1}, "minutes": 30},
    {"type": "walking", "minutes": 30, "intensity": ["moderate"]},
    {"type": "walking", "minutes": 30, "intensity": {"x": 1}},
])
def test_today_cardio_with_non_string_type_or_intensity_is_400(today_fixed, body):
    res = client_for(make_user()).post("/api/v1/coach/today/cardio", body, format="json")
    assert res.status_code == 400


# ---------------------------------------------------------------- historial y calendario


@pytest.mark.django_db
@pytest.mark.parametrize("params", [
    {"to": "9999-12-31"},
    {"from": "0001-01-01"},
    {"from": "2101-01-01"},
    {"offset": "9" * 30},
])
def test_activity_list_out_of_range_is_400(today_fixed, params):
    assert client_for(make_user()).get("/api/v1/activities", params).status_code == 400


@pytest.mark.django_db
@pytest.mark.parametrize("month", ["9999-12", "1999-12", "2101-01"])
def test_activity_calendar_out_of_range_is_400(today_fixed, month):
    assert client_for(make_user()).get("/api/v1/activities/calendar", {"month": month}).status_code == 400


@pytest.mark.django_db
def test_activity_list_and_calendar_in_range_still_work(today_fixed):
    api = client_for(make_user())
    assert api.get("/api/v1/activities", {"from": "2000-01-01", "to": "2100-12-31", "offset": "10"}).status_code == 200
    assert api.get("/api/v1/activities/calendar", {"month": "2100-12"}).status_code == 200
