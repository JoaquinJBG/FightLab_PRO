"""Pantalla "Hoy" (F11): `GET/POST /coach/today`, las marcas de comidas y el cardio por sesiones.

Reutiliza `DayLog` y `MealCheck` de la F10 (tipo de día, entreno, movilidad y comidas), el peso
del check-in de F5 (`checkin_upsert`), el plan activo de F6 y el menú de F8. Datos inventados.
"""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from rest_framework.test import APIClient

from activities.models import Activity
from coaching import today as days
from coaching.models import DailyCheckin, DayLog, MealCheck, MealPlan, WeeklyPlan
from django.utils import timezone
from userstate.models import UserState

from .helpers import TODAY, client_for, fix_today, make_user

URL = "/api/v1/coach/today"
pytestmark = pytest.mark.django_db
MADRID = ZoneInfo("Europe/Madrid")
# TODAY (2026-10-29) es jueves: la semana va del lunes 26 al domingo 1.
MONDAY = TODAY - timedelta(days=3)


@pytest.fixture(autouse=True)
def _today():
    with fix_today():
        yield


def athlete(**kwargs):
    return make_user(profile={"timezone": "Europe/Madrid"}, **kwargs)


def active_plan(user, schedule):
    return WeeklyPlan.objects.create(
        profile=user.profile,
        week_start=MONDAY,
        status=WeeklyPlan.Status.ACTIVE,
        training_schedule=schedule,
        sessions=[{"key": "A", "kind": "gym", "items": [{"exercise": "Sentadilla"}, {"exercise": "Press banca"}]}],
    )


def menu(user, start=MONDAY, day=TODAY):
    meals = [
        {"meal": "breakfast", "dishes": [{"dish": "Avena con yogur", "items": ["avena=60"]}]},
        {"meal": "lunch", "tupper": True, "dishes": [{"dish": "Arroz con pollo", "items": ["arroz=80"]}]},
        {"meal": "dinner", "free": True, "dishes": []},
    ]
    return MealPlan.objects.create(profile=user.profile, start_date=start, days=[{"date": day.isoformat(), "meals": meals}])


def sport(user, minutes, *, day=TODAY, rpe=None, kind=Activity.Kind.SPORT, **detail):
    return Activity.objects.create(
        profile=user.profile,
        kind=kind,
        started_at=datetime.combine(day, time(9), tzinfo=MADRID),
        duration_sec=minutes * 60,
        rpe=rpe,
        detail=detail or None,
    )


def test_requires_auth():
    assert APIClient().get(URL).status_code == 401
    assert APIClient().post(URL, {}, format="json").status_code == 401
    assert APIClient().put(URL + "/meal", {}, format="json").status_code == 401
    assert APIClient().post(URL + "/cardio", {}, format="json").status_code == 401


def test_empty_day_without_plan_or_menu():
    body = client_for(athlete()).get(URL).json()
    assert body["date"] == TODAY.isoformat() and body["weekday"] == "thu"
    assert body["plan"] is None and body["menu"] is None and body["next_meal"] is None
    assert body["day_type"] is None and body["day_type_set"] is False
    assert body["trained"] is None and body["mobility"] is None
    week = body["cardio"]["week"]
    assert week["goal"] == 150 and week["minutes"] == 0 and week["equivalent"] == 0
    assert week["rule_key"] == "cardio-health/weekly-baseline-dose"


def test_plan_of_the_day_comes_from_the_active_weekly_plan():
    user = athlete()
    active_plan(user, [
        {"day": "thu", "time": "18:00", "kind": "gym", "session": "A"},
        {"day": "thu", "time": None, "kind": "cardio", "minutes": 25},
        {"day": "fri", "time": None, "kind": "cardio", "minutes": 25},
    ])
    body = client_for(user).get(URL).json()
    assert body["plan"]["entries"] == [
        # F26: sin lesiones, nada en pausa
        {"kind": "gym", "time": "18:00", "session": "A", "exercises": ["Sentadilla", "Press banca"], "paused": []},
        {"kind": "cardio", "time": None, "minutes": 25},
    ]
    assert body["plan"]["no_contact"] is False
    assert body["day_type"] == "gym" and body["day_type_set"] is False
    friday = client_for(user).get(URL, {"date": (TODAY - timedelta(days=6)).isoformat()}).json()
    assert friday["plan"]["type"] == "cardio"
    wednesday = client_for(user).get(URL, {"date": (TODAY - timedelta(days=1)).isoformat()}).json()
    assert wednesday["plan"]["entries"] == [] and wednesday["day_type"] == "rest"


