import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from profiles.models import UserProfile
from userstate import services
from userstate.models import UserState
from users.services import email_verify, user_create
from users.tokens import generate_email_verification_token


@pytest.fixture
def profile(db) -> UserProfile:
    user = user_create(email="f@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    return user.profile


@pytest.mark.parametrize(
    "key",
    [
        "nutri_2026-09-24",
        "water_2026-01-01",
        "nutri_goal",
        "weigh",
        "gym_week",
        "gym_sessions",
        "profile_extra",
        "coach_fb",
        "coach_dismissed_2026-12-31",
        "coach_memory",
    ],
)
def test_key_is_allowed_accepts_allowlisted_keys(key):
    assert services.key_is_allowed(key)


@pytest.mark.parametrize(
    "key",
    [
        "",
        "nutri_2026-9-1",  # fecha sin ceros
        "nutri_2026-09-24-x",
        "unknown_key",
        "gym_week; DROP TABLE",
        "a" * 65,
        None,
        123,
    ],
)
def test_key_is_allowed_rejects_everything_else(key):
    assert not services.key_is_allowed(key)


def test_validate_value_size_rejects_over_64kb():
    huge = {"blob": "x" * (services.MAX_VALUE_BYTES + 1)}
    with pytest.raises(ValidationError):
        services.validate_value_size(huge)


def test_validate_value_size_allows_up_to_64kb():
    ok = {"blob": "x" * (services.MAX_VALUE_BYTES - 100)}
    services.validate_value_size(ok)  # no debe lanzar


@pytest.mark.django_db
def test_state_put_creates_new_entry(profile):
    entry, accepted = services.state_put(
        profile=profile, key="weigh", value={"kg": 80}, client_updated_at="2026-09-24T10:00:00Z"
    )
    assert accepted is True
    assert entry.value == {"kg": 80}
    assert UserState.objects.filter(profile=profile, key="weigh").count() == 1


@pytest.mark.django_db
def test_state_put_rejects_disallowed_key(profile):
    with pytest.raises(ValidationError):
        services.state_put(profile=profile, key="not_allowed", value={"x": 1})


@pytest.mark.django_db
def test_state_put_last_write_wins_newer_client_write_applies(profile):
    services.state_put(
        profile=profile, key="weigh", value={"kg": 80}, client_updated_at="2026-09-24T10:00:00Z"
    )
    entry, accepted = services.state_put(
        profile=profile, key="weigh", value={"kg": 81}, client_updated_at="2026-09-24T11:00:00Z"
    )
    assert accepted is True
    assert entry.value == {"kg": 81}


@pytest.mark.django_db
def test_state_put_last_write_wins_older_client_write_is_rejected(profile):
    services.state_put(
        profile=profile, key="weigh", value={"kg": 80}, client_updated_at="2026-09-24T11:00:00Z"
    )
    entry, accepted = services.state_put(
        profile=profile, key="weigh", value={"kg": 79}, client_updated_at="2026-09-24T10:00:00Z"
    )
    assert accepted is False
    # el valor ganador es el del servidor, no el que mandó el cliente
    assert entry.value == {"kg": 80}
    stored = UserState.objects.get(profile=profile, key="weigh")
    assert stored.value == {"kg": 80}


@pytest.mark.django_db
def test_state_put_without_client_updated_at_uses_server_now(profile):
    before = timezone.now()
    entry, accepted = services.state_put(profile=profile, key="weigh", value={"kg": 80})
    assert accepted is True
    assert entry.updated_at >= before


@pytest.mark.django_db
def test_state_delete_is_idempotent(profile):
    services.state_put(profile=profile, key="weigh", value={"kg": 80})
    services.state_delete(profile=profile, key="weigh")
    assert not UserState.objects.filter(profile=profile, key="weigh").exists()
    services.state_delete(profile=profile, key="weigh")  # segunda vez: no falla


@pytest.mark.django_db
def test_state_delete_rejects_disallowed_key(profile):
    with pytest.raises(ValidationError):
        services.state_delete(profile=profile, key="not_allowed")
