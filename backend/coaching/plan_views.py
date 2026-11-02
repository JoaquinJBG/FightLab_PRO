"""`GET/POST /coach/plan` y `POST /coach/plan/<id>/apply` (Tasks 6.4 y 6.5).

- `GET`: el plan activo (Mi rutina), el borrador de la semana y los días por defecto. Con
  `no_training` responde `blocked` con sus motivos y sin días.
- `POST`: genera un borrador por reglas (`coaching.plan`). Con `no_training`, `409
  {"code": "no_training", "reasons": …}`; sin cribado, `409 profile_incomplete`.
- `POST …/apply`: "Aplicar" lo pasa a Mi rutina.
"""
from rest_framework import serializers, status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.messages import msg

from . import plan as plans
from .models import WeeklyPlan
from .plan_narrative import write_narrative
from .safety_views import _lang, _today
from .targets import reasons_data

DAY_CHOICES = list(plans.DAYS)
TIME_RE = r"^([01]\d|2[0-3]):[0-5]\d$"


class PlanRequestSerializer(serializers.Serializer):
    gym_days = serializers.ListField(child=serializers.ChoiceField(DAY_CHOICES), required=False, max_length=7)
    mma_days = serializers.ListField(child=serializers.ChoiceField(DAY_CHOICES), required=False, max_length=7)
    cardio_days = serializers.ListField(child=serializers.ChoiceField(DAY_CHOICES), required=False, max_length=7)
    times = serializers.DictField(child=serializers.RegexField(TIME_RE), required=False)

    def validate_times(self, value):
        if set(value) - set(DAY_CHOICES):
            raise serializers.ValidationError("mon..sun")
        return value


def _blocked(exc: plans.PlanBlocked, lang: str) -> dict:
    return {"code": "no_training", "reasons": reasons_data(exc.reasons, lang)}


class PlanView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user, lang = request.user, _lang()
        today = _today(user.profile)
        week = plans.week_start_for(today)
        active = WeeklyPlan.objects.filter(profile=user.profile, status=WeeklyPlan.Status.ACTIVE).first()
        draft = WeeklyPlan.objects.filter(profile=user.profile, status=WeeklyPlan.Status.DRAFT, week_start=week).first()
        try:
            plans.check_trainable(user, today)
            blocked, days = None, plans.defaults(user, today)
        except plans.PlanBlocked as exc:
            blocked, days = _blocked(exc, lang), None
        return Response({
            "week_start": week.isoformat(),
            "active": plans.plan_data(active, lang) if active else None,
            "draft": plans.plan_data(draft, lang) if draft else None,
            "defaults": days,
            "blocked": blocked,
        })

    def post(self, request):
        serializer = PlanRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, lang = request.user, _lang()
        try:
            plan = plans.generate(
                user, _today(user.profile), plans.PlanRequest(**serializer.validated_data), lang, narrate=write_narrative
            )
        except plans.PlanBlocked as exc:
            return Response(_blocked(exc, lang), status=status.HTTP_409_CONFLICT)
        except plans.PlanInvalid as exc:
            return Response({"code": exc.code, "detail": msg(f"plan_{exc.code}")}, status=status.HTTP_400_BAD_REQUEST)
        return Response(plans.plan_data(plan, lang), status=status.HTTP_201_CREATED)


class PlanApplyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        plan = get_object_or_404(WeeklyPlan, pk=pk, profile=request.user.profile)
        if plan.status == WeeklyPlan.Status.SUPERSEDED:
            return Response({"code": "superseded"}, status=status.HTTP_409_CONFLICT)
        try:
            plan = plans.apply(request.user, plan, _today(request.user.profile))
        except plans.PlanBlocked as exc:
            return Response(_blocked(exc, _lang()), status=status.HTTP_409_CONFLICT)
        return Response(plans.plan_data(plan, _lang()))
