import json
import logging
from io import BytesIO

import anthropic
from PIL import Image, UnidentifiedImageError
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from profiles.image_processing import UnsupportedImageError, UnsupportedImageFormatError, load_bounded
from userstate.selectors import state_get_many

from . import quota, services
from .models import AIUsage

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
_PHOTO_FORMATS = frozenset(MEDIA_TYPES)

_PROVIDER_ERRORS = (services.AIUnavailable, services.AIBadResponse, anthropic.APIError)


def _quota_exceeded_response(kind: str) -> Response:
    limit = quota.limit_for(kind)
    if kind == AIUsage.Kind.CHAT:
        detail = f"Has alcanzado tu límite diario de {limit} mensajes al coach. Vuelve a intentarlo mañana."
    else:
        detail = f"Has alcanzado tu límite diario de {limit} fotos de comida analizadas. Vuelve a intentarlo mañana."
    return Response({"detail": detail, "code": "quota_daily"}, status=status.HTTP_429_TOO_MANY_REQUESTS)


def _budget_exceeded_response() -> Response:
    return Response(
        {
            "detail": "Se ha alcanzado el límite diario del servicio de IA. Vuelve a intentarlo mañana.",
            "code": "budget_daily",
        },
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


def _token_recorder(reservation: quota.Reservation):
    def record(input_tokens: int, output_tokens: int) -> None:
        quota.record_tokens(reservation, input_tokens=input_tokens, output_tokens=output_tokens)

    return record


def _provider_error_response(exc: Exception, *, bad_response_detail: str, saturated_detail: str, log_msg: str) -> Response:
    if isinstance(exc, services.AIUnavailable):
        return Response({"detail": "IA no configurada."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    if isinstance(exc, services.AIBadResponse):
        return Response({"detail": bad_response_detail}, status=status.HTTP_502_BAD_GATEWAY)
    if isinstance(exc, anthropic.RateLimitError):
        return Response({"detail": saturated_detail}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    if isinstance(exc, anthropic.APITimeoutError):
        return Response(
            {"detail": "El servicio de IA ha tardado demasiado. Inténtalo de nuevo."},
            status=status.HTTP_504_GATEWAY_TIMEOUT,
        )
    logger.exception("%s: %s", log_msg, exc)
    return Response({"detail": "Error del servicio de IA."}, status=status.HTTP_502_BAD_GATEWAY)


def _coach_memory_for(profile) -> dict:
    """Lee la memoria persistente del coach (P0.3) directamente del servidor.

    Se lee de `UserState` (clave `coach_memory`) en vez de confiar en lo que
    mande el cliente en el cuerpo de la petición: así no depende de que el
    frontend la reenvíe en cada mensaje y no se puede falsear desde el cliente.
    """
    entry = state_get_many(profile=profile, keys=["coach_memory"]).first()
    if entry is None:
        return {}
    return services.sanitize_coach_memory(entry.value)


class LiveScopedRateThrottle(ScopedRateThrottle):
    """``ScopedRateThrottle`` que relee la tasa de los settings en cada petición.

    ``ScopedRateThrottle.THROTTLE_RATES`` se congela como atributo de clase al
    importar ``rest_framework.throttling`` (lee ``DEFAULT_THROTTLE_RATES`` una
    sola vez), así que un scope añadido más tarde a ``settings.py`` (paquete A)
    no se vería nunca si usáramos la clase base tal cual. Aquí lo leemos en
    caliente (``self.scope`` ya lo rellena ``ScopedRateThrottle.allow_request``
    a partir de ``view.throttle_scope``) y, si el scope todavía no está
    configurado, no bloqueamos la beta por eso: la cuota diaria (``ai.quota``,
    tabla ``AIUsage``) sigue siendo la protección real de coste mientras tanto.
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

        user = request.user
        if quota.global_budget_exceeded():
            return _budget_exceeded_response()
        memory = _coach_memory_for(user.profile)

        reservation = quota.reserve(user=user, kind=AIUsage.Kind.CHAT)
        if reservation is None:
            return _quota_exceeded_response(AIUsage.Kind.CHAT)
        try:
            reply = services.coach_chat(
                messages=messages, context=context, memory=memory, on_usage=_token_recorder(reservation)
            )
        except _PROVIDER_ERRORS as exc:
            quota.refund(reservation)
            return _provider_error_response(
                exc,
                bad_response_detail="La IA no devolvió una respuesta válida.",
                saturated_detail="El coach está saturado ahora mismo. Inténtalo de nuevo en unos minutos.",
                log_msg="Fallo del SDK de Anthropic en el chat del coach",
            )
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

        user = request.user
        # Consulta (sin reservar) ANTES de decodificar con Pillow (CPU): una
        # petición que ya ha agotado su cupo no debe pagar ese coste.
        if not quota.has_quota(user=user, kind=AIUsage.Kind.FOOD):
            return _quota_exceeded_response(AIUsage.Kind.FOOD)
        if quota.global_budget_exceeded():
            return _budget_exceeded_response()

        # Valida el CONTENIDO (no solo la extensión): load_bounded rechaza el
        # formato y los píxeles de más leyendo solo la cabecera, y después
        # decodifica ya reducida al lado largo que recomienda Anthropic.
        try:
            img, _ = load_bounded(image, max_side=MAX_PHOTO_LONG_SIDE, formats=_PHOTO_FORMATS)
            buf = BytesIO()
            img.save(buf, format="JPEG", quality=87)
            photo_bytes = buf.getvalue()
        except UnsupportedImageFormatError:
            return Response(
                {"detail": f"Formato no soportado: usa {FORMATOS_ACEPTADOS_TXT}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except UnsupportedImageError:
            return Response(
                {"detail": "La imagen tiene demasiados píxeles: hazle una captura o redúcela."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError, SyntaxError):
            return Response({"detail": "El archivo no es una imagen válida."}, status=status.HTTP_400_BAD_REQUEST)

        reservation = quota.reserve(user=user, kind=AIUsage.Kind.FOOD)
        if reservation is None:
            return _quota_exceeded_response(AIUsage.Kind.FOOD)
        try:
            result = services.food_photo_analyze(
                image_bytes=photo_bytes, media_type="image/jpeg", on_usage=_token_recorder(reservation)
            )
        except _PROVIDER_ERRORS as exc:
            quota.refund(reservation)
            return _provider_error_response(
                exc,
                bad_response_detail="La IA no devolvió un análisis válido. Prueba con otra foto.",
                saturated_detail="El análisis de fotos está saturado ahora mismo. Inténtalo de nuevo en unos minutos.",
                log_msg="Fallo del SDK de Anthropic en el análisis de comida",
            )
        return Response(result)


class QuotaView(APIView):
    """Cupo diario restante de cada uso de IA, para que el cliente lo muestre."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "date": quota.today().isoformat(),
                "coach": quota.status_for(user=request.user, kind=AIUsage.Kind.CHAT),
                "photo": quota.status_for(user=request.user, kind=AIUsage.Kind.FOOD),
            }
        )
