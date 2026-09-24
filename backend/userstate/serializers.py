from rest_framework import serializers


class StatePutSerializer(serializers.Serializer):
    value = serializers.JSONField()
    updated_at = serializers.CharField(required=False, allow_null=True, allow_blank=True)
