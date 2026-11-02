"""`GET/POST /coach/checkin` (Tasks 5.1-5.5). Solo usuarios autenticados.

Un solo formulario matinal: bienestar, peso, cintura, kcal, sueño, notas, señales de alarma y
las preguntas semanales. El servidor decide qué se acepta (`no_weight_targets`) y qué efecto
tiene cada respuesta sobre `Screening` e `Injury`; el frontend solo pinta lo que recibe.
"""
from datetime import date

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import checkin
from .safety_views import _today


def _day(request, today: date, source) -> date:
    raw = source.get("date")
    if not raw:
        return today
    try:
        return date.fromisoformat(str(raw))
    except ValueError:
        raise DjangoValidationError({"date": "expected YYYY-MM-DD"}) from None


def _errors(exc: DjangoValidationError):
    return exc.message_dict if hasattr(exc, "message_dict") else {"detail": exc.messages}


def payload(user, day: date, today: date) -> dict:
    return {
        "date": day.isoformat(),
        "checkin": checkin.checkin_data(user, day, today),
        "weight_blocked": checkin.weight_tracking_blocked(user, today),
    }


class CheckinView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = _today(request.user.profile)
        try:
            day = _day(request, today, request.query_params)
        except DjangoValidationError as exc:
            return Response(_errors(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(payload(request.user, day, today))

    def post(self, request):
        today = _today(request.user.profile)
        data = dict(request.data) if hasattr(request.data, "items") else {}
        try:
            day = _day(request, today, data)
            values = {k: v for k, v in data.items() if k != "date"}
            checkin.checkin_upsert(request.user, day, values, today)
        except DjangoValidationError as exc:
            return Response(_errors(exc), status=status.HTTP_400_BAD_REQUEST)
        except checkin.CheckinRefused as exc:
            return Response({"code": exc.code, "fields": exc.fields}, status=status.HTTP_403_FORBIDDEN)
        return Response(payload(request.user, day, today))