def test_a_draft_plan_is_not_the_plan_of_the_day():
    user = athlete()
    plan = active_plan(user, [{"day": "thu", "kind": "gym", "session": "A"}])
    plan.status = WeeklyPlan.Status.DRAFT
    plan.save()
    assert client_for(user).get(URL).json()["plan"] is None


def test_day_type_trained_and_mobility_go_to_the_day_log():
    user = athlete()
    active_plan(user, [{"day": "thu", "kind": "gym", "session": "A"}])
    client = client_for(user)
    body = client.post(URL, {"day_type": "rest", "trained": True, "mobility": False}, format="json").json()
    assert body["day_type"] == "rest" and body["day_type_set"] is True
    assert body["trained"] is True and body["mobility"] is False
    row = DayLog.objects.get(profile=user.profile, date=TODAY)
    assert (row.day_type, row.trained, row.mobility) == ("descanso", True, False)  # claves de ParteDiario
    # Volver a lo del plan.
    body = client.post(URL, {"day_type": None}, format="json").json()
    assert body["day_type"] == "gym" and body["day_type_set"] is False and body["trained"] is True
    assert DayLog.objects.get(profile=user.profile, date=TODAY).day_type == ""


def test_a_day_imported_from_partediario_shows_in_today():
    user = athlete()
    DayLog.objects.create(profile=user.profile, date=TODAY, day_type="cardio", trained=True, mobility=True)
    MealCheck.objects.create(profile=user.profile, date=TODAY, meal="desayuno", state="cambiada", change="tostadas")
    menu(user)
    body = client_for(user).get(URL).json()
    assert (body["day_type"], body["day_type_set"], body["trained"], body["mobility"]) == ("cardio", True, True, True)
    assert body["menu"]["meals"][0]["mark"] == {"state": "changed", "change": "tostadas"}


def test_quick_log_does_not_touch_the_morning_checkin():
    user = athlete()
    client = client_for(user)
    client.post("/api/v1/coach/checkin", {"energy": 4, "sleep_hours": 7.5}, format="json")
    client.post(URL, {"mobility": True}, format="json")
    row = DailyCheckin.objects.get(profile=user.profile, date=TODAY)
    assert row.energy == 4 and row.sleep_hours == 7.5
    assert DayLog.objects.get(profile=user.profile, date=TODAY).mobility is True


def test_weight_goes_through_the_checkin():
    user = athlete(weight=None)
    body = client_for(user).post(URL, {"weight_kg": 80.4}, format="json").json()
    assert body["weight_kg"] == 80.4
    (log,) = user.profile.biometrics.filter(external_id=f"checkin:{TODAY.isoformat()}")
    assert float(log.weight_kg) == 80.4


def test_weight_is_refused_with_no_weight_targets():
    user = athlete(weight=None, screening={"scoff_positive": True})
    client = client_for(user)
    res = client.post(URL, {"weight_kg": 80.4, "mobility": True}, format="json")
    assert res.status_code == 403 and res.json() == {"code": "weight_targets_blocked", "fields": ["weight_kg"]}
    assert not DayLog.objects.filter(profile=user.profile).exists()  # nada se escribe
    body = client.get(URL).json()
    assert body["weight_blocked"] is True and body["weight_kg"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"day_type": "swim"},
        {"trained": "yes"},
        {"weight_kg": 900},
        {"colour": "red"},
        {"date": (TODAY + timedelta(days=1)).isoformat(), "trained": True},
        {"date": (TODAY - timedelta(days=15)).isoformat(), "trained": True},
    ],
)
def test_invalid_quick_log_is_refused(body):
    user = athlete()
    assert client_for(user).post(URL, body, format="json").status_code == 400
    assert not DayLog.objects.filter(profile=user.profile).exists()
    assert not DailyCheckin.objects.filter(profile=user.profile).exists()


