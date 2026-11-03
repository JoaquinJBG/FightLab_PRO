import io
import logging
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from rest_framework.test import APIClient

from activities.models import Activity, SetLog
from coaching.models import DailyCheckin, MealPlan, WeeklyPlan, WeeklyReview
from users.demo import CHECKIN_DAYS, SESSIONS, seed_demo
from users.models import DemoAccount

EMAIL = "demo@fightlab.test"
PASSWORD = "Demo-pass-2026!"
ENV = {"DEMO_USER_EMAIL": EMAIL, "DEMO_USER_PASSWORD": PASSWORD}


def counts(profile):
    return {
        "checkins": DailyCheckin.objects.filter(profile=profile).count(),
        "weights": profile.biometrics.exclude(weight_kg=None).count(),
        "activities": Activity.objects.filter(profile=profile).count(),
        "sets": SetLog.objects.filter(activity__profile=profile).count(),
        "plans": WeeklyPlan.objects.filter(profile=profile, status=WeeklyPlan.Status.ACTIVE).count(),
        "reviews": WeeklyReview.objects.filter(profile=profile).count(),
        "menus": MealPlan.objects.filter(profile=profile).count(),
    }


def run_command(monkeypatch, env):
    for key in ("DEMO_USER_EMAIL", "DEMO_USER_PASSWORD"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    out, err = io.StringIO(), io.StringIO()
    call_command("seed_demo", stdout=out, stderr=err)
    return out.getvalue() + err.getvalue()


@pytest.mark.django_db
def test_without_the_variables_it_does_nothing_and_says_so(monkeypatch):
    output = run_command(monkeypatch, {})
    assert output.count("\n") == 1 and "sin DEMO_USER_EMAIL y DEMO_USER_PASSWORD" in output
    assert not get_user_model().objects.exists()
    # Con solo una de las dos, tampoco
    assert seed_demo(env={"DEMO_USER_EMAIL": EMAIL}).status == "skipped"
    assert not get_user_model().objects.exists()


@pytest.mark.django_db
def test_creates_a_verified_demo_user_with_data():
    result = seed_demo(env=ENV)
    assert result.status == "created"
    assert all(not v.startswith("error") for v in result.sections.values()), result.sections
    user = get_user_model().objects.get(email=EMAIL)
    assert user.is_active and user.is_email_verified and user.check_password(PASSWORD)
    assert DemoAccount.objects.filter(user=user).exists()
    profile = user.profile
    assert (profile.gender, profile.goal, profile.region) == ("MALE", "fat_loss", "es")
    assert profile.screening.scoff_yes_count == 0
    c = counts(profile)
    assert c["checkins"] == CHECKIN_DAYS and c["weights"] == CHECKIN_DAYS
    assert c["activities"] == len(SESSIONS) and c["sets"] > 0
    assert set(Activity.objects.filter(profile=profile).values_list("kind", flat=True)) == {"GYM", "MMA", "SPORT"}
    assert c["plans"] == 1 and c["reviews"] == 1 and c["menus"] == 1
    assert MealPlan.objects.get(profile=profile).provider == "fake"
    # Los pesajes bajan: hay tendencia
    weights = [float(w) for w in profile.biometrics.exclude(weight_kg=None).order_by("timestamp").values_list("weight_kg", flat=True)]
    assert weights[-1] < weights[0]


@pytest.mark.django_db
def test_a_second_run_does_not_duplicate_anything(monkeypatch):
    seed_demo(env=ENV)
    profile = get_user_model().objects.get(email=EMAIL).profile
    before = counts(profile)
    result = seed_demo(env=ENV)
    assert result.status == "updated"
    assert counts(profile) == before
    assert get_user_model().objects.filter(email=EMAIL).count() == 1


@pytest.mark.django_db
def test_never_touches_a_real_account_with_the_same_email(monkeypatch):
    real = get_user_model().objects.create_user(email=EMAIL, password="la-de-la-persona-123", is_active=True)
    output = run_command(monkeypatch, ENV)
    assert "no es de demostración" in output
    real.refresh_from_db()
    assert real.check_password("la-de-la-persona-123") and not real.check_password(PASSWORD)
    assert not DemoAccount.objects.exists()
    assert counts(real.profile)["activities"] == 0


@pytest.mark.django_db
def test_the_demo_password_follows_the_variable():
    seed_demo(env=ENV)
    seed_demo(env={**ENV, "DEMO_USER_PASSWORD": "Otra-clave-2026!"})
    user = get_user_model().objects.get(email=EMAIL)
    assert user.check_password("Otra-clave-2026!") and not user.check_password(PASSWORD)


@pytest.mark.django_db
def test_the_password_never_reaches_the_output_or_the_log(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    output = run_command(monkeypatch, ENV) + run_command(monkeypatch, ENV)
    assert "seed_demo: usuario de demostración demo@fightlab.test" in output
    assert PASSWORD not in output and PASSWORD not in caplog.text


@pytest.mark.django_db
def test_the_demo_user_can_log_in_even_outside_the_beta_allowlist(settings):
    seed_demo(env=ENV)
    settings.DEBUG = False
    settings.BETA_ALLOWED_EMAILS = ["otra@persona.test"]
    resp = APIClient().post("/api/v1/auth/login", {"email": EMAIL, "password": PASSWORD}, format="json")
    assert resp.status_code == 200 and "access" in resp.data


def test_the_container_runs_it_on_start_without_blocking_gunicorn():
    dockerfile = (Path(__file__).resolve().parents[2] / "Dockerfile").read_text(encoding="utf-8")
    cmd = next(line for line in dockerfile.splitlines() if line.startswith("CMD "))
    assert "seed_demo ||" in cmd
    assert cmd.index("sync_knowledge") < cmd.index("seed_demo") < cmd.index("gunicorn core.wsgi")
