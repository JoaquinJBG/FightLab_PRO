from datetime import date

from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from core.messages import msg

from . import records, selectors, services
from .models import Activity
from .serializers import ActivitySerializer

MAX_LIMIT = 200
DEFAULT_LIMIT = 50
MAX_RECORD_EXERCISES = 50


def _date(raw: str | None) -> date | None:
    return date.fromisoformat(raw) if raw else None


class ActivityListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        kind = request.query_params.get("kind")
        if kind and kind not in Activity.Kind.values:
            return Response({"detail": msg("kind_invalid")}, status=status.HTTP_400_BAD_REQUEST)
        raw_limit = request.query_params.get("limit", str(DEFAULT_LIMIT))
        try:
            limit = max(1, min(MAX_LIMIT, int(raw_limit)))
        except ValueError:
            return Response({"detail": msg("limit_invalid")}, status=status.HTTP_400_BAD_REQUEST)
        try:
            offset = max(0, int(request.query_params.get("offset", "0")))
        except ValueError:
            return Response({"detail": msg("offset_invalid")}, status=status.HTTP_400_BAD_REQUEST)
        try:
            since = _date(request.query_params.get("from"))
            until = _date(request.query_params.get("to"))
        except ValueError:
            return Response({"detail": msg("date_range_invalid")}, status=status.HTTP_400_BAD_REQUEST)
        acts = selectors.activity_list(
            user=request.user, kind=kind, limit=limit, offset=offset, since=since, until=until,
            tzname=request.query_params.get("tz"),
        )
        return Response(ActivitySerializer(acts, many=True).data)

    def post(self, request):
        """Guardar UNA sesión desde la app (F17, fallo F2): 201 si se crea, 200 si ya estaba y
        400 con el motivo si no se puede guardar. Nada se descarta en silencio."""
        result = services.activity_create(user=request.user, raw=request.data, strict=True)
        if result["status"] == "invalid":
            return Response(result, status=status.HTTP_400_BAD_REQUEST)
        code = status.HTTP_201_CREATED if result["status"] == "created" else status.HTTP_200_OK
        return Response(result, status=code)

    def delete(self, request):
        """Borrado masivo (lo usan los botones «Borrar historial» de las vistas).
        Exige kind=… o all=1 explícito: nada de borrar todo por accidente."""
        kind = request.query_params.get("kind")
        if kind:
            if kind not in Activity.Kind.values:
                return Response({"detail": msg("kind_invalid")}, status=status.HTTP_400_BAD_REQUEST)
            qs = Activity.objects.filter(profile=request.user.profile, kind=kind)
        elif request.query_params.get("all") == "1":
            qs = Activity.objects.filter(profile=request.user.profile)
        else:
            return Response({"detail": msg("delete_needs_scope")}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = qs.delete()
        return Response({"deleted": deleted})


class ActivitySyncView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "activities-sync"

    def post(self, request):
        if not isinstance(request.data, dict):
            return Response({"detail": msg("sync_bad_format")}, status=status.HTTP_400_BAD_REQUEST)
        items = request.data.get("items")
        if not isinstance(items, list) or not items:
            return Response({"detail": msg("sync_bad_format")}, status=status.HTTP_400_BAD_REQUEST)
        if len(items) > services.MAX_SYNC_ITEMS:
            return Response({"detail": msg("sync_max_items", n=services.MAX_SYNC_ITEMS)}, status=status.HTTP_400_BAD_REQUEST)
        results = services.activities_sync(user=request.user, items=items)
        counts = {s: sum(1 for r in results if r["status"] == s) for s in ("created", "exists", "invalid")}
        return Response({"results": results, **counts})


class ActivityDetailView(APIView):
    """Detalle de una sesión con sus series (F17): verla, editarla y borrarla."""

    permission_classes = [IsAuthenticated]

    def _payload(self, act):
        return {**ActivitySerializer(act).data, "sets": services.set_rows(act)}

    def get(self, request, pk):
        return Response(self._payload(get_object_or_404(Activity, pk=pk, profile=request.user.profile)))

    def patch(self, request, pk):
        act = get_object_or_404(Activity, pk=pk, profile=request.user.profile)
        if not isinstance(request.data, dict):
            return Response({"detail": msg("sync_bad_format")}, status=status.HTTP_400_BAD_REQUEST)
        updated, errors = services.activity_update(activity=act, data=request.data)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        return Response(self._payload(updated))

    def delete(self, request, pk):
        act = get_object_or_404(Activity, pk=pk, profile=request.user.profile)
        act.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ActivityMetricsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(selectors.load_metrics(user=request.user, tzname=request.query_params.get("tz")))


class ActivityCalendarView(APIView):
    """`GET activities/calendar?month=AAAA-MM&tz=…`: los días entrenados del mes (F17)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        raw = request.query_params.get("month", "")
        try:
            year, month = (int(x) for x in raw.split("-"))
            date(year, month, 1)
        except ValueError:
            return Response({"detail": msg("month_invalid")}, status=status.HTTP_400_BAD_REQUEST)
        days = selectors.calendar_days(user=request.user, year=year, month=month, tzname=request.query_params.get("tz"))
        return Response({"month": f"{year:04d}-{month:02d}", "days": days})


class GymRecordsView(APIView):
    """`GET gym/records[?exercise=…]`: los récords de cada ejercicio (F17)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        wanted = request.query_params.getlist("exercise")[:MAX_RECORD_EXERCISES]
        return Response(records.records_data(request.user, wanted or None))


class GymProgressView(APIView):
    """`GET gym/progress?exercise=…`: e1RM, peso máximo, volumen y mejor serie por sesión (F17)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        wanted = (request.query_params.get("exercise") or "").strip()
        if not wanted:
            return Response({"detail": msg("exercise_required")}, status=status.HTTP_400_BAD_REQUEST)
        return Response(records.progress_data(request.user, wanted))