def test_meals_of_the_menu_with_marks_and_next_meal():
    user = athlete()
    menu(user)
    client = client_for(user)
    body = client.get(URL).json()
    assert [m["meal"] for m in body["menu"]["meals"]] == ["breakfast", "lunch", "dinner"]
    assert body["menu"]["meals"][1]["tupper"] is True and body["menu"]["meals"][2]["free"] is True
    assert body["next_meal"] == {"all_done": False, "meal": "breakfast", "free": False, "dishes": ["Avena con yogur"]}

    body = client.put(URL + "/meal", {"meal": "breakfast", "state": "done"}, format="json").json()
    assert body["menu"]["meals"][0]["mark"] == {"state": "done", "change": None}
    assert body["next_meal"]["meal"] == "lunch"

    body = client.put(URL + "/meal", {"meal": "lunch", "state": "changed", "change": " pizza "}, format="json").json()
    assert body["menu"]["meals"][1]["mark"] == {"state": "changed", "change": "pizza"}
    body = client.put(URL + "/meal", {"meal": "dinner", "state": "skipped"}, format="json").json()
    assert body["next_meal"] == {"all_done": True}

    body = client.put(URL + "/meal", {"meal": "lunch", "state": None}, format="json").json()
    assert body["menu"]["meals"][1]["mark"] is None
    rows = {m.meal: (m.state, m.dish) for m in MealCheck.objects.filter(profile=user.profile)}
    assert rows == {"desayuno": ("hecho", "Avena con yogur"), "cena": ("no_hecho", "")}


def test_f29_a_mark_does_not_move_to_a_new_dish_when_the_menu_changes():
    """F29 (prueba en el móvil): con la cena marcada «No hecha», preparar otro menú ponía la marca
    en el plato nuevo, que nunca estuvo en el día. La marca es del plato que se marcó."""
    user = athlete()
    menu(user)
    client = client_for(user)
    client.put(URL + "/meal", {"meal": "breakfast", "state": "skipped"}, format="json")
    plan = MealPlan.objects.get(profile=user.profile)
    # Otro menú para el mismo día: el desayuno cambia de plato; la comida sigue igual.
    days_ = plan.days
    days_[-1]["meals"][0]["dishes"][0]["dish"] = "Tostada con tomate"
    plan.days = days_
    plan.save()
    breakfast = client.get(URL).json()["menu"]["meals"][0]
    assert MealCheck.objects.get(profile=user.profile, meal="desayuno").dish == "Avena con yogur"  # no se reescribe
    assert breakfast["dishes"] == ["Tostada con tomate"]
    assert breakfast["mark"] is None
    assert breakfast["previous_mark"] == {"state": "skipped", "change": None, "dish": "Avena con yogur"}
    assert client.get(URL).json()["next_meal"]["meal"] == "breakfast"
    # Marcar el plato nuevo guarda su nombre y vuelve a valer.
    body = client.put(URL + "/meal", {"meal": "breakfast", "state": "done"}, format="json").json()
    assert body["menu"]["meals"][0]["mark"] == {"state": "done", "change": None}
    assert body["menu"]["meals"][0]["previous_mark"] is None
    assert MealCheck.objects.get(profile=user.profile, meal="desayuno").dish == "Tostada con tomate"


