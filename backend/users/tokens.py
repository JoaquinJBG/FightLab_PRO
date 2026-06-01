from django.conf import settings
from django.core import signing

_SALT = "users.email-verification"


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
