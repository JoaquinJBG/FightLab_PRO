from rest_framework import serializers

from .services import MAX_BULK_ITEMS


class StatePutSerializer(serializers.Serializer):
    value = serializers.JSONField()
    updated_at = serializers.CharField(required=False, allow_null=True, allow_blank=True)


class BulkStateItemSerializer(serializers.Serializer):
    key = serializers.CharField()
    value = serializers.JSONField()
    updated_at = serializers.CharField(required=False, allow_null=True, allow_blank=True)


class BulkStatePutSerializer(serializers.Serializer):
    items = BulkStateItemSerializer(many=True, allow_empty=False)

    def validate_items(self, items):
        if len(items) > MAX_BULK_ITEMS:
            raise serializers.ValidationError(f"Máximo {MAX_BULK_ITEMS} items por petición.")
        return items