def test_f29_past_days_keep_their_marks_and_a_new_menu_does_not_rewrite_them():
    user = athlete()
    yesterday = TODAY - timedelta(days=1)
    plan = menu(user, day=yesterday)
    MealCheck.objects.create(profile=user.profile, date=yesterday, meal="desayuno", state="no_hecho", dish="Avena con yogur")
    days_ = plan.days
    days_[0]["meals"][0]["dishes"][0]["dish"] = "Tostada con tomate"
    plan.days = days_
    plan.save()
    meal = client_for(user).get(URL, {"date": yesterday.isoformat()}).json()["menu"]["meals"][0]
    assert meal["mark"] == {"state": "skipped", "change": None} and meal["previous_mark"] is None
    # La marca guardada no se borra ni se reescribe.
    row = MealCheck.objects.get(profile=user.profile, date=yesterday, meal="desayuno")
    assert (row.state, row.dish) == ("no_hecho", "Avena con yogur")


def test_a_mark_without_dish_from_the_old_history_still_counts():
    user = athlete()
    menu(user)
    MealCheck.objects.create(profile=user.profile, date=TODAY, meal="desayuno", state="hecho", dish="")
    meal = client_for(user).get(URL).json()["menu"]["meals"][0]
    assert meal["mark"] == {"state": "done", "change": None} and meal["previous_mark"] is None


def test_same_dish_with_other_case_keeps_its_mark():
    user = athlete()
    menu(user)
    MealCheck.objects.create(profile=user.profile, date=TODAY, meal="desayuno", state="no_hecho", dish="AVENA CON YOGUR")
    assert client_for(user).get(URL).json()["menu"]["meals"][0]["mark"]["state"] == "skipped"


def real_menu(user):
    """Un menú con alimentos de la tabla del motor, para que tenga kcal previstas."""
    meals = [
        {"meal": "breakfast", "dishes": [{"dish": "Avena con yogur", "items": ["copos de avena=60", "arroz blanco, cocido=100"]}]},
        {"meal": "lunch", "dishes": [{"dish": "Arroz", "items": ["arroz blanco, cocido=200"]}]},
        {"meal": "dinner", "free": True, "dishes": []},
    ]
    return MealPlan.objects.create(profile=user.profile, start_date=MONDAY, days=[{"date": TODAY.isoformat(), "meals": meals}])


def diary(user, day=TODAY):
    entry = UserState.objects.filter(profile=user.profile, key=f"nutri_{day.isoformat()}").first()
    return entry.value if entry else []


def test_a_done_meal_adds_its_planned_kcal_to_the_nutrition_diary_and_unmarking_removes_it():
    """F6 (como ParteDiario): «Hecha» suma al diario las kcal y macros previstas del plato, como una
    entrada ligada a la marca; desmarcar, «No hecha» o «Cambiada» la quitan y lo demás se queda."""
    user = athlete()
    real_menu(user)
    UserState.objects.create(
        profile=user.profile, key=f"nutri_{TODAY.isoformat()}", updated_at=timezone.now(),
        value=[{"id": "a1", "meal": "Snack", "name": "Plátano", "grams": 120, "kcal": 107, "p": 1, "c": 27, "f": 0}],
    )
    client = client_for(user)
    body = client.get(URL).json()
    breakfast = body["menu"]["meals"][0]
    assert breakfast["totals"]["kcal"] > 0 and {"p", "c", "f"} <= set(breakfast["totals"])
    assert body["menu"]["meals"][2]["totals"] is None  # comida libre: sin previsión

    client.put(URL + "/meal", {"meal": "breakfast", "state": "done"}, format="json")
    items = diary(user)
    assert [i["id"] for i in items] == ["a1", f"menu-{TODAY.isoformat()}-breakfast"]
    added = items[1]
    assert added["source"] == "menu" and added["link"] == f"menu:{TODAY.isoformat()}:breakfast"
    assert added["meal"] == "Desayuno" and added["name"] == "Avena con yogur"
    assert (added["kcal"], added["p"], added["c"], added["f"]) == tuple(breakfast["totals"][k] for k in ("kcal", "p", "c", "f"))

    # Marcar otra vez no la duplica
    client.put(URL + "/meal", {"meal": "breakfast", "state": "done"}, format="json")
    assert len(diary(user)) == 2

    # Quitar la marca la quita; lo apuntado a mano se queda
    client.put(URL + "/meal", {"meal": "breakfast", "state": None}, format="json")
    assert [i["id"] for i in diary(user)] == ["a1"]

    # «Cambiada» solo cuenta lo que se apunte: la entrada del menú se va
    client.put(URL + "/meal", {"meal": "breakfast", "state": "done"}, format="json")
    client.put(URL + "/meal", {"meal": "breakfast", "state": "changed", "change": "tostadas"}, format="json")
    assert [i["id"] for i in diary(user)] == ["a1"]
    client.put(URL + "/meal", {"meal": "breakfast", "state": "done"}, format="json")
    client.put(URL + "/meal", {"meal": "breakfast", "state": "skipped"}, format="json")
    assert [i["id"] for i in diary(user)] == ["a1"]

    # Una comida libre marcada como hecha no inventa nada
    client.put(URL + "/meal", {"meal": "dinner", "state": "done"}, format="json")
    assert [i["id"] for i in diary(user)] == ["a1"]


