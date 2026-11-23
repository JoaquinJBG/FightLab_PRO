"""`/coach/today` (F11): la pantalla "Hoy", el parte rápido de ParteDiario. Solo usuarios
autenticados; cada escritura devuelve el día entero, para que la pantalla no pida otra vez."""
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import checkin, today as days
from .checkin_views import _day, _errors
from .safety_views import _today


def _body(request) -> dict:
    return dict(request.data) if hasattr(request.data, "items") else {}


def _error(exc: days.TodayError) -> Response:
    return Response({"code": exc.code, **exc.params}, status=exc.http)


class TodayView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = _today(request.user.profile)
        try:
            day = _day(request, today, request.query_params)
            days.check_day(day, today)
        except DjangoValidationError as exc:
            return Response(_errors(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(days.today_data(request.user, day, today))

    def post(self, request):
        user = request.user
        today = _today(user.profile)
        data = _body(request)
        try:
            day = _day(request, today, data)
            days.save_day(user, day, today, {k: v for k, v in data.items() if k != "date"})
        except DjangoValidationError as exc:
            return Response(_errors(exc), status=status.HTTP_400_BAD_REQUEST)
        except checkin.CheckinRefused as exc:
            return Response({"code": exc.code, "fields": exc.fields}, status=status.HTTP_403_FORBIDDEN)
        return Response(days.today_data(user, day, today))


class TodayMealView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request):
        user = request.user
        today = _today(user.profile)
        data = _body(request)
        try:
            day = _day(request, today, data)
            days.save_meal(user, day, today, str(data.get("meal") or ""), data.get("state"), str(data.get("change") or ""))
        except DjangoValidationError as exc:
            return Response(_errors(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(days.today_data(user, day, today))


class TodayCardioView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        today = _today(user.profile)
        data = _body(request)
        try:
            day = _day(request, today, data)
            days.add_cardio(user, day, today, data.get("type"), data.get("minutes"), data.get("intensity"))
        except DjangoValidationError as exc:
            return Response(_errors(exc), status=status.HTTP_400_BAD_REQUEST)
        except days.TodayError as exc:
            return _error(exc)
        return Response(days.today_data(user, day, today), status=status.HTTP_201_CREATED)


class TodayCardioDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        user = request.user
        today = _today(user.profile)
        try:
            day = _day(request, today, request.query_params)
            days.check_day(day, today)
            days.delete_cardio(user, pk)
        except DjangoValidationError as exc:
            return Response(_errors(exc), status=status.HTTP_400_BAD_REQUEST)
        except days.TodayError as exc:
            return _error(exc)
        return Response(days.today_data(user, day, today))
