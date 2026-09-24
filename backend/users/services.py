from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.template.loader import render_to_string

from .tokens import (
    check_password_reset_token,
    generate_email_verification_token,
    generate_password_reset_uid_and_token,
    get_user_from_password_reset_uid,
    verify_email_verification_token,
)

User = get_user_model()


def is_beta_email_allowed(email: str) -> bool:
    """Beta cerrada por invitación.

    BETA_ALLOWED_EMAILS vacía + DEBUG -> se permite todo (dev local).
    BETA_ALLOWED_EMAILS vacía + DEBUG=False -> no se permite ningún registro.
    """
    allowed = settings.BETA_ALLOWED_EMAILS
    if not allowed:
        return settings.DEBUG
    return email.strip().lower() in allowed


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
    se reenvía el enlace de verificación. La contraseña que se manda en ESTE
    intento no se usa (evita el secuestro por sobrescritura: cualquiera
    podría "re-registrar" el email de otra persona con una contraseña suya
    y quedarse con la cuenta). Pero tampoco se conserva la contraseña que ya
    tuviera la cuenta: se deja sin contraseña utilizable
    (set_unusable_password). Si no se hiciera así, cabría un secuestro
    simétrico por PRE-registro: alguien registra primero el email de la
    víctima (tiene que estar en BETA_ALLOWED_EMAILS) y, cuando la víctima se
    registra después y verifica el enlace que le llega, entraría con la
    contraseña que puso el atacante. Al dejarla sin contraseña utilizable,
    quien verifique el enlace tiene que pasar por "recuperar contraseña"
    antes de poder entrar, así que un pre-registro ajeno no da acceso a
    nadie. Si la cuenta ya está verificada, sí es un error.
    """
    email = email.strip().lower()
    existing = User.objects.filter(email=email).first()
    if existing is not None:
        if existing.is_email_verified:
            raise ValueError("A user with this email already exists")
        existing.set_unusable_password()
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
    email = email.strip().lower()
    # iexact: cubre cuentas guardadas con mayúsculas en la parte local del
    # email (alta desde el admin, createsuperuser), que normalize_email no
    # toca.
    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        return  # do not leak which emails exist
    if user.is_email_verified:
        return
    _send_verification_email(user)


def _send_password_reset_email(user) -> None:
    uid, token = generate_password_reset_uid_and_token(user)
    link = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
    html = render_to_string("users/password_reset.html", {"reset_link": link})
    send_mail(
        subject="Recupera tu contraseña de FightLab Pro",
        message=(
            f"Hemos recibido una solicitud para restablecer tu contraseña:\n\n{link}\n\n"
            "Si no fuiste tú, ignora este email."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        html_message=html,
    )
    if settings.DEBUG:
        print(f"\n[DEV] Recuperación de contraseña para {user.email}:\n{link}\n", flush=True)


def password_reset_request(*, email: str) -> None:
    """Send the reset link if an active account with that email exists.

    Nunca informa de si el email existe: la vista siempre responde 200.
    """
    email = email.strip().lower()
    # iexact: mismo motivo que en verification_resend (mayúsculas guardadas
    # fuera del flujo de registro normal).
    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        return
    if not user.is_active:
        return
    _send_password_reset_email(user)


@transaction.atomic
def password_reset_confirm(*, uid: str, token: str, password: str) -> None:
    """Validate the uid/token pair and set the new password.

    La fuerza de la contraseña se valida aquí (no en el serializer) porque
    UserAttributeSimilarityValidator necesita el usuario para poder rechazar
    una contraseña igual o parecida a su email, y el usuario solo se conoce
    tras resolver el uid.
    """
    user = get_user_from_password_reset_uid(uid)
    if user is None or not check_password_reset_token(user, token):
        raise ValueError("Invalid or expired reset link")
    try:
        validate_password(password, user)
    except DjangoValidationError as exc:
        raise ValueError(" ".join(exc.messages)) from exc
    user.set_password(password)
    user.save(update_fields=["password", "updated_at"])
    _blacklist_all_outstanding_tokens(user)


def _blacklist_all_outstanding_tokens(user) -> None:
    """Cierra cualquier sesión abierta (refresh vivos) tras cambiar la contraseña."""
    from rest_framework_simplejwt.token_blacklist.models import (
        BlacklistedToken,
        OutstandingToken,
    )

    for outstanding in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=outstanding)
