"""Validación de rutinas, ejercicios y series planificadas. Todo error es un 400 con su campo."""
import re
from decimal import Decimal

from rest_framework import serializers

from activities.keys import custom_key_owned
from core.messages import msg

from .models import SET_TYPES, Routine, RoutineFolder

# Contrato de F17: `cat:<slug en inglés>` o `custom:<id>`; nulo para un nombre antiguo sin clave.
EXERCISE_KEY_RE = re.compile(r"^(cat:[a-z0-9]+(?:-[a-z0-9]+)*|custom:[1-9]\d*)$")

# Topes técnicos (no de producto): evitan cuerpos absurdos, no limitan a nadie real.
MAX_EXERCISES = 100
MAX_SETS = 50
MAX_REPS = 1000
MAX_WEIGHT_KG = 1000
MAX_REST_S = 3600


class PlannedSetSerializer(serializers.Serializer):
    set_type = serializers.ChoiceField(choices=SET_TYPES, default="normal")
    reps = serializers.IntegerField(min_value=0, max_value=MAX_REPS, allow_null=True, default=None)
    reps_max = serializers.IntegerField(min_value=0, max_value=MAX_REPS, allow_null=True, default=None)
    weight_kg = serializers.DecimalField(
        max_digits=6, decimal_places=2, min_value=Decimal(0), max_value=Decimal(MAX_WEIGHT_KG),
        allow_null=True, default=None,
    )
    rpe = serializers.DecimalField(
        max_digits=3, decimal_places=1, min_value=Decimal(1), max_value=Decimal(10), allow_null=True, default=None
    )
    rir = serializers.DecimalField(
        max_digits=3, decimal_places=1, min_value=Decimal(0), max_value=Decimal(10), allow_null=True, default=None
    )

    def validate_rpe(self, value):
        if value is not None and (value * 2) % 1:
            raise serializers.ValidationError("0.5")
        return value

    def validate(self, attrs):
        reps, reps_max = attrs.get("reps"), attrs.get("reps_max")
        if reps_max is not None and reps is not None and reps_max < reps:
            raise serializers.ValidationError({"reps_max": "reps_max >= reps"})
        return attrs


def set_to_json(s: dict) -> dict:
    """Una serie validada tal como se guarda (y se devuelve): números en JSON, nunca Decimal."""
    def num(v):
        return None if v is None else float(v)

    return {
        "set_type": s.get("set_type", "normal"),
        "reps": s.get("reps"),
        "reps_max": s.get("reps_max"),
        "weight_kg": num(s.get("weight_kg")),
        "rpe": num(s.get("rpe")),
        "rir": num(s.get("rir")),
    }


class RoutineExerciseSerializer(serializers.Serializer):
    exercise_key = serializers.CharField(max_length=80, allow_null=True, required=False, default=None)
    name = serializers.CharField(max_length=120)
    notes = serializers.CharField(max_length=2000, allow_blank=True, required=False, default="")
    rest_s = serializers.IntegerField(min_value=0, max_value=MAX_REST_S, allow_null=True, required=False, default=None)
    superset = serializers.IntegerField(min_value=0, max_value=1000, allow_null=True, required=False, default=None)
    sets = PlannedSetSerializer(many=True, required=False, default=list, max_length=MAX_SETS)

    def validate_exercise_key(self, value):
        if value in (None, ""):
            return None
        if not EXERCISE_KEY_RE.match(value):
            raise serializers.ValidationError("cat:<slug> | custom:<id>")
        # F17 (H): un `custom:<id>` tiene que ser un ejercicio propio de este usuario
        if not custom_key_owned(self.context.get("profile"), value):
            raise serializers.ValidationError(msg("exercise_not_yours"))
        return value


class RoutineWriteSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=120)
    notes = serializers.CharField(max_length=4000, allow_blank=True, required=False, default="")
    folder = serializers.IntegerField(allow_null=True, required=False, default=None)
    exercises = RoutineExerciseSerializer(many=True, required=False, default=list, max_length=MAX_EXERCISES)

    def validate_folder(self, value):
        if value is None:
            return None
        profile = self.context["profile"]
        folder = RoutineFolder.objects.filter(pk=value, profile=profile).first()
        if folder is None:
            raise serializers.ValidationError("folder")
        return folder


class FolderSerializer(serializers.ModelSerializer):
    routine_count = serializers.SerializerMethodField()

    class Meta:
        model = RoutineFolder
        fields = ("id", "name", "order", "kind", "program_slug", "routine_count")
        read_only_fields = ("id", "order", "kind", "program_slug", "routine_count")

    def get_routine_count(self, obj) -> int:
        count = getattr(obj, "n_routines", None)
        return count if count is not None else obj.routines.count()


class ReorderSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(), max_length=1000)
    folder = serializers.IntegerField(allow_null=True, required=False, default=None)


def exercise_data(ex) -> dict:
    return {
        "id": ex.id,
        "exercise_key": ex.exercise_key,
        "name": ex.name,
        "order": ex.order,
        "superset": ex.superset,
        "notes": ex.notes,
        "rest_s": ex.rest_s,
        "sets": [set_to_json(s) for s in ex.sets],
    }


def routine_data(routine: Routine) -> dict:
    return {
        "id": routine.id,
        "title": routine.title,
        "notes": routine.notes,
        "folder": routine.folder_id,
        "order": routine.order,
        "source": routine.source,
        "source_ref": routine.source_ref,
        "exercises": [exercise_data(e) for e in routine.exercises.all()],
        "created_at": routine.created_at.isoformat(),
        "updated_at": routine.updated_at.isoformat(),
    }


def routine_summary(routine: Routine) -> dict:
    exercises = list(routine.exercises.all())
    return {
        "id": routine.id,
        "title": routine.title,
        "notes": routine.notes,
        "folder": routine.folder_id,
        "order": routine.order,
        "source": routine.source,
        "source_ref": routine.source_ref,
        "exercise_count": len(exercises),
        "set_count": sum(len(e.sets) for e in exercises),
        "exercise_names": [e.name for e in exercises],
        "exercise_keys": [e.exercise_key for e in exercises],
        "updated_at": routine.updated_at.isoformat(),
    }
