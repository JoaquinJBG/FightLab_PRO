from django.utils.translation import get_language
from rest_framework import serializers

from .models import CustomExercise
from .vocab import EQUIPMENT, MUSCLES

MAX_NOTES = 2000
MAX_LIST = 12

_MESSAGES = {
    "es": {
        "name_blank": "Pon un nombre al ejercicio.",
        "muscle_invalid": "Músculo no válido: {value}.",
        "equipment_invalid": "Material no válido: {value}.",
        "primary_required": "Elige al menos un músculo principal.",
        "list_too_long": "Demasiados elementos (máximo {n}).",
        "not_a_list": "Se espera una lista.",
    },
    "en": {
        "name_blank": "Give the exercise a name.",
        "muscle_invalid": "Invalid muscle: {value}.",
        "equipment_invalid": "Invalid equipment: {value}.",
        "primary_required": "Choose at least one primary muscle.",
        "list_too_long": "Too many items (maximum {n}).",
        "not_a_list": "A list is expected.",
    },
}


def _msg(key: str, **kw) -> str:
    lang = (get_language() or "es").split("-")[0]
    return _MESSAGES.get(lang, _MESSAGES["es"])[key].format(**kw)


def _slug_list(value, allowed: tuple[str, ...], error: str) -> list[str]:
    if not isinstance(value, list):
        raise serializers.ValidationError(_msg("not_a_list"))
    if len(value) > MAX_LIST:
        raise serializers.ValidationError(_msg("list_too_long", n=MAX_LIST))
    out: list[str] = []
    for item in value:
        if not isinstance(item, str) or item not in allowed:
            raise serializers.ValidationError(_msg(error, value=str(item)[:40]))
        if item not in out:
            out.append(item)
    return out


class CustomExerciseSerializer(serializers.ModelSerializer):
    name = serializers.CharField(max_length=120, trim_whitespace=True, allow_blank=True)
    primary_muscles = serializers.JSONField(required=False)
    secondary_muscles = serializers.JSONField(required=False)
    equipment = serializers.JSONField(required=False)
    notes = serializers.CharField(max_length=MAX_NOTES, allow_blank=True, required=False, trim_whitespace=True)

    class Meta:
        model = CustomExercise
        fields = ("name", "primary_muscles", "secondary_muscles", "equipment", "notes")

    def validate_name(self, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError(_msg("name_blank"))
        return value

    def validate_primary_muscles(self, value):
        return _slug_list(value, MUSCLES, "muscle_invalid")

    def validate_secondary_muscles(self, value):
        return _slug_list(value, MUSCLES, "muscle_invalid")

    def validate_equipment(self, value):
        return _slug_list(value, EQUIPMENT, "equipment_invalid")

    def validate(self, attrs):
        primary = attrs.get("primary_muscles", self.instance.primary_muscles if self.instance else [])
        if not primary:
            raise serializers.ValidationError({"primary_muscles": [_msg("primary_required")]})
        secondary = attrs.get("secondary_muscles", self.instance.secondary_muscles if self.instance else [])
        # Un músculo no puede ser principal y secundario a la vez: manda el principal.
        if "primary_muscles" in attrs or "secondary_muscles" in attrs:
            attrs["secondary_muscles"] = [m for m in secondary if m not in primary]
        return attrs
