from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import selectors, services
from .models import BiometricsLog, ProgressPhoto
from .serializers import BiometricsSerializer, ProfileSerializer, ProgressPhotoSerializer


class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = selectors.profile_get(user=request.user)
        return Response(ProfileSerializer(profile).data)

    def patch(self, request):
        serializer = ProfileSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        profile = services.profile_update(user=request.user, **serializer.validated_data)
        return Response(ProfileSerializer(profile).data)


class BiometricsListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        logs = selectors.biometrics_list(user=request.user)
        return Response(BiometricsSerializer(logs, many=True).data)

    def post(self, request):
        serializer = BiometricsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
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


MAX_PHOTO_BYTES = 8 * 1024 * 1024  # 8 MB


class PhotoListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        photos = request.user.profile.photos.all()
        return Response(ProgressPhotoSerializer(photos, many=True).data)

    def post(self, request):
        image = request.FILES.get("image")
        if image is None:
            return Response({"detail": "Falta el archivo 'image'."}, status=status.HTTP_400_BAD_REQUEST)
        if image.size > MAX_PHOTO_BYTES:
            return Response({"detail": "La imagen supera los 8 MB."}, status=status.HTTP_400_BAD_REQUEST)
        # Valida el CONTENIDO (no solo la extensión): nada de archivos disfrazados
        try:
            from PIL import Image

            Image.open(image).verify()
        except Exception:
            return Response({"detail": "El archivo no es una imagen válida."}, status=status.HTTP_400_BAD_REQUEST)
        image.seek(0)  # verify() consume el stream
        from django.utils import timezone

        photo = ProgressPhoto(
            profile=request.user.profile,
            image=image,
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
        photo = get_object_or_404(ProgressPhoto, pk=pk, profile=request.user.profile)
        photo.image.delete(save=False)  # borra también el archivo
        photo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
