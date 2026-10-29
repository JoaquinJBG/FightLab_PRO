"""`GET /coach/targets` y `GET /coach/zones` (Tasks 4.1 y 4.2). Solo usuarios autenticados.

Los números salen del motor en el servidor (`coaching.targets`); el frontend nunca decide.
Un dato que falta es `409 {"code": "profile_incomplete", "field": …}` (manejador común).
"""
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import targets
from .safety_views import _lang, _today


class TargetsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(targets.targets_data(request.user, _today(request.user.profile), _lang()))


class ZonesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(targets.zones_data(request.user, _today(request.user.profile), _lang()))
