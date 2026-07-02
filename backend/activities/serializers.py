import json
from datetime import datetime, timedelta, timezone as dt_timezone

from django.utils import timezone
from rest_framework import serializers

from .models import Activity

MAX_DETAIL_CHARS = 8_192
MAX_NOTE_CHARS = 2_000
STARTED_AT_FLOOR = datetime(2020, 1, 1, tzinfo=dt_timezone.utc)
FUTURE_SKEW = timedelta(minutes=10)


class ActivitySerializer(serializers.ModelSerializer):
    load_au = serializers.IntegerField(read_only=True)
    client_id = serializers.CharField(source="external_id", read_only=True)

    class Meta:
        model = Activity
        fields = (
            "id", "client_id", "kind", "title", "started_at", "duration_sec",
            "rpe", "kcal", "note", "detail", "load_au", "source", "created_at",
        )


class SyncItemSerializer(serializers.Serializer):
    """Item de ingesta idempotente. La validación es POR ITEM: un item inválido
    no debe envenenar el lote (contrato con la cola offline del cliente)."""

    client_id = serializers.CharField(min_length=8, max_length=128, trim_whitespace=True)
    kind = serializers.ChoiceField(choices=Activity.Kind.choices)
    title = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    started_at = serializers.DateTimeField()
    duration_sec = serializers.IntegerField(min_value=1, max_value=86_400)
    rpe = serializers.IntegerField(min_value=1, max_value=10, required=False, allow_null=True, default=None)
    kcal = serializers.IntegerField(min_value=0, max_value=20_000, required=False, allow_null=True, default=None)
    note = serializers.CharField(max_length=MAX_NOTE_CHARS, required=False, allow_blank=True, default="")
    detail = serializers.JSONField(required=False, allow_null=True, default=None)

    def validate_started_at(self, value):
        if value < STARTED_AT_FLOOR:
            raise serializers.ValidationError("Fecha demasiado antigua.")
        if value > timezone.now() + FUTURE_SKEW:
            raise serializers.ValidationError("Fecha en el futuro.")
        return value

    def validate_detail(self, value):
        # Misma medida que JSON.stringify en el cliente (compacto, sin escapar
        # acentos): si no, un detail que pasa el pre-check del cliente puede
        # rechazarse aquí y perderse la sesión en silencio
        if value is not None and len(json.dumps(value, separators=(",", ":"), ensure_ascii=False)) > MAX_DETAIL_CHARS:
            raise serializers.ValidationError("detail demasiado grande (máx 8 KB).")
        return value
