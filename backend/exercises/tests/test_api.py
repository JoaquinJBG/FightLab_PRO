"""API de ejercicios (F17): lista y búsqueda, ficha y CRUD de los ejercicios propios."""
import pytest
from rest_framework.test import APIClient

from exercises.models import CustomExercise
from users.models import CustomUser

LIST = "/api/v1/gym/exercises"
CUSTOM = "/api/v1/gym/exercises/custom"
CONTRACT = {
    "key", "name", "aliases", "primary_muscles", "secondary_muscles", "equipment", "images",
    "instructions", "source", "attribution", "custom",
}


def make_user(email: str) -> CustomUser:
    user = CustomUser.objects.create_user(email=email, password="pw-strong-123", is_active=True)
    return user


def client_for(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def user(db):
    return make_user("lifter@test.com")


@pytest.fixture
def api(user):
    return client_for(user)


def keys(resp) -> list[str]:
    return [e["key"] for e in resp.data]


@pytest.mark.django_db
def test_requires_auth():
    assert APIClient().get(LIST).status_code == 401
    assert APIClient().post(CUSTOM, {"name": "x"}, format="json").status_code == 401


def test_list_has_contract_fields(api):
    resp = api.get(LIST)
    assert resp.status_code == 200
    assert len(resp.data) >= 30
    for item in resp.data:
        assert CONTRACT <= set(item), item["key"]
        assert item["key"].startswith("cat:")
        assert item["custom"] is False
        assert not any(k.startswith("_") for k in item)


def test_names_follow_lang(api):
    es = {e["key"]: e for e in api.get(LIST, {"lang": "es"}).data}
    en = {e["key"]: e for e in api.get(LIST, {"lang": "en"}).data}
    assert es["cat:barbell-bench-press"]["name"] == "Press banca"
    assert en["cat:barbell-bench-press"]["name"] == "Bench press (barbell)"
    # El nombre del otro idioma va en los alias
    assert "Bench press (barbell)" in es["cat:barbell-bench-press"]["aliases"]


def test_lang_defaults_to_accept_language(api):
    resp = api.get(LIST, HTTP_ACCEPT_LANGUAGE="en")
    by_key = {e["key"]: e for e in resp.data}
    assert by_key["cat:lat-pulldown"]["name"] == "Lat pulldown"


def test_search_ignores_case_and_accents(api):
    assert keys(api.get(LIST, {"q": "JALON"}))[0] == "cat:lat-pulldown"
    assert "cat:leg-extension" in keys(api.get(LIST, {"q": "cuadriceps"}))


def test_search_in_both_languages(api):
    # Buscando en inglés con la app en español, y con los nombres de Hevy
    assert keys(api.get(LIST, {"q": "squat", "lang": "es"}))[0] == "cat:barbell-back-squat"
    assert "cat:barbell-bench-press" in keys(api.get(LIST, {"q": "bench press (barbell)"}))


def test_search_ranks_exact_then_prefix(api):
    result = keys(api.get(LIST, {"q": "press banca"}))
    assert result[0] == "cat:barbell-bench-press"


def test_search_all_words(api):
    assert keys(api.get(LIST, {"q": "curl martillo"})) == ["cat:hammer-curl"]
    assert keys(api.get(LIST, {"q": "zzzz no existe"})) == []


def test_filter_by_muscle_primary_first(api):
    result = api.get(LIST, {"muscle": "triceps"}).data
    assert result, "sin resultados"
    assert all("triceps" in e["primary_muscles"] or "triceps" in e["secondary_muscles"] for e in result)
    primaries = ["triceps" in e["primary_muscles"] for e in result]
    # Los que lo tienen como principal van antes
    assert primaries == sorted(primaries, reverse=True)
    assert "cat:triceps-extension" in [e["key"] for e in result]


def test_filter_by_equipment(api):
    result = api.get(LIST, {"equipment": "cable"}).data
    assert result
    assert all("cable" in e["equipment"] for e in result)
    both = api.get(LIST, {"equipment": "cable", "muscle": "abs"}).data
    assert [e["key"] for e in both] == ["cat:cable-crunch"]


@pytest.mark.parametrize("params", [{"muscle": "pecho"}, {"equipment": "spaceship"}])
def test_invalid_filters_are_400(api, params):
    resp = api.get(LIST, params)
    assert resp.status_code == 400
    assert "detail" in resp.data


def test_detail_by_key_and_by_path(api):
    a = api.get(f"{LIST}/cat:deadlift")
    b = api.get(f"{LIST}/cat/deadlift")
    assert a.status_code == b.status_code == 200
    assert a.data == b.data
    assert a.data["key"] == "cat:deadlift"
    assert CONTRACT <= set(a.data)


def test_detail_unknown_is_404(api):
    assert api.get(f"{LIST}/cat:nope").status_code == 404
    assert api.get(f"{LIST}/cat/nope").status_code == 404
    assert api.get(f"{LIST}/custom:abc").status_code == 404
    assert api.get(f"{LIST}/whatever").status_code == 404


# ---------- ejercicios propios ----------

def create(api, **over):
    body = {
        "name": "Remo Meadows",
        "primary_muscles": ["upper_back"],
        "secondary_muscles": ["biceps", "upper_back"],
        "equipment": ["barbell", "barbell"],
        "notes": "Con la barra en la esquina",
    }
    body.update(over)
    return api.post(CUSTOM, body, format="json")


def test_create_custom(api, user):
    resp = create(api)
    assert resp.status_code == 201, resp.data
    ex = CustomExercise.objects.get()
    assert ex.profile == user.profile
    assert resp.data["key"] == f"custom:{ex.pk}"
    assert resp.data["custom"] is True
    assert resp.data["source"] == "custom"
    # Sin duplicados, y lo que es principal no se repite como secundario
    assert resp.data["secondary_muscles"] == ["biceps"]
    assert resp.data["equipment"] == ["barbell"]
    assert resp.data["notes"] == "Con la barra en la esquina"
    assert CONTRACT <= set(resp.data)


def test_custom_in_list_and_search(api):
    key = create(api).data["key"]
    assert key in keys(api.get(LIST))
    assert keys(api.get(LIST, {"q": "meadows"})) == [key]
    assert key in keys(api.get(LIST, {"muscle": "upper_back"}))
    assert key not in keys(api.get(LIST, {"equipment": "machine"}))


def test_custom_detail_both_routes(api):
    created = create(api).data
    assert api.get(f"{LIST}/{created['key']}").data == created
    assert api.get(f"{CUSTOM}/{created['id']}").data == created


@pytest.mark.parametrize(
    "over, field",
    [
        ({"name": "   "}, "name"),
        ({"name": "x" * 121}, "name"),
        ({"primary_muscles": ["pecho"]}, "primary_muscles"),
        ({"primary_muscles": []}, "primary_muscles"),
        ({"secondary_muscles": "chest"}, "secondary_muscles"),
        ({"equipment": ["spaceship"]}, "equipment"),
        ({"notes": "n" * 2001}, "notes"),
    ],
)
def test_create_validation(api, over, field):
    resp = create(api, **over)
    assert resp.status_code == 400
    assert field in resp.data
    assert CustomExercise.objects.count() == 0


def test_no_limit_on_custom_exercises(api, user):
    CustomExercise.objects.bulk_create(
        CustomExercise(profile=user.profile, name=f"Propio {i:03d}", primary_muscles=["chest"]) for i in range(150)
    )
    assert create(api).status_code == 201
    customs = [e for e in api.get(LIST).data if e["custom"]]
    assert len(customs) == 151


def test_patch_custom(api):
    created = create(api).data
    resp = api.patch(f"{CUSTOM}/{created['id']}", {"name": "Remo Meadows unilateral", "notes": ""}, format="json")
    assert resp.status_code == 200
    assert resp.data["name"] == "Remo Meadows unilateral"
    assert resp.data["notes"] == ""
    assert resp.data["primary_muscles"] == ["upper_back"]
    bad = api.patch(f"{CUSTOM}/{created['id']}", {"primary_muscles": []}, format="json")
    assert bad.status_code == 400


def test_delete_custom(api):
    created = create(api).data
    assert api.delete(f"{CUSTOM}/{created['id']}").status_code == 204
    assert CustomExercise.objects.count() == 0
    assert api.get(f"{LIST}/{created['key']}").status_code == 404


def test_other_users_cannot_see_or_touch(api, db):
    created = create(api).data
    other = client_for(make_user("other@test.com"))
    assert created["key"] not in keys(other.get(LIST))
    assert other.get(f"{LIST}/{created['key']}").status_code == 404
    assert other.patch(f"{CUSTOM}/{created['id']}", {"name": "mío"}, format="json").status_code == 404
    assert other.delete(f"{CUSTOM}/{created['id']}").status_code == 404
    assert CustomExercise.objects.get().name == "Remo Meadows"
