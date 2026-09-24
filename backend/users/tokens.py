from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core import signing
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

_SALT = "users.email-verification"

# El hash del token incluye password y last_login: se invalida solo al usarse
# (cambia la contraseña) o si el usuario vuelve a iniciar sesión mientras tanto.
password_reset_token_generator = PasswordResetTokenGenerator()


def generate_email_verification_token(user) -> str:
    """Return a signed, URL-safe token encoding the user id."""
    return signing.dumps({"user_id": user.id}, salt=_SALT)


def verify_email_verification_token(token: str, max_age: int | None = None) -> int:
    """Return the user id from a valid token, else raise ValueError."""
    if max_age is None:
        max_age = settings.EMAIL_VERIFICATION_TIMEOUT
    try:
        data = signing.loads(token, salt=_SALT, max_age=max_age)
    except signing.BadSignature as exc:
        raise ValueError("Invalid or expired verification token") from exc
    return data["user_id"]


def generate_password_reset_uid_and_token(user) -> tuple[str, str]:
    """Return (uid, token) to build the {FRONTEND_URL}/reset-password link."""
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = password_reset_token_generator.make_token(user)
    return uid, token


def get_user_from_password_reset_uid(uid: str):
    """Return the user encoded in a password-reset uid, or None if malformed."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    try:
        user_id = force_str(urlsafe_base64_decode(uid))
        return User.objects.get(pk=user_id)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return None


def check_password_reset_token(user, token: str) -> bool:
    return password_reset_token_generator.check_token(user, token)
