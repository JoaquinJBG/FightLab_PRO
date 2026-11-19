from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404, HttpResponse
from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.messages import msg

from . import selectors, services
from .constants import MAX_PHOTOS_PER_USER
from .image_processing import process_progress_photo
from .models import BiometricsLog, ProgressPhoto
from .serializers import BiometricsSerializer, ProfileSerializer, ProgressPhotoSerializer


class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def _payload(self, request, profile):
        # Los datos de pesaje no salen si `no_weight_targets` lo bloquea (spec §8.3).
        from coaching import weigh_in
        from coaching.safety_views import _today

        return weigh_in.hide_if_blocked(request.user, _today(profile), ProfileSerializer(profile).data)

    def get(self, request):
        profile = selectors.profile_get(user=request.user)
        return Response(self._payload(request, profile))

    def patch(self, request):
        from coaching import weigh_in
        from coaching.safety_views import _today

        serializer = ProfileSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        refused = weigh_in.check_write(request.user, _today(request.user.profile), serializer.validated_data)
        if refused:
            return Response(refused[1], status=refused[0])
        profile = services.profile_update(user=request.user, **serializer.validated_data)
        return Response(self._payload(request, profile))


# Lo que el motor no registra con `no_weight_targets` (peso, grasa y perímetros). La FC en reposo,
# la VFC y el sueño sí.
BODY_FIELDS = (
    "weight_kg", "body_fat_pct", "waist_cm", "hip_cm", "chest_cm", "arm_cm", "thigh_cm", "neck_cm",
)


class BiometricsListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        logs = selectors.biometrics_list(user=request.user)
        data = BiometricsSerializer(logs, many=True).data
        from coaching import checkin
        from coaching.safety_views import _today

        # Con `no_weight_targets` el servidor no devuelve datos corporales (spec §8.3).
        if checkin.weight_tracking_blocked(request.user, _today(request.user.profile)):
            data = [{**row, **dict.fromkeys(BODY_FIELDS)} for row in data]
        return Response(data)

    def post(self, request):
        serializer = BiometricsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Con `no_weight_targets` el servidor no guarda datos corporales (spec §8.3).
        from coaching import checkin
        from coaching.safety_views import _today

        body = [n for n in BODY_FIELDS if serializer.validated_data.get(n) is not None]
        if body and checkin.weight_tracking_blocked(request.user, _today(request.user.profile)):
            return Response({"code": "weight_targets_blocked", "fields": body}, status=status.HTTP_403_FORBIDDEN)
        try:
            log = services.biometrics_create(user=request.user, **serializer.validated_data)
        except DjangoValidationError as exc:
            return Response(
                {"detail": exc.message_dict if hasattr(exc, "message_dict") else exc.messages},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(BiometricsSerializer(log).data, status=status.HTTP_201_CREATED)


class BiometricsDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        log = get_object_or_404(BiometricsLog, pk=pk, profile=request.user.profile)
        log.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# Límite de subida cruda (antes de procesar). El cliente ya comprime con
# compress-image.ts a <1.5 MB / lado <=2048px, así que esto es margen extra
# más que el tamaño final: el servidor siempre reprocesa a <=1600px / ~500 KB.
MAX_PHOTO_BYTES = 6 * 1024 * 1024  # 6 MB


class PhotoListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # `.defer("data")`: el listado solo usa id/file_url/taken_at, así que
        # no hace falta traer de Postgres el binario (~500 KB) de cada foto.
        # `.exclude(data=b"")` descarta las fotos "vacías" que puede haber
        # dejado el backfill de 0004 (sin archivo recuperable): mostrarlas
        # daría una miniatura rota, porque su /file da 404.
        photos = request.user.profile.photos.exclude(data=b"").defer("data")
        return Response(ProgressPhotoSerializer(photos, many=True).data)

    def post(self, request):
        image = request.FILES.get("image")
        if image is None:
            return Response({"detail": msg("image_missing")}, status=status.HTTP_400_BAD_REQUEST)
        if request.user.profile.photos.count() >= MAX_PHOTOS_PER_USER:
            return Response(
                {"detail": msg("photos_max", n=MAX_PHOTOS_PER_USER)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if image.size > MAX_PHOTO_BYTES:
            return Response({"detail": msg("image_too_large", mb=MAX_PHOTO_BYTES // (1024 * 1024))}, status=status.HTTP_400_BAD_REQUEST)
        # process_progress_photo valida el CONTENIDO real (no solo la extensión)
        # al abrirlo con Pillow: nada de archivos disfrazados.
        try:
            data, content_type, width, height = process_progress_photo(image)
        except Exception:
            return Response({"detail": msg("image_invalid")}, status=status.HTTP_400_BAD_REQUEST)

        from django.utils import timezone

        photo = ProgressPhoto(
            profile=request.user.profile,
            data=data,
            content_type=content_type,
            width=width,
            height=height,
            taken_at=request.data.get("taken_at") or timezone.localdate(),
        )
        try:
            photo.full_clean()
        except DjangoValidationError as exc:
            return Response(
                {"detail": exc.message_dict if hasattr(exc, "message_dict") else exc.messages},
                status=status.HTTP_400_BAD_REQUEST,
            )
        photo.save()
        return Response(ProgressPhotoSerializer(photo).data, status=status.HTTP_201_CREATED)


class PhotoDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        # `.defer("data")`: borrar no necesita traer el binario a memoria.
        photo = get_object_or_404(
            ProgressPhoto.objects.defer("data"), pk=pk, profile=request.user.profile
        )
        photo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PhotoFileView(APIView):
    """Sirve el binario de la foto. Aislado por `profile`: la de otro usuario
    da 404 (no 403, para no confirmar que el id existe); sin token, 401."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        photo = get_object_or_404(ProgressPhoto, pk=pk, profile=request.user.profile)
        if not photo.data:
            raise Http404
        response = HttpResponse(bytes(photo.data), content_type=photo.content_type)
        response["Cache-Control"] = "private, max-age=3600"
        return response
