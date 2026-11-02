"""`GET/POST /coach/checkin` (Tasks 5.1-5.5). Solo usuarios autenticados.

Un solo formulario matinal: bienestar, peso, cintura, kcal, sueño, notas, señales de alarma y
las preguntas semanales. El servidor decide qué se acepta (`no_weight_targets`) y qué efecto
tiene cada respuesta sobre `Screening` e `Injury`; el frontend solo pinta lo que recibe.
"""
from datetime import date

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import checkin, redflags, services, weekly
from .bridge import reason_texts
from .bridge.reasons import parse_reason
from .models import KnowledgeRule
from .safety_views import BOOL_FLAGS, _lang, _reason_data, _today


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
        "weekly_questions": weekly.questions(user, today),
    }


def safety_summary(user, today: date, lang: str) -> dict:
    """Los flags tras este check-in (los motivos nuevos, la línea de derivación y el número de
    emergencias), para que la pantalla de resultado no necesite otra llamada."""
    flags = services.safety_for(user, today)
    reasons = [parse_reason(text) for text in flags.reasons]
    grades = dict(KnowledgeRule.objects.filter(key__in={r.rule_key for r in reasons}).values_list("key", "grade"))
    return {
        "flags": {name: getattr(flags, name) for name in BOOL_FLAGS},
        "reasons": [_reason_data(r, lang, grades) for r in reasons],
        "refer_gp": flags.refer_gp,
        "deferral_line": reason_texts.DEFERRAL_LINE[lang] if flags.refer_gp else None,
        "emergency_number": flags.emergency_number,
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
        user = request.user
        today = _today(user.profile)
        lang = _lang()
        data = dict(request.data) if hasattr(request.data, "items") else {}
        raw_signs = data.pop("signs", None)
        try:
            day = _day(request, today, data)
            values = {k: v for k, v in data.items() if k != "date"}
            checkin.clean_values(day, today, values, user)  # valida antes de escribir nada
            signs = redflags.validate_signs(raw_signs) if raw_signs is not None else []
        except DjangoValidationError as exc:
            return Response(_errors(exc), status=status.HTTP_400_BAD_REQUEST)

        refused: list[str] = []
        alerts: list[dict] = []
        with transaction.atomic():
            # Las señales van primero: si una cierra el pesaje (cribado de TCA), el peso que viene
            # en la misma petición ya no se guarda, pero la señal sí.
            if signs:
                no_training = services.safety_for(user, today).no_training
                raw_alerts, marks = redflags.apply_signs(user, signs, today, no_training=no_training)
            try:
                checkin.checkin_upsert(user, day, values, today)
            except checkin.CheckinRefused as exc:
                if not signs:
                    return Response({"code": exc.code, "fields": exc.fields}, status=status.HTTP_403_FORBIDDEN)
                refused = exc.fields
                checkin.checkin_upsert(user, day, {k: v for k, v in values.items() if k not in refused}, today)
            if signs:
                checkin.checkin_mark(user, day, **marks)
                grades = redflags.grades_for(a["code"] for a in raw_alerts)
                number = services.safety_for(user, today).emergency_number
                alerts = [redflags.alert_data(a, lang, number, grades) for a in raw_alerts]
        body = payload(user, day, today)
        body.update(alerts=alerts, refused=refused, safety=safety_summary(user, today, lang))
        return Response(body)
