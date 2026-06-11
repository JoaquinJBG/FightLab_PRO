import pytest
from django.contrib.auth import get_user_model
from django.core import mail

from users.services import user_create, email_verify, verification_resend
from users.tokens import generate_email_verification_token

User = get_user_model()


@pytest.mark.django_db
def test_user_create_makes_inactive_user_and_sends_email():
    user = user_create(email="a@b.com", password="pw-strong-123")
    assert user.is_active is False
    assert user.is_email_verified is False
    assert len(mail.outbox) == 1
    assert "a@b.com" in mail.outbox[0].to


@pytest.mark.django_db
def test_user_create_resends_for_unverified_duplicate():
    user_create(email="a@b.com", password="pw-strong-123")  # sin verificar
    mail.outbox.clear()
    again = user_create(email="a@b.com", password="pw-strong-456")
    assert again.email == "a@b.com"
    assert again.check_password("pw-strong-456")  # actualiza la contraseña
    assert len(mail.outbox) == 1  # reenvía el enlace


@pytest.mark.django_db
def test_user_create_rejects_verified_duplicate():
    user = user_create(email="a@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    with pytest.raises(ValueError):
        user_create(email="a@b.com", password="pw-strong-456")


@pytest.mark.django_db
def test_email_verify_activates_user():
    user = user_create(email="a@b.com", password="pw-strong-123")
    token = generate_email_verification_token(user)
    verified = email_verify(token=token)
    verified.refresh_from_db()
    assert verified.is_active is True
    assert verified.is_email_verified is True


@pytest.mark.django_db
def test_verification_resend_sends_again_for_unverified():
    user_create(email="a@b.com", password="pw-strong-123")
    mail.outbox.clear()
    verification_resend(email="a@b.com")
    assert len(mail.outbox) == 1
