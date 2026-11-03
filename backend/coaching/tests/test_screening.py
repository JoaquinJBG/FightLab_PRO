"""Cribado y lesiones (spec §6.3): nulos por defecto, eventos y las reglas del coach."""
from datetime import date

import pytest
from coach import profile as coach_profile
from django.core.exceptions import ValidationError

from coaching.models import Injury, Screening, ScreeningEvent
from coaching.services import injury_add, screening_get, screening_set
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token


@pytest.fixture
def profile(db):
    user = user_create(email="s@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    return user.profile


def test_screening_fields_match_the_coach():
    """Los mismos resultados que guarda el coach, ni más ni menos."""
    names = {f.name for f in Screening._meta.get_fields()} - {"id", "profile", "updated_at"}
    assert names == set(coach_profile.SCREENING_KEYS)


def test_screening_is_null_by_default(profile):
    screening = screening_get(profile)
    for key in coach_profile.SCREENING_KEYS:
        assert getattr(screening, key) is None, key


def test_screening_set_writes_an_event(profile):
    screening_set(profile, "scoff_yes_count", 1, origin=ScreeningEvent.Origin.ONBOARDING)
    screening_set(profile, "scoff_yes_count", 2, origin=ScreeningEvent.Origin.CHECKIN)
    events = list(ScreeningEvent.objects.filter(profile=profile).order_by("id"))
    assert [(e.key, e.old_value, e.new_value, e.origin) for e in events] == [
        ("scoff_yes_count", None, 1, "onboarding"),
        ("scoff_yes_count", 1, 2, "checkin"),
    ]
    assert Screening.objects.get(profile=profile).scoff_yes_count == 2


def test_screening_set_same_value_writes_no_event(profile):
    screening_set(profile, "cardiac_symptoms", False, origin="onboarding")
    screening_set(profile, "cardiac_symptoms", False, origin="onboarding")
    assert ScreeningEvent.objects.filter(profile=profile).count() == 1


@pytest.mark.parametrize("key", coach_profile.PARQ_ANSWERS)
def test_changing_a_parq_answer_drops_vigorous_reviewed(profile, key):
    screening_set(profile, key, True, origin="onboarding")
    screening_set(profile, "vigorous_reviewed", True, origin="onboarding")
    screening_set(profile, key, False, origin="review")
    screening = screening_get(profile)
    assert screening.vigorous_reviewed is None
    dropped = ScreeningEvent.objects.filter(profile=profile, key="vigorous_reviewed").last()
    assert (dropped.old_value, dropped.new_value, dropped.origin) == (True, None, "review")


def test_same_parq_answer_keeps_vigorous_reviewed(profile):
    screening_set(profile, "parq_any_yes", True, origin="onboarding")
    screening_set(profile, "vigorous_reviewed", True, origin="onboarding")
    screening_set(profile, "parq_any_yes", True, origin="onboarding")
    assert screening_get(profile).vigorous_reviewed is True


def test_clearing_an_answer_back_to_null(profile):
    """`coach profile set screening.KEY none` borra una respuesta (una tensión antigua)."""
    screening_set(profile, "bp_systolic", 150, origin="checkin")
    screening_set(profile, "bp_systolic", None, origin="checkin")
    assert screening_get(profile).bp_systolic is None


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("scoff_yes_count", 6),
        ("scoff_yes_count", -1),
        ("scoff_yes_count", True),
        ("scoff_positive", 1),
        ("menstrual", "late"),
        ("bp_systolic", "150"),
        ("unknown_key", True),
    ],
)
def test_screening_set_rejects_invalid_values(profile, key, value):
    with pytest.raises(ValidationError):
        screening_set(profile, key, value, origin="onboarding")
    assert not ScreeningEvent.objects.filter(profile=profile).exists()


def test_injury_cleared_needs_cleared_on(profile):
    with pytest.raises(ValidationError):
        injury_add(profile, area="hombro derecho", status="cleared", since=date(2026, 9, 1))


def test_injury_cleared_on_not_before_since(profile):
    with pytest.raises(ValidationError):
        injury_add(
            profile,
            area="hombro derecho",
            status="cleared",
            since=date(2026, 9, 1),
            cleared_on=date(2026, 8, 1),
        )


def test_injury_needs_an_area(profile):
    with pytest.raises(ValidationError):
        injury_add(profile, area="  ", status="active")


def test_injury_active_ok(profile):
    injury = injury_add(
        profile,
        area="hombro derecho",
        status="active",
        since=date(2026, 9, 1),
        professional="fisioterapeuta",
        exercises=["Press banca"],
        origin=Injury.Origin.ONBOARDING,
    )
    assert injury.pk and injury.exercises == ["Press banca"]
    cleared = injury_add(
        profile, area="rodilla", status="cleared", since=date(2026, 1, 1), cleared_on=date(2026, 3, 1)
    )
    assert cleared.status == "cleared"
