"""Adaptador perfil de FightLab → `coach.profile.Profile` (spec §6.8)."""
from datetime import date, datetime, timezone

import pytest
from coach import energy, safety
from coach.profile import Profile, ProfileIncomplete

from coaching.bridge.adapters import latest_weight, to_coach_profile, weigh_ins
from coaching.services import injury_add, screening_set
from profiles.models import BiometricsLog
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token

TODAY = date(2026, 10, 29)


@pytest.fixture
def user(db):
    user = user_create(email="ad@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    profile = user.profile
    profile.date_of_birth = date(1990, 5, 1)
    profile.height_cm = 178
    profile.gender = "MALE"
    profile.save()
    return user


def test_returns_a_coach_profile(user):
    p = to_coach_profile(user, TODAY)
    assert isinstance(p, Profile)
    assert p.sex == "male"
    assert p.birth_date == date(1990, 5, 1)
    assert p.height_cm == 178
    assert p.language == "es"


def test_null_screening_keys_are_left_out(user):
    screening_set(user.profile, "scoff_yes_count", 0, origin="onboarding")
    screening_set(user.profile, "scoff_positive", False, origin="onboarding")
    p = to_coach_profile(user, TODAY)
    assert p.screening == {"scoff_yes_count": 0, "scoff_positive": False}


def test_unanswered_parq_gives_review_before_vigorous(user):
    p = to_coach_profile(user, TODAY)
    assert "parq_any_yes" not in p.screening
    assert safety.flags(p, TODAY).review_before_vigorous


def test_parq_answered_no_is_kept_as_false(user):
    screening_set(user.profile, "parq_any_yes", False, origin="onboarding")
    p = to_coach_profile(user, TODAY)
    assert p.screening["parq_any_yes"] is False
    assert not safety.flags(p, TODAY).review_before_vigorous


@pytest.mark.parametrize("gender", ["OTHER", None])
def test_other_gender_without_equation_sex_has_no_sex(user, gender):
    user.profile.gender = gender
    user.profile.save()
    BiometricsLog.objects.create(profile=user.profile, weight_kg=70)
    p = to_coach_profile(user, TODAY)
    assert p.sex is None
    with pytest.raises(ProfileIncomplete) as exc:
        energy.rmr_mifflin(p, TODAY)
    assert exc.value.field == "sex"


def test_equation_sex_wins(user):
    user.profile.gender = "OTHER"
    user.profile.equation_sex = "female"
    user.profile.save()
    assert to_coach_profile(user, TODAY).sex == "female"


def test_weight_is_the_latest_biometrics_log_and_its_date(user):
    profile = user.profile
    BiometricsLog.objects.create(profile=profile, weight_kg=80, timestamp=datetime(2026, 10, 1, 8, tzinfo=timezone.utc))
    BiometricsLog.objects.create(profile=profile, weight_kg=None, timestamp=datetime(2026, 10, 20, 8, tzinfo=timezone.utc))
    BiometricsLog.objects.create(profile=profile, weight_kg="78.40", timestamp=datetime(2026, 10, 15, 8, tzinfo=timezone.utc))
    assert latest_weight(user, TODAY) == (78.4, date(2026, 10, 15))
    p = to_coach_profile(user, TODAY)
    assert p.weight_kg == 78.4 and isinstance(p.weight_kg, float)


def test_weight_date_uses_the_profile_timezone(user):
    user.profile.timezone = "Europe/Madrid"
    user.profile.save()
    BiometricsLog.objects.create(profile=user.profile, weight_kg=80, timestamp=datetime(2026, 10, 14, 23, 30, tzinfo=timezone.utc))
    assert latest_weight(user, TODAY) == (80.0, date(2026, 10, 15))
    assert weigh_ins(user) == [(date(2026, 10, 15), 80.0)]


def test_no_weight(user):
    assert latest_weight(user, TODAY) is None
    assert to_coach_profile(user, TODAY).weight_kg is None


def test_medications_conditions_and_injuries(user):
    profile = user.profile
    profile.medications = ["beta_blocker"]
    profile.medications_other = ["ibuprofeno"]
    profile.conditions = ["hypertension"]
    profile.region = "es"
    profile.save()
    injury_add(profile, area="hombro", status="active", since=date(2026, 9, 1), exercises=["Press banca"])
    injury_add(profile, area="rodilla", status="cleared", since=date(2026, 1, 1), cleared_on=date(2026, 3, 1))
    p = to_coach_profile(user, TODAY)
    assert p.medications == ["beta_blocker", "ibuprofeno"]
    assert p.conditions == ["hypertension"]
    assert p.region == "es"
    assert sorted(i["area"] for i in p.injuries) == ["hombro", "rodilla"]
    shoulder = next(i for i in p.injuries if i["area"] == "hombro")
    assert shoulder == {"area": "hombro", "status": "active", "since": date(2026, 9, 1), "exercises": ["Press banca"]}
    flags = safety.flags(p, TODAY)
    assert flags.use_rpe_not_hr and "Press banca" in flags.paused_exercises
    assert flags.emergency_number == "112"  # el de la región


def test_own_emergency_number_wins(user):
    user.profile.region = "es"
    user.profile.emergency_number = "911"
    user.profile.save()
    assert safety.flags(to_coach_profile(user, TODAY), TODAY).emergency_number == "911"
