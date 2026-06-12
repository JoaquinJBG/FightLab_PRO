from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import selectors, services
from .models import Activity
from .serializers import ActivitySerializer

MAX_LIMIT = 200
DEFAULT_LIMIT = 50


class ActivityListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        kind = request.query_params.get("kind")
        if kind and kind not in Activity.Kind.values:
            return Response({"detail": "kind inválido."}, status=status.HTTP_400_BAD_REQUEST)
        raw_limit = request.query_params.get("limit", str(DEFAULT_LIMIT))
        try:
            limit = max(1, min(MAX_LIMIT, int(raw_limit)))
        except ValueError:
            return Response({"detail": "limit inválido."}, status=status.HTTP_400_BAD_REQUEST)
        acts = selectors.activity_list(user=request.user, kind=kind, limit=limit)
        return Response(ActivitySerializer(acts, many=True).data)

    def delete(self, request):
        """Borrado masivo (lo usan los botones «Borrar historial» de las vistas).
        Exige kind=… o all=1 explícito: nada de borrar todo por accidente."""
        kind = request.query_params.get("kind")
        if kind:
            if kind not in Activity.Kind.values:
                return Response({"detail": "kind inválido."}, status=status.HTTP_400_BAD_REQUEST)
            qs = Activity.objects.filter(profile=request.user.profile, kind=kind)
        elif request.query_params.get("all") == "1":
            qs = Activity.objects.filter(profile=request.user.profile)
        else:
            return Response({"detail": "Falta kind= o all=1."}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = qs.delete()
        return Response({"deleted": deleted})


class ActivitySyncView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "activities-sync"

    def post(self, request):
        if not isinstance(request.data, dict):
            return Response({"detail": "Formato inválido: se espera {items: [...]}."}, status=status.HTTP_400_BAD_REQUEST)
        items = request.data.get("items")
        if not isinstance(items, list) or not items:
            return Response({"detail": "Formato inválido: se espera {items: [...]}."}, status=status.HTTP_400_BAD_REQUEST)
        if len(items) > services.MAX_SYNC_ITEMS:
            return Response({"detail": f"Máximo {services.MAX_SYNC_ITEMS} items por petición."}, status=status.HTTP_400_BAD_REQUEST)
        results = services.activities_sync(user=request.user, items=items)
        counts = {s: sum(1 for r in results if r["status"] == s) for s in ("created", "exists", "invalid")}
        return Response({"results": results, **counts})


class ActivityDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        act = get_object_or_404(Activity, pk=pk, profile=request.user.profile)
        act.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ActivityMetricsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(selectors.load_metrics(user=request.user, tzname=request.query_params.get("tz")))
