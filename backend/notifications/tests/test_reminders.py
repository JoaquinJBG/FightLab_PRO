"""Quién recibe cada aviso y en qué tick, con la hora fija y el envío simulado (`reminders.run`).

Las horas son UTC, como las de Vercel Cron. El jueves 29 de octubre de 2026 Madrid ya está en
horario de invierno (UTC+1: el cambio fue el 25); el 15 de julio, en verano (UTC+2).
"""
import json
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

import pytest

from coaching.models import DayLog, MealPlan, WeeklyPlan, WeeklyReview
from coaching.tests.helpers import make_user
from notifications import reminders
from notifications.models import PushSubscription, ReminderLog, ReminderPrefs

from .conftest import browser_keys

pytestmark = pytest.mark.django_db
THU = date(2026, 10, 29)
TUE = date(2026, 10, 27)
SUMMER = date(2026, 7, 15)
MADRID = ZoneInfo("Europe/Madrid")
VERCEL_JSON = Path(__file__).resolve().parents[3] / "frontend" / "vercel.json"
_n = 0


def at(day: date, hour: int, minute: int = 30) -> datetime:
    """Un momento UTC: Vercel Hobby lanza cada tick en cualquier minuto de su hora."""
    return datetime.combine(day, time(hour, minute), tzinfo=UTC)


def person(tz="Europe/Madrid", language="es", **prefs):
    global _n
    _n += 1
    user = make_user(profile={"timezone": tz, "language": language}, weight=None)
    PushSubscription.objects.create(
        profile=user.profile, endpoint=f"https://fcm.googleapis.com/fcm/send/{_n}", **browser_keys()
    )
    ReminderPrefs.objects.update_or_create(profile=user.profile, defaults=prefs)
    return user


send = mock.Mock()


def sent():
    """Lo que se mandó: (perfil, título, cuerpo, url), leído del payload antes de cifrar."""
    return [(c.args[0].pk, c.args[1]["title"], c.args[1]["body"], c.args[1]["url"]) for c in send.call_args_list]


@pytest.fixture(autouse=True)
def fake_send(vapid):
    send.reset_mock()
    send.side_effect = lambda profile, payload: {"ok": 1, "gone": 0, "error": 0}
    with mock.patch("notifications.reminders.push.send_to_profile", send):
        yield send


def menu_for(user, day, **meal):
    MealPlan.objects.create(
        profile=user.profile,
        start_date=day,
        days=[{"date": day.isoformat(), "meals": [{"meal": "lunch", "dishes": [{"dish": "Lentejas", "items": []}], **meal}]}],
    )


# ---------------------------------------------------------------- en qué tick sale cada aviso


@pytest.mark.parametrize(
    "day, kind, utc_hour",
    [
        (THU, "weigh", 7), (THU, "review", 9), (THU, "mobility", 17), (THU, "eve", 21),  # invierno
        (SUMMER, "weigh", 6), (SUMMER, "review", 8), (SUMMER, "mobility", 16), (SUMMER, "eve", 20),  # verano
    ],
)
def test_in_spain_every_reminder_lands_on_its_own_hour(day, kind, utc_hour):
    tick = reminders.tick_for(day, reminders.TARGET_HOURS[kind], MADRID)
    assert tick == at(day, utc_hour, 0)
    assert tick.astimezone(MADRID).hour == reminders.TARGET_HOURS[kind]


def test_in_another_zone_it_lands_on_the_nearest_tick_of_that_day():
    tokyo = ZoneInfo("Asia/Tokyo")  # UTC+9: los ticks caen a la 1, 2, 5, 6, 15, 16, 17 y 18 h
    eve = reminders.tick_for(THU, 22, tokyo)
    assert eve.astimezone(tokyo).hour == 18 and eve.astimezone(tokyo).date() == THU
    weigh = reminders.tick_for(THU, 8, tokyo)
    assert weigh.astimezone(tokyo).hour == 6 and weigh == at(THU - timedelta(days=1), 21, 0)
    new_york = ZoneInfo("America/New_York")  # UTC-4 a finales de octubre
    assert reminders.tick_for(THU, 18, new_york).astimezone(new_york).hour == 17


def test_the_ticks_are_the_vercel_cron_jobs():
    crons = json.loads(VERCEL_JSON.read_text(encoding="utf-8"))["crons"]
    assert {c["path"] for c in crons} == {"/api/cron/tick"}
    assert all(c["schedule"].startswith("0 ") and c["schedule"].endswith(" * * *") for c in crons)
    hours = sorted(int(c["schedule"].split()[1]) for c in crons)
    assert tuple(hours) == reminders.TICK_HOURS_UTC


# ---------------------------------------------------------------- qué se manda


def test_eve_with_tasks_in_tomorrows_menu():
    user = person()
    menu_for(user, THU + timedelta(days=1), eve="Sacar el pollo del congelador")
    result = reminders.run(at(THU, 21))
    assert result["sent"] == 1
    assert sent() == [(user.profile.pk, "Para mañana", "Deja hecho: Sacar el pollo del congelador", "/today")]


