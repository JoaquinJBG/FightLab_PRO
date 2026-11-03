"""`GET/POST /coach/review`, `POST /coach/review/<id>/accept` y `GET /coach/knowledge/stale`
(fase 7).

- `GET`: la última revisión, la fecha por defecto y las 6 señales del formulario. Solo el admin
  recibe `stale` (evidencia antigua, Task 7.4); el atleta nunca.
- `POST`: genera la revisión de la semana que acaba en `week_end` con las señales marcadas. Sin
  cribado, `409 profile_incomplete`.
- `POST …/accept`: acepta las propuestas (`calories`, `deload`) y, con algún cambio, genera un
  `WeeklyPlan` nuevo con el generador de la fase 6.
"""
from rest_framework import serializers, status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.messages import msg

from . import checkin
from . import review as reviews
from .models import WeeklyReview
from .plan_narrative import write_narrative
from .review_narrative import write_review_narrative
from .safety_views import _lang, _today
from .targets import reasons_data


class ReviewRequestSerializer(serializers.Serializer):
    week_end = serializers.DateField(required=False)
    signs = serializers.ListField(child=serializers.ChoiceField(list(reviews.SIGNS)), required=False, max_length=6)


class AcceptSerializer(serializers.Serializer):
    accept = serializers.ListField(child=serializers.ChoiceField(list(reviews.PROPOSAL_KINDS)), max_length=2)


class IsCoachAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and reviews.is_admin(request.user))


def _invalid(exc: reviews.ReviewInvalid) -> Response:
    return Response({"code": exc.code, "detail": msg(f"review_{exc.code}")}, status=status.HTTP_400_BAD_REQUEST)


class ReviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user, lang = request.user, _lang()
        today = _today(user.profile)
        last = reviews.latest(user)
        data = {
            "today": today.isoformat(),
            "week_end": reviews.default_week_end(today).isoformat(),
            "max_past_days": reviews.MAX_PAST_DAYS,
            "signs": list(reviews.SIGNS),
            "latest": reviews.review_data(last, lang) if last else None,
            "imported": reviews.imported_data(user, checkin.weight_tracking_blocked(user, today)),
        }
        if reviews.is_admin(user):
            data["stale"] = reviews.stale_knowledge(today)
        return Response(data)

    def post(self, request):
        serializer = ReviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, lang = request.user, _lang()
        today = _today(user.profile)
        data = serializer.validated_data
        try:
            review = reviews.generate(
                user, today, data.get("week_end") or reviews.default_week_end(today), set(data.get("signs", [])),
                lang, narrate=write_review_narrative,
            )
        except reviews.ReviewInvalid as exc:
            return _invalid(exc)
        return Response(reviews.review_data(review, lang), status=status.HTTP_201_CREATED)


class ReviewAcceptView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        review = get_object_or_404(WeeklyReview, pk=pk, profile=request.user.profile)
        serializer = AcceptSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lang = _lang()
        try:
            review = reviews.accept(
                request.user, review, serializer.validated_data["accept"], _today(request.user.profile), lang,
                narrate=write_narrative,
            )
        except reviews.ReviewInvalid as exc:
            return _invalid(exc)
        except reviews.ReviewConflict as exc:
            return Response({"code": exc.code, "reasons": reasons_data(exc.reasons, lang)}, status=status.HTTP_409_CONFLICT)
        return Response(reviews.review_data(review, lang))


class KnowledgeStaleView(APIView):
    """`GET /coach/knowledge/stale`: evidencia antigua (`coach knowledge stale`). Solo el admin."""

    permission_classes = [IsCoachAdmin]

    def get(self, request):
        return Response(reviews.stale_knowledge(_today(request.user.profile)))
