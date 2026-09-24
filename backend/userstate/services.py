import json
import re

from django.core.exceptions import ValidationError
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import UserState

MAX_VALUE_BYTES = 64 * 1024  # 64 KB

# Allowlist de claves que el servidor acepta como copia de seguridad de localStorage.
# Ver frontend/lib/user-state.ts para las claves flp_* equivalentes.
ALLOWED_KEY_PATTERNS = [
    re.compile(r"^nutri_\d{4}-\d{2}-\d{2}$"),
    re.compile(r"^water_\d{4}-\d{2}-\d{2}$"),
    re.compile(r"^nutri_goal$"),
    re.compile(r"^weigh$"),
    re.compile(r"^gym_week$"),
    re.compile(r"^gym_sessions$"),
    re.compile(r"^profile_extra$"),
    re.compile(r"^coach_fb$"),
    re.compile(r"^coach_dismissed_\d{4}-\d{2}-\d{2}$"),
    re.compile(r"^coach_memory$"),
]


def key_is_allowed(key) -> bool:
    if not isinstance(key, str) or not key or len(key) > 64:
        return False
    return any(pattern.match(key) for pattern in ALLOWED_KEY_PATTERNS)


def validate_key(key) -> None:
    if not key_is_allowed(key):
        raise ValidationError({"key": ["Clave no permitida."]})


def value_size_bytes(value) -> int:
    return len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def validate_value_size(value) -> None:
    if value_size_bytes(value) > MAX_VALUE_BYTES:
        raise ValidationError({"value": [f"El valor supera los {MAX_VALUE_BYTES} bytes."]})


def parse_client_updated_at(raw):
    """ISO-8601 (lo que manda `Date.toISOString()`); si falta o es inválido, ahora mismo."""
    if isinstance(raw, str) and raw:
        dt = parse_datetime(raw)
        if dt is not None:
            if timezone.is_naive(dt):
                dt = timezone.make_aware(dt, timezone.utc)
            return dt
    return timezone.now()


def state_put(*, profile, key, value, client_updated_at=None):
    """Crea o actualiza una entrada con last-write-wins por `updated_at`.

    Si ya hay un valor en el servidor más nuevo que el que manda el cliente, el
    servidor gana: no se sobrescribe y se devuelve tal cual (accepted=False) para
    que el cliente adopte ese valor. En cualquier otro caso, se guarda el valor del
    cliente (accepted=True). Devuelve (UserState, accepted).
    """
    validate_key(key)
    validate_value_size(value)
    incoming_at = parse_client_updated_at(client_updated_at)

    existing = UserState.objects.filter(profile=profile, key=key).first()
    if existing is not None and existing.updated_at > incoming_at:
        return existing, False

    entry = existing or UserState(profile=profile, key=key)
    entry.value = value
    entry.updated_at = incoming_at
    entry.full_clean()
    entry.save()
    return entry, True


def state_delete(*, profile, key) -> None:
    validate_key(key)
    UserState.objects.filter(profile=profile, key=key).delete()
