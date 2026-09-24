import json
import logging
import os
from io import BytesIO

import anthropic
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import services

logger = logging.getLogger(__name__)

# El límite real de Anthropic para imágenes ronda los 5 MB en base64; nos quedamos
# por debajo para tener margen y no depender de la codificación exacta.
MAX_PHOTO_BYTES = 4 * 1024 * 1024  # 4 MB
# Lado largo recomendado por Anthropic: por encima no mejora la comprensión de la
# imagen y solo añade tokens (coste) y tiempo de subida.
MAX_PHOTO_LONG_SIDE = 1568
MAX_MESSAGES = 20
MAX_MESSAGE_CHARS = 2000
MAX_CONTEXT_CHARS = 2000  # el contexto legítimo ocupa ~300; esto frena el abuso de tokens
# Solo las claves que el frontend envía de verdad: lo demás no entra al prompt
CONTEXT_KEYS = {
    "semana_au", "acwr", "acwr_provisional", "dias_historial_carga", "monotonia",
    "recuperacion", "peso_kg", "dias_desde_ultimo_peso", "pesaje",
}
# Formatos de imagen que acepta la API de Anthropic
MEDIA_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp", "GIF": "image/gif"}
FORMATOS_ACEPTADOS_TXT = "JPG, PNG, WebP o GIF"

# --- Cuota diaria por usuario (protección de coste) ---
# Configurable por entorno. No viven en settings.py (paquete A) para no tocar
# archivos fuera de backend/ai/*; ver el informe de la tarea para la nota de
# coordinación. Un valor <= 0 desactiva el límite para ese uso.
AI_DAILY_QUOTA_CHAT = int(os.environ.get("AI_DAILY_QUOTA_CHAT", "50"))
AI_DAILY_QUOTA_FOOD = int(os.environ.get("AI_DAILY_QUOTA_FOOD", "20"))
_QUOTA_CACHE_TIMEOUT = 60 * 60 * 26  # algo más de un día: no depende de un reinicio a medianoche exacta


def _quota_key(*, user_id: int, kind: str) -> str:
    return f"ai:quota:{kind}:{user_id}:{timezone.localdate().isoformat()}"


def _within_daily_quota(*, user_id: int, kind: str, limit: int) -> bool:
    """Dice si el usuario sigue dentro de su cuota diaria, sin consumirla.

    No incrementa el contador: solo lo consulta. El incremento real ocurre en
    ``_consume_daily_quota`` una vez la llamada a la IA ha tenido éxito, para
    no gastar cupo legítimo cuando el fallo es del proveedor (IA no
    configurada, rate limit transitorio, error del SDK) y no del usuario.
    """
    if limit <= 0:
        return True
    count = cache.get(_quota_key(user_id=user_id, kind=kind), 0)
    return count < limit


def _consume_daily_quota(*, user_id: int, kind: str, limit: int) -> None:
    """Incrementa en caché el contador diario del usuario tras una llamada con éxito.

    La clave incluye la fecha, así que cada día es una cuota nueva sin
    necesidad de un cron de limpieza.
    """
    if limit <= 0:
        return
    key = _quota_key(user_id=user_id, kind=kind)
    cache.add(key, 0, timeout=_QUOTA_CACHE_TIMEOUT)
    cache.incr(key)


class LiveScopedRateThrottle(ScopedRateThrottle):
    """``ScopedRateThrottle`` que relee la tasa de los settings en cada petición.

    ``ScopedRateThrottle.THROTTLE_RATES`` se congela como atributo de clase al
    importar ``rest_framework.throttling`` (lee ``DEFAULT_THROTTLE_RATES`` una
    sola vez), así que un scope añadido más tarde a ``settings.py`` (paquete A)
    no se vería nunca si usáramos la clase base tal cual. Aquí lo leemos en
    caliente (``self.scope`` ya lo rellena ``ScopedRateThrottle.allow_request``
    a partir de ``view.throttle_scope``) y, si el scope todavía no está
    configurado, no bloqueamos la beta por eso: la cuota diaria
    (``_within_daily_quota`` / ``_consume_daily_quota``) sigue siendo la
    protección real de coste mientras tanto.
    """

    def get_rate(self):
        from django.conf import settings as dj_settings

        rates = (getattr(dj_settings, "REST_FRAMEWORK", None) or {}).get("DEFAULT_THROTTLE_RATES", {})
        return rates.get(self.scope)


