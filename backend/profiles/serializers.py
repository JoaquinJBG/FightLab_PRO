from django.core.validators import MaxValueValidator, MinValueValidator
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
    image = serializers.SerializerMethodField()

    class Meta:
        model = ProgressPhoto
        fields = ("id", "image", "taken_at")

    def get_image(self, obj) -> str:
        # Ruta relativa (/media/...): el frontend la sirve a través de su proxy.
        return obj.image.url
