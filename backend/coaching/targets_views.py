"""`GET /coach/targets`, `GET /coach/zones` y `/coach/weigh-in` (Tasks 4.1, 4.2 y 4.4). Solo
usuarios autenticados.

Los números salen del motor en el servidor (`coaching.targets`); el frontend nunca decide.
Un dato que falta es `409 {"code": "profile_incomplete", "field": …}` (manejador común).
"""
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import targets, weigh_in
from .safety_views import _lang, _today


class TargetsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(targets.targets_data(request.user, _today(request.user.profile), _lang()))


class ZonesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(targets.zones_data(request.user, _today(request.user.profile), _lang()))


class WeighInSerializer(serializers.Serializer):
    goal_weight_kg = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=weigh_in.MIN_GOAL_KG, max_value=weigh_in.MAX_GOAL_KG
    )
    weigh_in_at = serializers.DateTimeField()
    weight_class = serializers.CharField(max_length=60, required=False, allow_null=True, allow_blank=True)


class WeighInView(APIView):
    """`GET/PUT/DELETE /coach/weigh-in`: peso objetivo, fecha del pesaje y categoría, con la
    cuenta atrás y la distancia calculadas en el servidor y los bloqueos de la spec §8.3."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(weigh_in.weigh_in_data(request.user, _today(request.user.profile), _lang()))

    def put(self, request):
        serializer = WeighInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        today = _today(request.user.profile)
        refused = weigh_in.check_write(request.user, today, data)
        if refused:
            return Response(refused[1], status=refused[0])
        weigh_in.weigh_in_save(request.user, data["goal_weight_kg"], data["weigh_in_at"], data.get("weight_class"))
        return Response(weigh_in.weigh_in_data(request.user, today, _lang()))

    def delete(self, request):
        weigh_in.weigh_in_clear(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