def test_the_diary_write_wins_over_a_client_clock_slightly_ahead():
    user = athlete()
    real_menu(user)
    ahead = timezone.now() + timedelta(minutes=3)
    UserState.objects.create(profile=user.profile, key=f"nutri_{TODAY.isoformat()}", updated_at=ahead, value=[])
    client_for(user).put(URL + "/meal", {"meal": "breakfast", "state": "done"}, format="json")
    entry = UserState.objects.get(profile=user.profile, key=f"nutri_{TODAY.isoformat()}")
    assert entry.updated_at > ahead and len(entry.value) == 1


def test_two_weigh_ins_on_the_same_day_count_as_their_mean_everywhere():
    """F28: el pesaje de Hoy (8:00) y otro de Biometría (11:21) el mismo día. Cuenta la media del
    día, como la tendencia del motor: Hoy, el último peso (`/coach/safety`) y la tendencia."""
    from coaching.bridge.adapters import daily_weights, latest_weight
    from profiles.models import BiometricsLog

    user = athlete(weight=None)
    client = client_for(user)
    client.post(URL, {"weight_kg": 80.1}, format="json")
    BiometricsLog.objects.create(profile=user.profile, weight_kg=80.5, timestamp=datetime.combine(TODAY, time(11, 21), tzinfo=MADRID))
    body = client.get(URL).json()
    assert body["weight_kg"] == 80.1  # lo apuntado en Hoy sigue siendo lo de Hoy
    assert body["day_weight"] == {"kg": 80.3, "count": 2}
    assert daily_weights(user)[-1][1:] == (pytest.approx(80.3), 2)
    assert latest_weight(user, TODAY) == (pytest.approx(80.3), TODAY)
    assert client.get("/api/v1/coach/safety").json()["weight"]["kg"] == pytest.approx(80.3)
    # Otro día con un solo pesaje: ese pesaje
    yesterday = client.get(URL, {"date": (TODAY - timedelta(days=1)).isoformat()}).json()
    assert yesterday["day_weight"] is None


def test_meal_marks_are_validated_against_the_menu():
    user = athlete()
    client = client_for(user)
    assert client.put(URL + "/meal", {"meal": "breakfast", "state": "done"}, format="json").status_code == 400
    menu(user)
    assert client.put(URL + "/meal", {"meal": "brunch", "state": "done"}, format="json").status_code == 400
    assert client.put(URL + "/meal", {"meal": "lunch", "state": "eaten"}, format="json").status_code == 400
    long = "x" * 301
    assert client.put(URL + "/meal", {"meal": "lunch", "state": "changed", "change": long}, format="json").status_code == 400


def test_menu_of_an_older_plan_still_covers_the_day():
    user = athlete()
    menu(user, start=TODAY - timedelta(days=6))
    assert client_for(user).get(URL).json()["menu"]["meals"]


