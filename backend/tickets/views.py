"""API de fotos de tickets (fase 12). Solo el dueño ve, pide la URL firmada o borra un ticket.

- `GET /coach/tickets?plan=<id>`: si la subida está encendida y los tickets (sin URL: se piden aparte).
- `POST /coach/tickets` (multipart: `image`, `taken_on`, `plan`, `note`): sube una foto. Sin R2,
  `503 tickets_not_configured`; más de 2 MB, `413 ticket_too_large`.
- `GET /coach/tickets/<id>/url`: una URL firmada que caduca a los `R2_SIGNED_URL_SECONDS`.
- `DELETE /coach/tickets/<id>`: borra el ticket y su foto de R2.
"""
from django.http import Http404
from rest_framework import serializers, status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from coaching.models import MealPlan
from coaching.safety_views import _today
from core.messages import msg

from . import services
from .models import TicketPhoto


def _error(exc: services.TicketError) -> Response:
    return Response(
        {"code": exc.code, "detail": msg(exc.code, **exc.params), "params": exc.params}, status=exc.http
    )


class UploadSerializer(serializers.Serializer):
    image = serializers.FileField()
    taken_on = serializers.DateField(required=False)
    plan = serializers.IntegerField(required=False, allow_null=True)
    note = serializers.CharField(max_length=services.NOTE_MAX, required=False, allow_blank=True, default="")


def _ticket(request, pk) -> TicketPhoto:
    ticket = TicketPhoto.objects.filter(pk=pk, profile=request.user.profile).first()
    if ticket is None:
        raise Http404
    return ticket


class TicketListView(APIView):
    permission_classes = [IsAuthenticated]

    def get_parsers(self):
        if getattr(self, "request", None) is not None and self.request.method == "POST":
            return [MultiPartParser()]
        return super().get_parsers()

    def get_throttles(self):
        if self.request.method == "POST":
            self.throttle_scope = "tickets-upload"
            return [ScopedRateThrottle()]
        return super().get_throttles()

    def get(self, request):
        plan = request.query_params.get("plan")
        plan_id = int(plan) if plan and plan.isdigit() else None
        return Response(services.list_data(request.user, plan_id))

    def post(self, request):
        serializer = UploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        plan = None
        if d.get("plan"):
            plan = MealPlan.objects.filter(pk=d["plan"], profile=request.user.profile).first()
            if plan is None:
                raise Http404
        today = _today(request.user.profile)
        taken_on = d.get("taken_on") or today
        if taken_on > today:
            return Response({"taken_on": ["cannot be in the future"]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            ticket = services.upload(request.user, d["image"], taken_on, plan, d["note"])
        except services.TicketError as exc:
            return _error(exc)
        return Response(services.ticket_data(ticket), status=status.HTTP_201_CREATED)


class TicketUrlView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            data = services.signed_url(_ticket(request, pk))
        except services.TicketError as exc:
            return _error(exc)
        response = Response(data)
        response["Cache-Control"] = "private, no-store"
        return response


class TicketDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        _ticket(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
