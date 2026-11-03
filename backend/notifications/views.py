"""Avisos con Web Push (F11).

- `me/push*`: la persona suscribe su navegador, elige qué avisos quiere y se manda uno de prueba.
- `cron/reminders`: lo llama el BFF desde Vercel Cron, con `X-Bff-Secret` (el mismo
  `BFF_SHARED_SECRET` que firma la IP del visitante). Sin ese secreto configurado responde 503;
  con uno distinto, 403. El backend decide a quién avisar (`reminders.run`).
"""
import hmac

from django.conf import settings
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import push, reminders
from .models import PushSubscription

PREF_FIELDS = ("eve", "review", "weigh", "mobility")


def _not_configured() -> Response:
    return Response({"code": "push_not_configured"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


def state(profile) -> dict:
    prefs = reminders.prefs_for(profile)
    return {
        "configured": push.configured(),
        "public_key": settings.VAPID_PUBLIC_KEY or None,
        "prefs": {name: getattr(prefs, name) for name in PREF_FIELDS},
        "devices": PushSubscription.objects.filter(profile=profile).count(),
    }


class SubscriptionSerializer(serializers.Serializer):
    class Keys(serializers.Serializer):
        p256dh = serializers.CharField(max_length=200)
        auth = serializers.CharField(max_length=100)

    endpoint = serializers.URLField(max_length=1000)
    keys = Keys()
    user_agent = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")

    def validate_endpoint(self, value):
        if not push.endpoint_allowed(value):
            raise serializers.ValidationError("unknown push service")
        return value


class PrefsSerializer(serializers.Serializer):
    eve = serializers.BooleanField(required=False)
    review = serializers.BooleanField(required=False)
    weigh = serializers.BooleanField(required=False)
    mobility = serializers.BooleanField(required=False)


class PushView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(state(request.user.profile))


class PushSubscribeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not push.configured():
            return _not_configured()
        ser = SubscriptionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        profile = request.user.profile
        PushSubscription.objects.update_or_create(
            endpoint=data["endpoint"],
            defaults={
                "profile": profile,
                "p256dh": data["keys"]["p256dh"],
                "auth": data["keys"]["auth"],
                "user_agent": data["user_agent"][:200],
            },
        )
        extra = PushSubscription.objects.filter(profile=profile).values_list("pk", flat=True)[push.MAX_SUBSCRIPTIONS:]
        PushSubscription.objects.filter(pk__in=list(extra)).delete()
        return Response(state(profile), status=status.HTTP_201_CREATED)


class PushUnsubscribeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        endpoint = str(request.data.get("endpoint") or "") if hasattr(request.data, "get") else ""
        PushSubscription.objects.filter(profile=request.user.profile, endpoint=endpoint).delete()
        return Response(state(request.user.profile))


class PushPrefsView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request):
        ser = PrefsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        prefs = reminders.prefs_for(request.user.profile)
        for name, value in ser.validated_data.items():
            setattr(prefs, name, value)
        prefs.save()
        return Response(state(request.user.profile))


class PushTestView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "push-test"

    def post(self, request):
        if not push.configured():
            return _not_configured()
        profile = request.user.profile
        counts = push.send_to_profile(profile, reminders.test_payload(profile))
        return Response({**counts, **state(profile)})


class CronRemindersView(APIView):
    """Sin JWT ni sesión: la única credencial es el secreto del BFF."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        secret = settings.BFF_SHARED_SECRET
        if not secret:
            return Response({"code": "cron_not_configured"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        sent = request.headers.get("X-Bff-Secret") or ""
        if not hmac.compare_digest(sent.encode(), secret.encode()):
            return Response({"code": "forbidden"}, status=status.HTTP_403_FORBIDDEN)
        slot = request.data.get("slot") if hasattr(request.data, "get") else None
        if slot not in reminders.SLOTS:
            return Response({"slot": f"must be one of: {', '.join(reminders.SLOTS)}"}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"slot": slot, **reminders.run(slot)})
