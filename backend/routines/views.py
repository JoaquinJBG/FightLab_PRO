"""API de rutinas, carpetas, programas y «Mi rutina» (F17 R). Todo cuelga de `api/v1/gym/`."""
from django.db.models import Count, Prefetch
from django.utils.translation import get_language
from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import plan_sync, programs, services
from .models import Routine, RoutineExercise, RoutineFolder
from .safety import start_safety
from .serializers import (
    FolderSerializer,
    ReorderSerializer,
    RoutineWriteSerializer,
    routine_data,
    routine_summary,
    set_to_json,
)

TEXTS = {
    "es": {"copy": "copia", "reorder_invalid": "Esos elementos no son todos tuyos o de esa carpeta."},
    "en": {"copy": "copy", "reorder_invalid": "Those items are not all yours or not in that folder."},
}


def text(key: str) -> str:
    lang = (get_language() or "es")[:2]
    return TEXTS.get(lang, TEXTS["es"])[key]


def _routines(profile):
    return Routine.objects.filter(profile=profile).prefetch_related(
        Prefetch("exercises", queryset=RoutineExercise.objects.order_by("order", "id"))
    )


def _folder_or_400(profile, folder_id):
    if folder_id is None:
        return None, None
    folder = RoutineFolder.objects.filter(pk=folder_id, profile=profile).first()
    if folder is None:
        return None, Response({"folder": ["folder"]}, status=status.HTTP_400_BAD_REQUEST)
    return folder, None


# ---------------------------------------------------------------- carpetas


class FolderListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        folders = RoutineFolder.objects.filter(profile=request.user.profile).annotate(n_routines=Count("routines")).order_by("order", "id")
        return Response(FolderSerializer(folders, many=True).data)

    def post(self, request):
        serializer = FolderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        folder = services.folder_create(request.user.profile, serializer.validated_data["name"])
        return Response(FolderSerializer(folder).data, status=status.HTTP_201_CREATED)


class FolderDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        folder = get_object_or_404(RoutineFolder, pk=pk, profile=request.user.profile)
        serializer = FolderSerializer(folder, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk):
        folder = get_object_or_404(RoutineFolder, pk=pk, profile=request.user.profile)
        services.folder_delete(folder, with_routines=request.query_params.get("routines") == "delete")
        return Response(status=status.HTTP_204_NO_CONTENT)


class FolderReorderView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not services.folders_reorder(request.user.profile, serializer.validated_data["ids"]):
            return Response({"detail": text("reorder_invalid")}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"ok": True})


# ---------------------------------------------------------------- rutinas


class RoutineListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _routines(request.user.profile).order_by("folder_id", "order", "id")
        return Response([routine_summary(r) for r in qs])

    def post(self, request):
        profile = request.user.profile
        serializer = RoutineWriteSerializer(data=request.data, context={"profile": profile})
        serializer.is_valid(raise_exception=True)
        routine = services.routine_create(profile, **serializer.validated_data)
        return Response(routine_data(_routines(profile).get(pk=routine.pk)), status=status.HTTP_201_CREATED)


class RoutineDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, pk):
        return get_object_or_404(_routines(request.user.profile), pk=pk)

    def get(self, request, pk):
        return Response(routine_data(self._get(request, pk)))

    def _write(self, request, pk, partial):
        routine = self._get(request, pk)
        profile = request.user.profile
        serializer = RoutineWriteSerializer(data=request.data, partial=partial, context={"profile": profile})
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        if partial:
            data = {k: v for k, v in data.items() if k in request.data}
        services.routine_update(routine, data)
        return Response(routine_data(self._get(request, pk)))

    def put(self, request, pk):
        return self._write(request, pk, partial=False)

    def patch(self, request, pk):
        return self._write(request, pk, partial=True)

    def delete(self, request, pk):
        self._get(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class RoutineDuplicateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        routine = get_object_or_404(_routines(request.user.profile), pk=pk)
        copy = services.routine_duplicate(routine, text("copy"))
        return Response(routine_data(_routines(request.user.profile).get(pk=copy.pk)), status=status.HTTP_201_CREATED)


class RoutineReorderView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = request.user.profile
        folder, error = _folder_or_400(profile, serializer.validated_data["folder"])
        if error:
            return error
        if not services.routines_reorder(profile, folder, serializer.validated_data["ids"]):
            return Response({"detail": text("reorder_invalid")}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"ok": True})


class RoutineStartView(APIView):
    """`GET gym/routines/<id>/start`: el borrador del entreno (contrato de F17 con H)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        routine = get_object_or_404(_routines(request.user.profile), pk=pk)
        exercises = list(routine.exercises.all())
        return Response({
            "routine_id": routine.id,
            "title": routine.title,
            "notes": routine.notes,
            "exercises": [
                {
                    "exercise_key": e.exercise_key,
                    "name": e.name,
                    "notes": e.notes,
                    "rest_s": e.rest_s,
                    "superset": e.superset,
                    "sets": [set_to_json(s) for s in e.sets],
                }
                for e in exercises
            ],
            "safety": start_safety(request.user, exercises),
        })


# ---------------------------------------------------------------- programas


class ProgramListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        lang = programs.lang_of(request.user)
        return Response([programs.program_summary(p, lang) for p in programs.all_programs()])


class ProgramDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug):
        program = programs.get_program(slug)
        if program is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(programs.program_detail(program, programs.lang_of(request.user)))


class ProgramLoadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, slug):
        program = programs.get_program(slug)
        if program is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        folder, routines = programs.load(request.user, program)
        return Response(
            {
                "folder": FolderSerializer(folder).data,
                "routines": [routine_data(_routines(request.user.profile).get(pk=r.pk)) for r in routines],
            },
            status=status.HTTP_201_CREATED,
        )


# ---------------------------------------------------------------- Mi rutina (plan por reglas)


class PlanRoutinesView(APIView):
    """`GET gym/plan-routines`: la carpeta «Mi rutina» y si está al día con el plan activo.
    `POST gym/plan-routines/sync {on_edited: "keep" | "overwrite"}`: la (re)genera."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(plan_sync.status_data(request.user))


class PlanRoutinesSyncView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        on_edited = request.data.get("on_edited") if isinstance(request.data, dict) else None
        if on_edited not in (None, "keep", "overwrite"):
            return Response({"on_edited": ["keep | overwrite"]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            plan_sync.sync(request.user, on_edited=on_edited)
        except plan_sync.NoActivePlan:
            return Response({"code": "no_active_plan"}, status=status.HTTP_409_CONFLICT)
        except plan_sync.Blocked as exc:
            return Response({"code": "no_training", "reasons": exc.reasons}, status=status.HTTP_409_CONFLICT)
        except plan_sync.EditedRoutines as exc:
            return Response({"code": "edited", "routines": exc.routines}, status=status.HTTP_409_CONFLICT)
        return Response(plan_sync.status_data(request.user))
