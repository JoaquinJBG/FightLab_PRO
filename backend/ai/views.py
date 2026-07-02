import json

import anthropic
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services

MAX_PHOTO_BYTES = 8 * 1024 * 1024  # 8 MB
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


class CoachChatView(APIView):
    permission_classes = [IsAuthenticated]

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

        try:
            reply = services.coach_chat(messages=messages, context=context)
        except services.AIUnavailable:
            return Response({"detail": "IA no configurada."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except services.AIBadResponse:
            return Response({"detail": "La IA no devolvió una respuesta válida."}, status=status.HTTP_502_BAD_GATEWAY)
        except anthropic.APIError:
            return Response({"detail": "Error del servicio de IA."}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({"reply": reply})


class FoodPhotoView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        image = request.FILES.get("image")
        if image is None:
            return Response({"detail": "Falta el archivo 'image'."}, status=status.HTTP_400_BAD_REQUEST)
        if image.size > MAX_PHOTO_BYTES:
            return Response({"detail": "La imagen supera los 8 MB."}, status=status.HTTP_400_BAD_REQUEST)
        # Valida el CONTENIDO (no solo la extensión) y saca el formato real.
        # load() decodifica entera: caza imágenes truncadas (verify() es no-op en
        # algunos formatos) y activa el límite anti decompression-bomb de Pillow.
        try:
            from PIL import Image

            with Image.open(image) as img:
                img.load()
                fmt = img.format
        except Exception:
            return Response({"detail": "El archivo no es una imagen válida."}, status=status.HTTP_400_BAD_REQUEST)
        media_type = MEDIA_TYPES.get(fmt or "")
        if media_type is None:
            return Response({"detail": "Formato no soportado: usa JPG, PNG o WebP."}, status=status.HTTP_400_BAD_REQUEST)
        image.seek(0)  # verify() consume el stream

        try:
            result = services.food_photo_analyze(image_bytes=image.read(), media_type=media_type)
        except services.AIUnavailable:
            return Response({"detail": "IA no configurada."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except services.AIBadResponse:
            return Response({"detail": "La IA no devolvió un análisis válido."}, status=status.HTTP_502_BAD_GATEWAY)
        except anthropic.APIError:
            return Response({"detail": "Error del servicio de IA."}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(result)
