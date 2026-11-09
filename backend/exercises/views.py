from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import catalog
from .models import CustomExercise
from .serializers import CustomExerciseSerializer, _msg
from .vocab import EQUIPMENT, MUSCLES


def _custom_items(profile) -> list[dict]:
    return [catalog.serialize_custom(ex) for ex in CustomExercise.objects.filter(profile=profile)]


class ExerciseListView(APIView):
    """GET gym/exercises?q=&muscle=&equipment=&lang= — la biblioteca más los propios del usuario."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        params = request.query_params
        muscle = params.get("muscle", "")
        equipment = params.get("equipment", "")
        if muscle and muscle not in MUSCLES:
            return Response({"detail": _msg("muscle_invalid", value=muscle[:40])}, status=status.HTTP_400_BAD_REQUEST)
        if equipment and equipment not in EQUIPMENT:
            return Response(
                {"detail": _msg("equipment_invalid", value=equipment[:40])}, status=status.HTTP_400_BAD_REQUEST
            )
        lang = catalog.resolve_lang(params.get("lang"))
        items = [*_custom_items(request.user.profile), *catalog.catalog_items(lang)]
        found = catalog.search(items, q=params.get("q", "")[:80], muscle=muscle, equipment=equipment)
        return Response([catalog.strip_private(i) for i in found])


def _catalog_response(key: str, lang_param: str | None) -> Response:
    entry = catalog.catalog_by_key().get(key)
    if entry is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(catalog.serialize_entry(entry, catalog.resolve_lang(lang_param)))


class ExerciseDetailView(APIView):
    """GET gym/exercises/<key> con `cat:<slug>` o `custom:<id>`."""

    permission_classes = [IsAuthenticated]

    def get(self, request, key: str):
        if key.startswith(catalog.CUSTOM_PREFIX):
            raw = key[len(catalog.CUSTOM_PREFIX):]
            if not raw.isdigit():
                return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
            ex = get_object_or_404(CustomExercise, pk=int(raw), profile=request.user.profile)
            return Response(catalog.serialize_custom(ex))
        return _catalog_response(key, request.query_params.get("lang"))


class CatalogDetailView(APIView):
    """GET gym/exercises/cat/<slug>: lo mismo que `gym/exercises/cat:<slug>`, sin los dos puntos
    (el proxy del BFF solo deja pasar segmentos con caracteres no reservados)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        return _catalog_response(f"{catalog.CAT_PREFIX}{slug}", request.query_params.get("lang"))


class CustomExerciseCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = CustomExerciseSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ex = ser.save(profile=request.user.profile)
        return Response(catalog.serialize_custom(ex), status=status.HTTP_201_CREATED)


class CustomExerciseDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, pk):
        return get_object_or_404(CustomExercise, pk=pk, profile=request.user.profile)

    def get(self, request, pk):
        return Response(catalog.serialize_custom(self._get(request, pk)))

    def patch(self, request, pk):
        ex = self._get(request, pk)
        ser = CustomExerciseSerializer(ex, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ex = ser.save()
        return Response(catalog.serialize_custom(ex))

    def delete(self, request, pk):
        self._get(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
