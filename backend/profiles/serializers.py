from django.core.validators import MaxValueValidator, MinValueValidator
from rest_framework import serializers

from .models import BiometricsLog, UserProfile


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
            "sleep_quality_score", "hrv_ms", "timestamp", "source",
            "external_id", "raw_payload",
        )
        read_only_fields = ("id",)
        extra_kwargs = {"timestamp": {"required": False}}
