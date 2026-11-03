"""`GET /coach/strength/e1rm`, `/coach/strength/sets` y `/coach/strength/progress` (Task 6.2).

Los números salen de `coach.strength` en el servidor (`coaching.strength`); el frontend nunca
decide. La progresión aplica los flags de seguridad (`no_training`, `hold_progression`, pausas).
"""
from datetime import date

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import strength
from .safety_views import _lang, _today


class StrengthE1rmView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(strength.e1rm_data(request.user, _today(request.user.profile), _lang()))


class StrengthSetsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        raw = request.query_params.get("week_ending")
        try:
            week_ending = date.fromisoformat(raw) if raw else None
        except ValueError:
            return Response({"week_ending": ["YYYY-MM-DD"]}, status=status.HTTP_400_BAD_REQUEST)
        today = _today(request.user.profile)
        return Response(strength.sets_data(request.user, today, _lang(), week_ending))


class StrengthProgressView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        exercise = request.query_params.get("exercise") or None
        today = _today(request.user.profile)
        return Response(strength.progress_data(request.user, today, _lang(), exercise))
