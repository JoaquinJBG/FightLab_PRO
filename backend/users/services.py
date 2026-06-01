from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import IntegrityError, transaction

from .tokens import generate_email_verification_token, verify_email_verification_token

User = get_user_model()


def _send_verification_email(user) -> None:
    token = generate_email_verification_token(user)
    link = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    send_mail(
        subject="Verify your FightLab Pro account",
        message=f"Welcome to FightLab Pro. Verify your email:\n\n{link}\n",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
    )


@transaction.atomic
def user_create(*, email: str, password: str):
    """Create an inactive user and send the verification email."""
    try:
        user = User.objects.create_user(
            email=email, password=password, is_active=False
        )
    except IntegrityError as exc:
        raise ValueError("A user with this email already exists") from exc
    _send_verification_email(user)
    return user


@transaction.atomic
def email_verify(*, token: str):
    """Activate the user encoded in a valid verification token."""
    user_id = verify_email_verification_token(token)
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist as exc:
        raise ValueError("User no longer exists") from exc
    if not user.is_email_verified:
        user.is_active = True
        user.is_email_verified = True
        user.save(update_fields=["is_active", "is_email_verified", "updated_at"])
    return user


def verification_resend(*, email: str) -> None:
    """Resend the verification email if the user exists and is unverified."""
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return  # do not leak which emails exist
    if user.is_email_verified:
        return
    _send_verification_email(user)
