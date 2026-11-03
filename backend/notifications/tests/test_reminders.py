"""Quién recibe cada aviso, con la hora fija y el envío simulado (`reminders.run`).

Las horas son UTC, como las del cron de Vercel: 20:30 UTC del jueves 29 de octubre de 2026 son
las 21:30 en Madrid (horario de invierno, UTC+1), y 06:30 UTC son las 07:30.
"""
from datetime import date, datetime, time, timedelta, timezone
from unittest import mock

import pytest

from coaching.models import DayLog, MealPlan, WeeklyPlan, WeeklyReview
from coaching.tests.helpers import make_user
from notifications import reminders
from notifications.models import PushSubscription, ReminderLog, ReminderPrefs

from .conftest import browser_keys

pytestmark = pytest.mark.django_db
THU = date(2026, 10, 29)
TUE = date(2026, 10, 27)
EVENING = datetime.combine(THU, time(20, 30), tzinfo=timezone.utc)
MORNING = datetime.combine(THU, time(6, 30), tzinfo=timezone.utc)
TUESDAY_MORNING = datetime.combine(TUE, time(6, 30), tzinfo=timezone.utc)
_n = 0


def person(tz="Europe/Madrid", language="es", **prefs):
    global _n
    _n += 1
    user = make_user(profile={"timezone": tz, "language": language}, weight=None)
    PushSubscription.objects.create(
        profile=user.profile, endpoint=f"https://fcm.googleapis.com/fcm/send/{_n}", **browser_keys()
    )
    if prefs:
        ReminderPrefs.objects.update_or_create(profile=user.profile, defaults=prefs)
    return user


def sent():
    """Lo que se mandó: (perfil, título, cuerpo) por envío, leído del payload antes de cifrar."""
    return [(c.args[0].pk, c.args[1]["title"], c.args[1]["body"], c.args[1]["url"]) for c in send.call_args_list]


send = mock.Mock()


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


def test_eve_with_tasks_in_tomorrows_menu():
    user = person()
    menu_for(user, THU + timedelta(days=1), eve="Sacar el pollo del congelador")
    result = reminders.run("evening", EVENING)
    assert result["sent"] == 1
    assert sent() == [(user.profile.pk, "Para mañana", "Deja hecho: Sacar el pollo del congelador", "/today")]


def test_generic_eve_when_tomorrow_has_menu_or_training_but_no_tasks():
    user = person(language="en")
    WeeklyPlan.objects.create(
        profile=user.profile, week_start=THU - timedelta(days=3), status=WeeklyPlan.Status.ACTIVE,
        training_schedule=[{"day": "fri", "kind": "gym", "session": "B"}],
    )
    menu_for(user, THU + timedelta(days=1))
    reminders.run("evening", EVENING)
    ((_, title, body, _),) = sent()
    assert title == "Get tomorrow ready" and body.startswith("Tomorrow: gym (session B), menu.")


def test_no_eve_when_tomorrow_has_nothing():
    person()
    result = reminders.run("evening", EVENING)
    assert result["sent"] == 0 and result["skipped"] == 1 and not send.called


def test_eve_can_be_switched_off():
    user = person(eve=False)
    menu_for(user, THU + timedelta(days=1), eve="Remojar los garbanzos")
    assert reminders.run("evening", EVENING)["sent"] == 0


def test_mobility_only_if_switched_on_and_not_done_today():
    done = person(eve=False, mobility=True)
    pending = person(eve=False, mobility=True)
    person(eve=False)  # apagado
    DayLog.objects.create(profile=done.profile, date=THU, mobility=True)
    reminders.run("evening", EVENING)
    assert [(p, t) for p, t, *_ in sent()] == [(pending.profile.pk, "Movilidad")]


def test_weigh_only_if_switched_on_and_no_weight_yet():
    weighed = person(weigh=True, review=False)
    pending = person(weigh=True, review=False)
    blocked = make_user(profile={"timezone": "Europe/Madrid"}, screening={"scoff_positive": True})
    PushSubscription.objects.create(profile=blocked.profile, endpoint="https://fcm.googleapis.com/fcm/send/b", **browser_keys())
    ReminderPrefs.objects.create(profile=blocked.profile, weigh=True, review=False)
    from coaching import checkin

    checkin.checkin_upsert(weighed, THU, {"weight_kg": 80.1}, THU)
    reminders.run("morning", MORNING)
    assert [(p, t, u) for p, t, _, u in sent()] == [(pending.profile.pk, "Pésate", "/today#weight")]


def test_review_only_on_tuesday_and_while_last_week_is_not_reviewed():
    pending = person(eve=False)
    reviewed = person(eve=False)
    WeeklyReview.objects.create(profile=reviewed.profile, week_end=TUE - timedelta(days=2))
    reminders.run("morning", MORNING)  # jueves
    assert not send.called
    reminders.run("morning", TUESDAY_MORNING)
    assert [(p, t, u) for p, t, _, u in sent()] == [(pending.profile.pk, "Revisión de la semana", "/training/review")]


def test_hours_are_the_persons_local_time():
    madrid = person(mobility=True, eve=False)
    tokyo = person(tz="Asia/Tokyo", mobility=True, eve=False)  # 05:30 del viernes: fuera de la ventana
    result = reminders.run("evening", EVENING)
    assert [p for p, *_ in sent()] == [madrid.profile.pk]
    assert result["out_of_window"] == 1 and tokyo.profile.pk not in [p for p, *_ in sent()]


def test_summer_time_moves_the_local_hour():
    # 20:30 UTC del 15 de julio son las 22:30 en Madrid (UTC+2): sigue dentro de la ventana.
    user = person(mobility=True, eve=False)
    reminders.run("evening", datetime(2026, 7, 15, 20, 30, tzinfo=timezone.utc))
    assert [p for p, *_ in sent()] == [user.profile.pk]


def test_a_repeated_cron_does_not_send_twice():
    person(mobility=True, eve=False)
    assert reminders.run("evening", EVENING)["sent"] == 1
    again = reminders.run("evening", EVENING + timedelta(minutes=20))
    assert again["sent"] == 0 and again["already_sent"] == 1 and send.call_count == 1


def test_a_failed_send_can_be_retried_the_same_day():
    user = person(mobility=True, eve=False)
    send.side_effect = lambda profile, payload: {"ok": 0, "gone": 0, "error": 1}
    assert reminders.run("evening", EVENING)["failed"] == 1
    assert not ReminderLog.objects.filter(profile=user.profile).exists()
    send.side_effect = lambda profile, payload: {"ok": 1, "gone": 0, "error": 0}
    assert reminders.run("evening", EVENING)["sent"] == 1


def test_people_without_a_device_are_not_considered():
    make_user()
    assert reminders.run("evening", EVENING)["profiles"] == 0


def test_without_vapid_nothing_runs(settings):
    person(mobility=True)
    settings.VAPID_PRIVATE_KEY = ""
    assert reminders.run("evening", EVENING) == {"enabled": False, "profiles": 0, "sent": 0, "skipped": 0,
                                                 "out_of_window": 0, "already_sent": 0, "failed": 0}
    assert not send.called
