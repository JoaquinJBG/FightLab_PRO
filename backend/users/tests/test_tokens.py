import pytest
from django.contrib.auth import get_user_model

from users.tokens import (
    generate_email_verification_token,
    verify_email_verification_token,
)

User = get_user_model()


@pytest.mark.django_db
def test_roundtrip_returns_user_id():
    user = User.objects.create_user(email="a@b.com", password="pw-strong-123")
    token = generate_email_verification_token(user)
    assert verify_email_verification_token(token) == user.id


def test_tampered_token_raises():
    with pytest.raises(ValueError):
        verify_email_verification_token("not-a-valid-token")


@pytest.mark.django_db
def test_expired_token_raises():
    user = User.objects.create_user(email="a@b.com", password="pw-strong-123")
    token = generate_email_verification_token(user)
    with pytest.raises(ValueError):
        verify_email_verification_token(token, max_age=-1)