def test_generic_eve_when_tomorrow_has_menu_or_training_but_no_tasks():
    user = person(language="en")
    WeeklyPlan.objects.create(
        profile=user.profile, week_start=THU - timedelta(days=3), status=WeeklyPlan.Status.ACTIVE,
        training_schedule=[{"day": "fri", "kind": "gym", "session": "B"}],
    )
    menu_for(user, THU + timedelta(days=1))
    reminders.run(at(THU, 21))
    ((_, title, body, _),) = sent()
    assert title == "Get tomorrow ready" and body.startswith("Tomorrow: gym (session B), menu.")


def test_no_eve_when_tomorrow_has_nothing():
    person()
    result = reminders.run(at(THU, 21))
    assert result["sent"] == 0 and result["skipped"] == 1 and not send.called


def test_eve_can_be_switched_off():
    user = person(eve=False)
    menu_for(user, THU + timedelta(days=1), eve="Remojar los garbanzos")
    assert reminders.run(at(THU, 21))["sent"] == 0


def test_mobility_only_if_switched_on_and_not_done_today():
    done = person(eve=False, mobility=True)
    pending = person(eve=False, mobility=True)
    person(eve=False)  # apagado
    DayLog.objects.create(profile=done.profile, date=THU, mobility=True)
    reminders.run(at(THU, 17))
    assert [(p, t) for p, t, *_ in sent()] == [(pending.profile.pk, "Movilidad")]


def test_weigh_only_if_switched_on_and_no_weight_yet():
    weighed = person(weigh=True, review=False)
    pending = person(weigh=True, review=False)
    blocked = make_user(profile={"timezone": "Europe/Madrid"}, screening={"scoff_positive": True})
    PushSubscription.objects.create(profile=blocked.profile, endpoint="https://fcm.googleapis.com/fcm/send/b", **browser_keys())
    ReminderPrefs.objects.create(profile=blocked.profile, weigh=True, review=False)
    from coaching import checkin

    checkin.checkin_upsert(weighed, THU, {"weight_kg": 80.1}, THU)
    reminders.run(at(THU, 7))
    assert [(p, t, u) for p, t, _, u in sent()] == [(pending.profile.pk, "Pésate", "/today#weight")]


def test_review_only_on_tuesday_and_while_last_week_is_not_reviewed():
    pending = person(eve=False)
    reviewed = person(eve=False)
    WeeklyReview.objects.create(profile=reviewed.profile, week_end=TUE - timedelta(days=2))
    reminders.run(at(THU, 9))  # jueves
    assert not send.called
    reminders.run(at(TUE, 9))  # martes, 10:30 en Madrid
    assert [(p, t, u) for p, t, _, u in sent()] == [(pending.profile.pk, "Revisión de la semana", "/training/review")]


# ---------------------------------------------------------------- horas y repeticiones


def test_each_reminder_waits_for_its_own_tick():
    person(eve=False, weigh=True, mobility=True)
    for hour in (6, 8, 9, 12, 16, 20, 21):  # ninguno es el de pesarse ni el de la movilidad en invierno
        assert reminders.run(at(THU, hour))["sent"] == 0
    assert reminders.run(at(THU, 7))["sent"] == 1  # pesarse, 8:30 en Madrid
    assert reminders.run(at(THU, 17))["sent"] == 1  # movilidad, 18:30


def test_hours_are_the_persons_local_time():
    madrid = person(mobility=True, eve=False)
    tokyo = person(tz="Asia/Tokyo", mobility=True, eve=False)
    result = reminders.run(at(THU, 17))
    assert [p for p, *_ in sent()] == [madrid.profile.pk] and result["not_due"] >= 1
    send.reset_mock()
    reminders.run(at(THU, 9))  # las 18:30 en Tokio
    assert [p for p, *_ in sent()] == [tokyo.profile.pk]


def test_summer_time_moves_the_tick():
    user = person(mobility=True, eve=False)
    assert reminders.run(at(SUMMER, 17))["sent"] == 0  # 19:30 en Madrid en verano
    reminders.run(at(SUMMER, 16))  # 18:30
    assert [p for p, *_ in sent()] == [user.profile.pk]


def test_a_repeated_cron_does_not_send_twice():
    person(mobility=True, eve=False)
    assert reminders.run(at(THU, 17, 5))["sent"] == 1
    again = reminders.run(at(THU, 17, 50))
    assert again["sent"] == 0 and again["already_sent"] == 1 and send.call_count == 1


def test_a_failed_send_can_be_retried_in_the_same_tick():
    user = person(mobility=True, eve=False)
    send.side_effect = lambda profile, payload: {"ok": 0, "gone": 0, "error": 1}
    assert reminders.run(at(THU, 17))["failed"] == 1
    assert not ReminderLog.objects.filter(profile=user.profile).exists()
    send.side_effect = lambda profile, payload: {"ok": 1, "gone": 0, "error": 0}
    assert reminders.run(at(THU, 17, 45))["sent"] == 1


def test_people_without_a_device_are_not_considered():
    make_user()
    assert reminders.run(at(THU, 21))["profiles"] == 0


def test_without_vapid_nothing_runs(settings):
    person(mobility=True)
    settings.VAPID_PRIVATE_KEY = ""
    result = reminders.run(at(THU, 17))
    assert result["enabled"] is False and result["sent"] == 0
    assert not send.called
