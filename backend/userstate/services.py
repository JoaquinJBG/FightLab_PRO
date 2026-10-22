import json
import re
from datetime import date

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Func, IntegerField, Sum, TextField
from django.db.models.functions import Cast
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .constants import (
    CLIENT_CLOCK_SKEW,
    DATE_WINDOW,
    DATED_KEY_RE,
    MAX_BULK_ITEMS,  # noqa: F401  (lo importa serializers)
    MAX_USER_BYTES,
    MAX_VALUE_BYTES,
)
from .models import UserState

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


def validate_key_date(key) -> None:
    """Las claves con fecha solo aceptan fechas reales dentro de ±2 años de hoy."""
    match = DATED_KEY_RE.match(key)
    if match is None:
        return
    try:
        day = date.fromisoformat(match.group(1))
    except ValueError:
        raise ValidationError({"key": ["Fecha no válida en la clave."]})
    today = timezone.localdate()
    if abs((day - today).days) > DATE_WINDOW.days:
        raise ValidationError({"key": ["Fecha fuera del rango permitido (±2 años)."]})


def _bytes_used_by_others(profile, key) -> int:
    total = (
        UserState.objects.filter(profile=profile)
        .exclude(key=key)
        .aggregate(total=Sum(Func(Cast("value", TextField()), function="octet_length", output_field=IntegerField())))["total"]
    )
    return total or 0


def state_put(*, profile, key, value, client_updated_at=None):
    """Crea o actualiza una entrada con last-write-wins por `updated_at`.

    Si ya hay un valor en el servidor más nuevo que el que manda el cliente, el
    servidor gana: no se sobrescribe y se devuelve tal cual (accepted=False) para
    que el cliente adopte ese valor. En cualquier otro caso, se guarda el valor del
    cliente (accepted=True). Devuelve (UserState, accepted).

    El reloj del cliente se recorta a `ahora + 5 min` (una fila ya guardada con fecha
    futura pierde contra cualquier escritura en ventana) para que un reloj adelantado no bloquee la clave.
    Dos primeras escrituras concurrentes sobre la misma clave chocan en
    `unique_profile_key`: la perdedora reintenta una vez como actualización.
    """
    validate_key(key)
    validate_key_date(key)
    validate_value_size(value)
    ceiling = timezone.now() + CLIENT_CLOCK_SKEW
    incoming_at = min(parse_client_updated_at(client_updated_at), ceiling)
    if _bytes_used_by_others(profile, key) + value_size_bytes(value) > MAX_USER_BYTES:
        raise ValidationError({"value": ["Has alcanzado el límite de datos guardados en tu cuenta."]})

    for attempt in (0, 1):
        try:
            with transaction.atomic():
                existing = (
                    UserState.objects.select_for_update().filter(profile=profile, key=key).first()
                )
                if existing is not None and existing.updated_at <= ceiling and existing.updated_at > incoming_at:
                    return existing, False
                entry = existing or UserState(profile=profile, key=key)
                entry.value = value
                entry.updated_at = incoming_at
                entry.full_clean(validate_unique=False, validate_constraints=False)
                entry.save()
                return entry, True
        except IntegrityError:
            if attempt:
                raise


def state_delete(*, profile, key) -> None:
    validate_key(key)
    UserState.objects.filter(profile=profile, key=key).delete()


def error_detail(exc: ValidationError):
    return exc.message_dict if hasattr(exc, "message_dict") else exc.messages


def state_put_bulk(*, profile, items):
    """Aplica una lista de items `{key, value, updated_at}` con el mismo
    last-write-wins de `state_put`, uno por uno: un item inválido (clave fuera
    de la allowlist, valor demasiado grande) no aborta el resto del lote, solo
    queda registrado como `ok: False` en su propia clave. Pensado para la
    migración inicial en lote (ver frontend/lib/user-state.ts), donde cientos
    de claves de localStorage se suben en tandas de hasta `MAX_BULK_ITEMS` sin
    gastar una petición (y por tanto una unidad de throttle) por clave.

    Devuelve un dict `{key: {...}}` con el resultado de CADA item recibido
    (aunque la clave esté repetida o sea inválida), para que el cliente pueda
    saber, item a item, si ya tiene una respuesta final."""
    results = {}
    for item in items:
        key = item["key"]
        try:
            entry, accepted = state_put(
                profile=profile,
                key=key,
                value=item["value"],
                client_updated_at=item.get("updated_at"),
            )
        except ValidationError as exc:
            results[key] = {"ok": False, "detail": error_detail(exc)}
            continue
        results[key] = {
            "ok": True,
            "accepted": accepted,
            "value": entry.value,
            "updated_at": entry.updated_at.isoformat(),
        }
    return results
