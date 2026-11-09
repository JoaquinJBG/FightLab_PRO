"""Subir, listar, ver y borrar fotos de tickets (fase 12).

- El cliente redimensiona y comprime la foto (unos 300 KB) antes de subirla; el backend rechaza
  lo que pase de `MAX_UPLOAD_BYTES` y la vuelve a codificar como JPEG sin EXIF ni GPS
  (`profiles.image_processing.process_progress_photo`), así lo que llega a R2 no lleva la
  ubicación del móvil.
- Uso total: la suma de `size` de todas las fotos. Cuando una subida cruza el 80 % de los 10 GB
  gratis de R2 se avisa al admin (log y correo a los superusuarios), una sola vez por cruce.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db.models import Sum

from profiles.image_processing import UnsupportedImageError, process_progress_photo

from .models import TicketPhoto
from .storage import StorageError, get_storage, signed_url_seconds

log = logging.getLogger(__name__)

# convention (FightLab): tope de lo que acepta el backend; el cliente apunta a unos 300 KB.
MAX_UPLOAD_BYTES = 2 * 1024 * 1024
# Los 10 GB del plan gratis de R2 y el umbral del aviso al admin (requisito del plan F12).
FREE_TIER_BYTES = 10 * 1000**3
ALERT_SHARE = 0.8
# convention (FightLab): tickets por usuario, para que una cuenta sola no llene el bucket.
MAX_TICKETS_PER_USER = 500
NOTE_MAX = TicketPhoto._meta.get_field("note").max_length


class TicketError(Exception):
    def __init__(self, code: str, http: int = 400, **params):
        super().__init__(code)
        self.code = code
        self.http = http
        self.params = params


def enabled() -> bool:
    return get_storage() is not None


def used_bytes() -> int:
    return TicketPhoto.objects.aggregate(total=Sum("size"))["total"] or 0


def alert_admins(before: int, after: int) -> bool:
    """Avisa si el uso pasa del umbral con esta subida. Devuelve si ha avisado."""
    limit = FREE_TIER_BYTES * ALERT_SHARE
    if not before < limit <= after:
        return False
    log.warning("fotos de tickets: %s bytes usados, más del 80 %% de los 10 GB de R2", after)
    emails = list(
        get_user_model().objects.filter(is_superuser=True, is_active=True)
        .exclude(email="").values_list("email", flat=True)
    )
    if emails:
        send_mail(
            "FightLab: fotos de tickets al 80 % de R2",
            f"Las fotos de tickets ocupan {after / 1000**3:.2f} GB de los 10 GB gratis de Cloudflare R2.",
            settings.DEFAULT_FROM_EMAIL,
            emails,
            fail_silently=True,
        )
    return True


def ticket_data(ticket: TicketPhoto) -> dict:
    return {
        "id": ticket.id,
        "taken_on": ticket.taken_on.isoformat(),
        "plan_id": ticket.plan_id,
        "size": ticket.size,
        "width": ticket.width,
        "height": ticket.height,
        "note": ticket.note,
        "created_at": ticket.created_at.isoformat(),
    }


def list_data(user, plan_id: int | None = None) -> dict:
    rows = TicketPhoto.objects.filter(profile=user.profile)
    if plan_id is not None:
        rows = rows.filter(plan_id=plan_id)
    return {
        "enabled": enabled(),
        "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
        "tickets": [ticket_data(t) for t in rows],
    }


def upload(user, upload_file, taken_on: date, plan=None, note: str = "") -> TicketPhoto:
    storage = get_storage()
    if storage is None:
        raise TicketError("tickets_not_configured", 503)
    if upload_file.size > MAX_UPLOAD_BYTES:
        raise TicketError("ticket_too_large", 413, mb=MAX_UPLOAD_BYTES // (1024 * 1024))
    if TicketPhoto.objects.filter(profile=user.profile).count() >= MAX_TICKETS_PER_USER:
        raise TicketError("too_many_tickets", 400, max=MAX_TICKETS_PER_USER)
    try:
        data, content_type, width, height = process_progress_photo(upload_file)
    except (UnsupportedImageError, OSError, ValueError, SyntaxError):
        raise TicketError("ticket_not_image") from None
    key = f"tickets/{user.profile.pk}/{uuid.uuid4().hex}.jpg"
    before = used_bytes()
    try:
        storage.put(key, data, content_type)
    except StorageError:
        raise TicketError("tickets_unavailable", 502) from None
    ticket = TicketPhoto.objects.create(
        profile=user.profile, plan=plan, taken_on=taken_on, key=key, size=len(data),
        content_type=content_type, width=width, height=height, note=(note or "").strip()[:NOTE_MAX],
    )
    alert_admins(before, before + len(data))
    return ticket


def signed_url(ticket: TicketPhoto) -> dict:
    storage = get_storage()
    if storage is None:
        raise TicketError("tickets_not_configured", 503)
    seconds = signed_url_seconds()
    try:
        url = storage.signed_url(ticket.key, seconds)
    except StorageError:
        raise TicketError("tickets_unavailable", 502) from None
    return {"url": url, "expires_in": seconds}
