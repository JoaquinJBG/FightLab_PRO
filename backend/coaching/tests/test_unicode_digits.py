"""Dígitos Unicode en la entrada (fix G1-9): `"²".isdigit()` es True pero `int("²")` falla, y `\\d`
de `re` también casa «٣» o «²». Nada de eso debe dar 500: es un 400, un 404 o se ignora."""
import pytest

from activities.keys import custom_key_owned
from activities.serializers import SetItemSerializer
from routines.serializers import RoutineExerciseSerializer

from .helpers import client_for, make_user, today_fixed  # noqa: F401

pytestmark = pytest.mark.django_db

ODD = ["²", "٣", "1²", "１２"]


@pytest.fixture
def api(today_fixed):
    return client_for(make_user())


@pytest.mark.parametrize("raw", ODD)
def test_menu_id(api, raw):
    assert api.get("/api/v1/coach/menu", {"id": raw}).status_code == 200


@pytest.mark.parametrize("raw", ODD)
def test_menu_ai_days(api, raw):
    assert api.get("/api/v1/coach/menu/context", {"days": raw}).status_code == 400


@pytest.mark.parametrize("raw", ODD)
def test_tickets_plan(api, raw):
    assert api.get("/api/v1/coach/tickets", {"plan": raw}).status_code == 200


@pytest.mark.parametrize("raw", ODD)
def test_custom_exercise_detail(api, raw):
    assert api.get(f"/api/v1/gym/exercises/custom:{raw}").status_code == 404


@pytest.mark.parametrize("raw", ODD)
def test_custom_keys_in_sets_and_routines(raw):
    user = make_user()
    assert not custom_key_owned(user.profile, f"custom:{raw}")
    row = {"exercise": "x", "exercise_key": f"custom:{raw}", "exercise_index": 0, "set_index": 0}
    assert not SetItemSerializer(data=row, context={"profile": user.profile}).is_valid()
    block = {"exercise_key": f"custom:{raw}", "name": "x"}
    assert not RoutineExerciseSerializer(data=block, context={"profile": user.profile}).is_valid()


@pytest.mark.parametrize("raw", ["1²:00", "٠٩:30"])
def test_plan_times_need_ascii_digits(api, raw):
    res = api.post("/api/v1/coach/plan", {"gym_days": ["mon", "thu"], "times": {"mon": raw}}, format="json")
    assert res.status_code == 400


def test_imported_routine_with_a_unicode_plan_ref_does_not_break_the_sync_status(api):
    from routines import plan_sync
    from routines.models import Routine

    user = make_user()
    Routine.objects.create(profile=user.profile, title="Hevy", source=Routine.Source.IMPORT, source_ref="plan:²:x")
    plan_sync.status_data(user)
