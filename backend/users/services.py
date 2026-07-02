from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import transaction
from django.template.loader import render_to_string

from .tokens import generate_email_verification_token, verify_email_verification_token

User = get_user_model()


def _send_verification_email(user) -> None:
    token = generate_email_verification_token(user)
    link = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    html = render_to_string("users/verify_email.html", {"verification_link": link})
    send_mail(
        subject="Verifica tu cuenta de FightLab Pro",
        message=(
            f"Bienvenido a FightLab Pro. Verifica tu correo:\n\n{link}\n\n"
            "Este enlace vence en 24 horas."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        html_message=html,
    )
    if settings.DEBUG:
        # Enlace limpio y copiable en consola (el email de dev va en quoted-printable).
        print(f"\n[DEV] Verificación para {user.email}:\n{link}\n", flush=True)


@transaction.atomic
def user_create(*, email: str, password: str):
    """Create an inactive user and send the verification email.

    Si ya existe una cuenta con ese email pero SIN verificar, no es un error:
    se actualiza la contraseña y se reenvía el enlace de verificación (así el
    usuario que se quedó a medias puede recuperar el acceso simplemente
    volviendo a registrarse). Si la cuenta ya está verificada, sí es un error.
    """
    existing = User.objects.filter(email=email).first()
    if existing is not None:
        if existing.is_email_verified:
            raise ValueError("A user with this email already exists")
        existing.set_password(password)
        existing.save(update_fields=["password", "updated_at"])
        _send_verification_email(existing)
        return existing

    user = User.objects.create_user(email=email, password=password, is_active=False)
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
    from profiles.models import UserProfile
    UserProfile.objects.get_or_create(user=user)
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
