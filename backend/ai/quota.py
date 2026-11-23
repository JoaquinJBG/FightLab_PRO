"""Cuota diaria por usuario y presupuesto global de tokens, sobre la tabla ``AIUsage``.

La unidad de cuota se reserva de forma atómica ANTES de llamar al proveedor
(UPDATE condicional ``count < limit``: con READ COMMITTED, Postgres reevalúa la
condición tras esperar el bloqueo de fila, así que N peticiones simultáneas no
pueden pasar del límite) y se devuelve si la llamada falla.
"""
from __future__ import annotations

import datetime
from dataclasses import dataclass

from django.conf import settings
from django.db.models import F, Sum
from django.utils import timezone

from .models import AIUsage


def today() -> datetime.date:
    return timezone.localdate()


def limit_for(kind: str) -> int:
    """Límite diario del tipo; un valor <= 0 lo desactiva."""
    return {
        AIUsage.Kind.CHAT: settings.AI_DAILY_QUOTA_CHAT,
        AIUsage.Kind.FOOD: settings.AI_DAILY_QUOTA_FOOD,
    }[kind]


@dataclass(frozen=True)
class Reservation:
    # El refund va a la fila reservada, no a la de "hoy": una petición que
    # cruza la medianoche no debe devolver cupo del día siguiente.
    usage_id: int


def reserve(*, user, kind: str) -> Reservation | None:
    """Reserva una unidad de cuota; ``None`` si el usuario ya agotó la de hoy."""
    limit = limit_for(kind)
    row, _ = AIUsage.objects.get_or_create(user=user, kind=kind, date=today())
    qs = AIUsage.objects.filter(pk=row.pk)
    if limit > 0:
        qs = qs.filter(count__lt=limit)
    if qs.update(count=F("count") + 1) == 0:
        return None
    return Reservation(usage_id=row.pk)


def refund(reservation: Reservation) -> None:
    AIUsage.objects.filter(pk=reservation.usage_id, count__gt=0).update(count=F("count") - 1)


def record_tokens(reservation: Reservation, *, input_tokens: int, output_tokens: int) -> None:
    AIUsage.objects.filter(pk=reservation.usage_id).update(
        input_tokens=F("input_tokens") + max(0, int(input_tokens)),
        output_tokens=F("output_tokens") + max(0, int(output_tokens)),
    )


def status_for(*, user, kind: str) -> dict:
    """``{"limit", "used", "remaining"}``; ``limit``/``remaining`` son ``None`` sin límite."""
    limit = limit_for(kind)
    row = AIUsage.objects.filter(user=user, kind=kind, date=today()).only("count").first()
    used = row.count if row else 0
    if limit <= 0:
        return {"limit": None, "used": used, "remaining": None}
    return {"limit": limit, "used": used, "remaining": max(0, limit - used)}


def has_quota(*, user, kind: str) -> bool:
    """Consulta sin reservar: sirve para cortar antes de trabajo caro (Pillow)."""
    remaining = status_for(user=user, kind=kind)["remaining"]
    return remaining is None or remaining > 0


def global_budget_exceeded() -> bool:
    budget = settings.AI_GLOBAL_DAILY_TOKEN_BUDGET
    if budget <= 0:
        return False
    spent = AIUsage.objects.filter(date=today()).aggregate(
        total=Sum(F("input_tokens") + F("output_tokens"))
    )["total"] or 0
    return spent >= budget
