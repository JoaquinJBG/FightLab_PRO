"""API de seguridad, cribado y lesiones (spec §8.1, Task 3.4). Solo usuarios autenticados.

Los flags los calcula el motor en el servidor (`services.safety_for`); el frontend nunca
decide. Al cliente le llegan los flags y sus motivos, y del cribado solo sus resultados.
"""
from datetime import date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from coach import profile as coach_profile
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .bridge import reason_texts
from .bridge.adapters import latest_weight
from .bridge.reasons import parse_reason
from .models import Injury, KnowledgeRule, Screening, ScreeningEvent
from .views import request_language

# Los flags de sí/no de `coach.safety.SafetyFlags` que devuelve la API.
BOOL_FLAGS = (
    "no_deficit", "no_weight_targets", "hold_deficit", "use_rpe_not_hr", "prescriber_owns_weight",
    "refer_gp", "no_training", "cap_moderate", "no_calorie_targets", "hold_progression",
    "review_before_vigorous", "no_all_out_sprints",
)


def _lang() -> str:
    lang = request_language()
    return lang if lang in reason_texts.LANGUAGES else reason_texts.DEFAULT_LANGUAGE


def _today(profile) -> date:
    """Hoy en la zona horaria del perfil (la edad cambia el día del cumpleaños)."""
    try:
        tz = ZoneInfo(profile.timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo("UTC")
    return timezone.localdate(timezone=tz)


def _reason_data(reason, lang: str, grades: dict) -> dict:
    return {
        "code": reason.code,
        "rule_key": reason.rule_key,
        "grade": grades.get(reason.rule_key),
        "params": reason.params,
        **reason_texts.describe(reason, lang),
    }


class SafetyView(APIView):
    """`GET /coach/safety`: flags, motivos (con regla, texto, profesional y gravedad),
    `refer_gp`, la línea de derivación literal, el aviso y el número de emergencia."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = request.user.profile
        today = _today(profile)
        flags = services.safety_for(request.user, today)
        lang = _lang()
        reasons = [parse_reason(text) for text in flags.reasons]
        paused = {
            name: (pause, [parse_reason(text) for text in pause.reasons])
            for name, pause in flags.paused_exercises.items()
        }
        keys = {r.rule_key for r in reasons} | {r.rule_key for _, rs in paused.values() for r in rs}
        grades = dict(KnowledgeRule.objects.filter(key__in=keys).values_list("key", "grade"))
        weight = latest_weight(request.user, today)
        screening = services.screening_get(profile)
        return Response(
            {
                "screened": flags.screened,
                "flags": {name: getattr(flags, name) for name in BOOL_FLAGS},
                "reasons": [_reason_data(r, lang, grades) for r in reasons],
                "paused_exercises": {
                    name: {"assessed": pause.assessed, "reasons": [_reason_data(r, lang, grades) for r in rs]}
                    for name, (pause, rs) in paused.items()
                },
                "refer_gp": flags.refer_gp,
                "deferral_line": reason_texts.DEFERRAL_LINE[lang] if flags.refer_gp else None,
                "disclaimer": reason_texts.DISCLAIMER[lang],
                "emergency_number": flags.emergency_number,
                # "No lo sé" deja el PAR-Q+ sin contestar: la Home recuerda completarlo.
                "parq_pending": screening.parq_any_yes is None,
                "weight": {"kg": weight[0], "date": weight[1].isoformat()} if weight else None,
            }
        )


def screening_data(screening: Screening, lang: str) -> dict:
    return {
        "values": {key: getattr(screening, key) for key in coach_profile.SCREENING_KEYS},
        # El formulario oficial, en el idioma del usuario. Nunca se copia ni se incrusta.
        "parq_url": settings.PARQ_URL_EN if lang == "en" else settings.PARQ_URL_ES,
        "parq_native_form": settings.PARQ_NATIVE_FORM,
    }


def _errors(exc: DjangoValidationError):
    return exc.message_dict if hasattr(exc, "message_dict") else {"detail": exc.messages}


class ScreeningView(APIView):
    """`GET/PATCH /coach/screening`. `PATCH {"values": {clave: valor|null}, "origin": …}`."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(screening_data(services.screening_get(request.user.profile), _lang()))

    def patch(self, request):
        values = request.data.get("values")
        origin = request.data.get("origin", ScreeningEvent.Origin.ONBOARDING)
        if not isinstance(values, dict) or not values:
            return Response({"values": "expected an object of screening answers"}, status=400)
        try:
            screening = services.screening_update(request.user.profile, values, origin=origin, actor=request.user)
        except DjangoValidationError as exc:
            return Response(_errors(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(screening_data(screening, _lang()))


class InjurySerializer(serializers.ModelSerializer):
    class Meta:
        model = Injury
        fields = ("id", "area", "status", "since", "professional", "cleared_on", "exercises", "origin")
        read_only_fields = ("id",)

    def validate_exercises(self, value):
        if not isinstance(value, list) or not all(isinstance(e, str) for e in value):
            raise serializers.ValidationError("injury exercises must be exercise names")
        return value


class InjuryListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(InjurySerializer(request.user.profile.injuries.all(), many=True).data)

    def post(self, request):
        serializer = InjurySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            injury = services.injury_add(request.user.profile, **serializer.validated_data)
        except DjangoValidationError as exc:
            return Response(_errors(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(InjurySerializer(injury).data, status=status.HTTP_201_CREATED)


class InjuryDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, pk) -> Injury:
        injury = Injury.objects.filter(pk=pk, profile=request.user.profile).first()
        if injury is None:
            raise Http404
        return injury

    def patch(self, request, pk):
        injury = self._get(request, pk)
        serializer = InjurySerializer(injury, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            injury = services.injury_update(injury, **serializer.validated_data)
        except DjangoValidationError as exc:
            return Response(_errors(exc), status=status.HTTP_400_BAD_REQUEST)
        return Response(InjurySerializer(injury).data)

    def delete(self, request, pk):
        self._get(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