def test_add_cardio_sessions_and_the_week_total_counts_vigorous_double():
    user = athlete()
    client = client_for(user)
    res = client.post(URL + "/cardio", {"type": "walk", "minutes": 40}, format="json")
    assert res.status_code == 201
    body = client.post(URL + "/cardio", {"type": "run", "minutes": 20}, format="json").json()
    sessions = body["cardio"]["sessions"]
    assert [(s["type"], s["minutes"], s["vigorous"], s["equivalent"]) for s in sessions] == [
        ("walk", 40, False, 40),
        ("run", 20, True, 40),
    ]
    assert all(s["deletable"] for s in sessions)
    week = body["cardio"]["week"]
    assert week["minutes"] == 60 and week["equivalent"] == 80
    activity = Activity.objects.get(pk=sessions[1]["id"])
    assert activity.kind == Activity.Kind.SPORT and activity.detail == {"sport_key": "run", "intensity": "Intenso", "origin": "today"}
    assert days.local_day(user.profile, activity.started_at) == TODAY


def test_intensity_can_override_the_type_default():
    user = athlete()
    body = client_for(user).post(URL + "/cardio", {"type": "walk", "minutes": 30, "intensity": "vigorous"}, format="json").json()
    assert body["cardio"]["sessions"][0]["vigorous"] is True and body["cardio"]["week"]["equivalent"] == 60


def test_week_total_reads_sports_and_mma_of_the_whole_week():
    user = athlete()
    sport(user, 30, day=MONDAY, intensity="Moderado")
    sport(user, 20, day=MONDAY, format="hiit")  # intervalos en Deportes: vigoroso
    sport(user, 10, day=MONDAY, rpe=8)  # el RPE manda
    sport(user, 15, day=MONDAY, rpe=5, intensity="Intenso")
    sport(user, 25, day=MONDAY, sport_key="run")  # trote importado de ParteDiario: vigoroso, como allí
    sport(user, 5, day=MONDAY, sport_key="walk")
    sport(user, 60, day=MONDAY, kind=Activity.Kind.MMA)  # convención: moderado
    sport(user, 45, day=MONDAY, kind=Activity.Kind.GYM)  # la fuerza no cuenta
    sport(user, 99, day=MONDAY - timedelta(days=1))  # la semana anterior
    body = client_for(user).get(URL).json()
    week = body["cardio"]["week"]
    assert week["minutes"] == 30 + 20 + 10 + 15 + 25 + 5 + 60
    assert week["equivalent"] == 30 + 40 + 20 + 15 + 50 + 5 + 60
    assert week["mma_minutes"] == 60 and week["mma_convention"] == "fightlab"
    assert body["cardio"]["sessions"] == []  # nada hoy


def test_cardio_is_validated():
    client = client_for(athlete())
    for body in (
        {"type": "teleport", "minutes": 30},
        {"type": "walk", "minutes": 0},
        {"type": "walk", "minutes": 601},
        {"type": "walk", "minutes": "30"},
        {"type": "walk", "minutes": 30, "intensity": "max"},
        {"type": "walk", "minutes": 30, "date": (TODAY + timedelta(days=1)).isoformat()},
    ):
        assert client.post(URL + "/cardio", body, format="json").status_code == 400, body


def test_cardio_on_a_past_day_lands_on_that_day():
    user = athlete()
    yesterday = TODAY - timedelta(days=1)
    client_for(user).post(URL + "/cardio", {"type": "bike", "minutes": 30, "date": yesterday.isoformat()}, format="json")
    (activity,) = Activity.objects.filter(profile=user.profile)
    assert days.local_day(user.profile, activity.started_at) == yesterday


def test_only_sessions_logged_from_today_can_be_deleted_here():
    user = athlete()
    other = athlete()
    client = client_for(user)
    body = client.post(URL + "/cardio", {"type": "walk", "minutes": 30}, format="json").json()
    own = body["cardio"]["sessions"][0]["id"]
    from_sports = sport(user, 20, intensity="Moderado")
    assert client.delete(f"{URL}/cardio/{from_sports.pk}").status_code == 409
    assert client.delete(f"{URL}/cardio/{sport(other, 20).pk}").status_code == 404
    res = client.delete(f"{URL}/cardio/{own}")
    assert res.status_code == 200 and [s["id"] for s in res.json()["cardio"]["sessions"]] == [from_sports.pk]
