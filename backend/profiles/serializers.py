from django.core.validators import MaxValueValidator, MinValueValidator
from django.urls import reverse
from rest_framework import serializers

from .models import BiometricsLog, ProgressPhoto, UserProfile


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = (
            "date_of_birth", "gender", "height_cm",
            "dominant_stance", "preferred_units", "timezone",
        )


class BiometricsSerializer(serializers.ModelSerializer):
    sleep_quality_score = serializers.IntegerField(
        required=False,
        allow_null=True,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
    )

    class Meta:
        model = BiometricsLog
        fields = (
            "id", "weight_kg", "body_fat_pct", "resting_heart_rate",
            "sleep_quality_score", "hrv_ms",
            "waist_cm", "hip_cm", "chest_cm", "arm_cm", "thigh_cm", "neck_cm",
            "timestamp", "source", "external_id", "raw_payload",
        )
        read_only_fields = ("id",)
        extra_kwargs = {"timestamp": {"required": False}}


class ProgressPhotoSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = ProgressPhoto
        fields = ("id", "file_url", "taken_at")

    def get_file_url(self, obj) -> str:
        # Ruta relativa a la API (incluye /api/v1, sin dominio): el frontend la
        # pide a través de /api/proxy, que reenvía binarios (paquete D).
        return reverse("photos-file", args=[obj.pk])
