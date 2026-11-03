"""Envío de Web Push con VAPID (`pywebpush`). Sin `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y
`VAPID_SUBJECT` los avisos quedan apagados: no se envía nada y la API lo dice.

Solo se envía a servicios de push conocidos (`PUSH_HOSTS`): el `endpoint` lo manda el navegador,
y sin esa lista cualquiera podría hacer que el servidor publique en una URL suya.
"""
import json
import logging
from urllib.parse import urlsplit

from django.conf import settings
from django.utils import timezone

from .models import PushSubscription

logger = logging.getLogger(__name__)

# Los servicios de push de Chrome/Android, Firefox, Safari (iOS 16.4+ y macOS) y Edge.
PUSH_HOSTS = (
    "fcm.googleapis.com",
    "android.googleapis.com",
    "updates.push.services.mozilla.com",
    "push.services.mozilla.com",
    "web.push.apple.com",
    "notify.windows.com",
)
# convention (FightLab): un aviso que no llega en 12 h ya no sirve (el de la víspera es para esa
# noche y el de pesarse, para esa mañana).
TTL_SECONDS = 12 * 3600
TIMEOUT_SECONDS = 10
# convention (FightLab): hasta 10 navegadores por persona; al pasar, se borra el más antiguo.
MAX_SUBSCRIPTIONS = 10


def configured() -> bool:
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY and settings.VAPID_SUBJECT)


def endpoint_allowed(endpoint: str) -> bool:
    try:
        parts = urlsplit(endpoint)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host:
        return False
    return any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


def send(sub: PushSubscription, payload: dict) -> str:
    """Envía `payload` (JSON) a una suscripción. Devuelve `ok`, `gone` (el navegador ya no la
    tiene: se borra) o `error` (se deja para otro día)."""
    from pywebpush import WebPushException, webpush

    if not endpoint_allowed(sub.endpoint):
        sub.delete()
        return "gone"
    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            # Un dict nuevo cada vez: pywebpush le añade `aud` y `exp` del servicio de este envío.
            vapid_claims={"sub": settings.VAPID_SUBJECT},
            ttl=TTL_SECONDS,
            timeout=TIMEOUT_SECONDS,
        )
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        if status in (404, 410):
            sub.delete()
            return "gone"
        logger.warning("Web Push ha fallado (%s) para la suscripción %s", status, sub.pk)
        return "error"
    except Exception:  # red, certificados, clave mal copiada...
        logger.exception("Web Push ha fallado para la suscripción %s", sub.pk)
        return "error"
    PushSubscription.objects.filter(pk=sub.pk).update(last_ok_at=timezone.now())
    return "ok"


def send_to_profile(profile, payload: dict) -> dict:
    """Envía a todos los navegadores de `profile`; cuenta cómo fue."""
    counts = {"ok": 0, "gone": 0, "error": 0}
    for sub in list(PushSubscription.objects.filter(profile=profile)):
        counts[send(sub, payload)] += 1
    return counts
