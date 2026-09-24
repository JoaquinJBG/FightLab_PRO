from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import selectors, services
from .serializers import BulkStatePutSerializer, StatePutSerializer

MAX_KEYS_PER_REQUEST = 200
MAX_PREFIX_LEN = 64


def _error_detail(exc: DjangoValidationError):
    return services.error_detail(exc)


def _serialize_entries(entries):
    return {
        entry.key: {"value": entry.value, "updated_at": entry.updated_at.isoformat()}
        for entry in entries
    }


class StateView(APIView):
    """GET /me/state?keys=a,b,c  o  GET /me/state?prefix=nutri_&from=&to="""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "user-state"

    def get(self, request):
        profile = request.user.profile
        prefix = request.query_params.get("prefix")
        if prefix is not None:
            if not prefix or len(prefix) > MAX_PREFIX_LEN:
                return Response({"detail": "prefix inválido."}, status=status.HTTP_400_BAD_REQUEST)
            entries = selectors.state_get_range(
                profile=profile,
                prefix=prefix,
                date_from=request.query_params.get("from") or None,
                date_to=request.query_params.get("to") or None,
            )
            return Response(_serialize_entries(entries))

        raw_keys = request.query_params.get("keys", "")
        keys = [k for k in (part.strip() for part in raw_keys.split(",")) if k]
        if not keys:
            return Response({"detail": "Falta keys= o prefix=."}, status=status.HTTP_400_BAD_REQUEST)
        if len(keys) > MAX_KEYS_PER_REQUEST:
            return Response(
                {"detail": f"Máximo {MAX_KEYS_PER_REQUEST} keys por petición."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        entries = selectors.state_get_many(profile=profile, keys=keys)
        return Response(_serialize_entries(entries))


class StateDetailView(APIView):
    """PUT/DELETE /me/state/<key>"""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "user-state"

    def put(self, request, key):
        serializer = StatePutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            entry, accepted = services.state_put(
                profile=request.user.profile,
                key=key,
                value=serializer.validated_data["value"],
                client_updated_at=serializer.validated_data.get("updated_at"),
            )
        except DjangoValidationError as exc:
            return Response({"detail": _error_detail(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "key": entry.key,
                "value": entry.value,
                "updated_at": entry.updated_at.isoformat(),
                "accepted": accepted,
            }
        )

    def delete(self, request, key):
        try:
            services.validate_key(key)
        except DjangoValidationError as exc:
            return Response({"detail": _error_detail(exc)}, status=status.HTTP_400_BAD_REQUEST)
        services.state_delete(profile=request.user.profile, key=key)
        return Response(status=status.HTTP_204_NO_CONTENT)


class StateBulkView(APIView):
    """POST /me/state/bulk — hasta `services.MAX_BULK_ITEMS` items
    `{key, value, updated_at}` en una sola petición (y por tanto un único
    conteo de throttle `user-state`), pensado para la migración inicial en
    lote de lo que ya hubiera en localStorage. Cada item se valida y aplica
    por separado (allowlist, tamaño, last-write-wins): uno inválido no tira
    abajo el resto del lote, solo queda como `ok: False` en su propia clave."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "user-state"

    def post(self, request):
        serializer = BulkStatePutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        results = services.state_put_bulk(
            profile=request.user.profile, items=serializer.validated_data["items"]
        )
        return Response({"results": results})
