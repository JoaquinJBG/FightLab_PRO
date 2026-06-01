import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError

from profiles.models import UserProfile, BiometricsLog
from users.services import user_create, email_verify
from users.tokens import generate_email_verification_token


@pytest.fixture
def profile(db):
    user = user_create(email="a@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    return user.profile


@pytest.mark.django_db
def test_profile_created_on_verification():
    user = user_create(email="x@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    assert UserProfile.objects.filter(user=user).exists()
    assert user.profile.preferred_units == UserProfile.Units.METRIC


@pytest.mark.django_db
def test_biometrics_log_basic(profile):
    log = BiometricsLog.objects.create(profile=profile, weight_kg=80.5, hrv_ms=65)
    assert log.source == BiometricsLog.Source.MANUAL
    assert log.weight_kg == 80.5


@pytest.mark.django_db
def test_sleep_score_must_be_1_to_10(profile):
    log = BiometricsLog(profile=profile, sleep_quality_score=11)
    with pytest.raises(ValidationError):
        log.full_clean()


@pytest.mark.django_db
def test_unique_external_id_per_source(profile):
    BiometricsLog.objects.create(profile=profile, source=BiometricsLog.Source.WHOOP, external_id="abc")
    with pytest.raises(IntegrityError):
        BiometricsLog.objects.create(profile=profile, source=BiometricsLog.Source.WHOOP, external_id="abc")
