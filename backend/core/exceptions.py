"""Manejador de excepciones común de la API (DRF)."""
from coach.profile import ProfileIncomplete
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler

# Campo del motor → campo de FightLab que hay que pedir al usuario (spec §6.2 y P7).
PROFILE_FIELD_NAMES = {
    "sex": "equation_sex",
    "birth_date": "date_of_birth",
}


def api_exception_handler(exc, context):
    """`ProfileIncomplete` del motor → `409 {"code": "profile_incomplete", "field": …}`.

    La UI lleva al usuario al paso del onboarding que falta (spec §8.1).
    """
    if isinstance(exc, ProfileIncomplete):
        field = PROFILE_FIELD_NAMES.get(exc.field, exc.field)
        return Response({"code": "profile_incomplete", "field": field}, status=status.HTTP_409_CONFLICT)
    return exception_handler(exc, context)