class CoachChatView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [LiveScopedRateThrottle]
    throttle_scope = "ai-chat"

    def post(self, request):
        messages = request.data.get("messages")
        context = request.data.get("context") or {}
        if not isinstance(messages, list) or not messages or len(messages) > MAX_MESSAGES:
            return Response({"detail": "Formato de mensajes inválido."}, status=status.HTTP_400_BAD_REQUEST)
        for m in messages:
            if (
                not isinstance(m, dict)
                or m.get("role") not in ("user", "assistant")
                or not isinstance(m.get("content"), str)
                or len(m["content"]) > MAX_MESSAGE_CHARS
            ):
                return Response({"detail": "Formato de mensajes inválido."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(context, dict):
            return Response({"detail": "Contexto inválido."}, status=status.HTTP_400_BAD_REQUEST)
        context = {k: v for k, v in context.items() if k in CONTEXT_KEYS}
        if len(json.dumps(context)) > MAX_CONTEXT_CHARS:
            return Response({"detail": "Contexto demasiado grande."}, status=status.HTTP_400_BAD_REQUEST)

        if not _within_daily_quota(user_id=request.user.id, kind="chat", limit=AI_DAILY_QUOTA_CHAT):
            return Response(
                {
                    "detail": (
                        f"Has alcanzado tu límite diario de {AI_DAILY_QUOTA_CHAT} mensajes al coach. "
                        "Vuelve a intentarlo mañana."
                    )
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            reply = services.coach_chat(messages=messages, context=context)
        except services.AIUnavailable:
            return Response({"detail": "IA no configurada."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except services.AIBadResponse:
            return Response({"detail": "La IA no devolvió una respuesta válida."}, status=status.HTTP_502_BAD_GATEWAY)
        except anthropic.RateLimitError:
            return Response(
                {"detail": "El coach está saturado ahora mismo. Inténtalo de nuevo en unos minutos."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except anthropic.APIError as exc:
            logger.exception("Fallo del SDK de Anthropic en el chat del coach: %s", exc)
            return Response({"detail": "Error del servicio de IA."}, status=status.HTTP_502_BAD_GATEWAY)
        _consume_daily_quota(user_id=request.user.id, kind="chat", limit=AI_DAILY_QUOTA_CHAT)
        return Response({"reply": reply})


class FoodPhotoView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [LiveScopedRateThrottle]
    throttle_scope = "ai-food"

    def post(self, request):
        image = request.FILES.get("image")
        if image is None:
            return Response({"detail": "Falta el archivo 'image'."}, status=status.HTTP_400_BAD_REQUEST)
        if image.size > MAX_PHOTO_BYTES:
            return Response({"detail": "La imagen supera los 4 MB."}, status=status.HTTP_400_BAD_REQUEST)

        # Comprueba la cuota ANTES de decodificar/recodificar con Pillow (CPU):
        # una petición que ya ha agotado su cupo no debe pagar ese coste.
        if not _within_daily_quota(user_id=request.user.id, kind="food", limit=AI_DAILY_QUOTA_FOOD):
            return Response(
                {
                    "detail": (
                        f"Has alcanzado tu límite diario de {AI_DAILY_QUOTA_FOOD} fotos de comida analizadas. "
                        "Vuelve a intentarlo mañana."
                    )
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Valida el CONTENIDO (no solo la extensión), saca el formato real y
        # redimensiona/recodifica a JPEG con el lado largo acotado antes de
        # mandarla a la IA: load() decodifica entera (caza imágenes truncadas;
        # verify() es no-op en algunos formatos) y activa el límite anti
        # decompression-bomb de Pillow.
        try:
            from PIL import Image, ImageOps

            with Image.open(image) as img:
                img.load()
                fmt = img.format
                if MEDIA_TYPES.get(fmt or "") is None:
                    return Response(
                        {"detail": f"Formato no soportado: usa {FORMATOS_ACEPTADOS_TXT}."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                img = ImageOps.exif_transpose(img) or img
                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")
                img.thumbnail((MAX_PHOTO_LONG_SIDE, MAX_PHOTO_LONG_SIDE), Image.LANCZOS)
                buf = BytesIO()
                img.save(buf, format="JPEG", quality=87)
                photo_bytes = buf.getvalue()
        except Exception:
            return Response({"detail": "El archivo no es una imagen válida."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            result = services.food_photo_analyze(image_bytes=photo_bytes, media_type="image/jpeg")
        except services.AIUnavailable:
            return Response({"detail": "IA no configurada."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except services.AIBadResponse:
            return Response({"detail": "La IA no devolvió un análisis válido."}, status=status.HTTP_502_BAD_GATEWAY)
        except anthropic.RateLimitError:
            return Response(
                {"detail": "El análisis de fotos está saturado ahora mismo. Inténtalo de nuevo en unos minutos."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except anthropic.APIError as exc:
            logger.exception("Fallo del SDK de Anthropic en el análisis de comida: %s", exc)
            return Response({"detail": "Error del servicio de IA."}, status=status.HTTP_502_BAD_GATEWAY)
        _consume_daily_quota(user_id=request.user.id, kind="food", limit=AI_DAILY_QUOTA_FOOD)
        return Response(result)
