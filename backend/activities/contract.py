"""Llamadas a las APIs de las otras ramas de F17 por su contrato HTTP, sin red (rama H).

Importar de Hevy crea ejercicios propios (rama E, `POST gym/exercises/custom`) y rutinas (rama R,
`POST gym/routines`). Se llama a sus vistas como lo haría la app, con una petición interna
autenticada como el usuario: así H solo depende del contrato (rutas y cuerpos) y no de cómo las
otras ramas guardan sus datos. Si una ruta no existe (la app aún no está), devuelve None y quien
llama lo cuenta como «no disponible», sin romper la importación.
"""
from __future__ import annotations

from django.urls import Resolver404, resolve
from rest_framework.test import APIRequestFactory, force_authenticate

API_PREFIX = "/api/v1/"
# Un ejercicio propio creado al importar: el CSV no trae su músculo.
IMPORTED_MUSCLE = "full_body"
IMPORTED_NOTE = "Importado de Hevy: revisa sus músculos y su material."
_factory = APIRequestFactory()


def call(user, method: str, path: str, data: dict | None = None) -> tuple[int, object] | None:
    """(status, datos) de `method path` como `user`; None si la ruta no existe. En un GET,
    `data` son los parámetros de la consulta."""
    try:
        match = resolve(API_PREFIX + path)
    except Resolver404:
        return None
    url = API_PREFIX + path
    if method == "GET":
        request = _factory.get(url, data or {})
    else:
        request = getattr(_factory, method.lower())(url, data or {}, format="json")
    force_authenticate(request, user=user)
    response = match.func(request, *match.args, **match.kwargs)
    if hasattr(response, "render"):
        response.render()
    return response.status_code, getattr(response, "data", None)


def legacy_key(name: str) -> str | None:
    """`exercises.legacy.legacy_exercise_key` (rama E): nombres de LIBRARY y del catálogo,
    también los de Hevy como «Bench Press (Barbell)». None sin la app o sin traducción."""
    try:
        from exercises.legacy import legacy_exercise_key
    except ImportError:
        return None
    try:
        return legacy_exercise_key(name)
    except Exception:  # noqa: BLE001 - una traducción rota no tumba la importación
        return None


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def exercise_key_for(user, name: str, *, create: bool, cache: dict[str, str | None]) -> str | None:
    """La clave de un ejercicio importado: la del catálogo si se conoce; si no, la de un ejercicio
    propio del usuario con ese nombre (como los ejercicios personalizados de Hevy), que se crea si
    no existe y `create`. None si la biblioteca no está."""
    norm = _norm(name)
    if norm in cache:
        return cache[norm]
    key = legacy_key(name)
    if key is None:
        listed = call(user, "GET", "gym/exercises", {"q": name[:80]})
        if listed and listed[0] == 200 and isinstance(listed[1], list):
            key = next((e["key"] for e in listed[1] if e.get("custom") and _norm(e.get("name", "")) == norm), None)
        if key is None and create:
            # Hevy no dice el músculo: «cuerpo completo» y una nota para que el usuario lo cambie.
            made = call(user, "POST", "gym/exercises/custom", {
                "name": name[:120], "primary_muscles": [IMPORTED_MUSCLE], "notes": IMPORTED_NOTE,
            })
            if made and made[0] == 201 and isinstance(made[1], dict):
                key = made[1].get("key")
    cache[norm] = key
    return key


def create_routine(user, payload: dict, *, source_ref: str = "") -> int | None:
    """Crea una rutina importada con el cuerpo del contrato de R ({title, notes, exercises:
    [{exercise_key, name, notes, rest_s, superset, sets: [{set_type, reps, reps_max, weight_kg,
    rpe, rir}]}]}), validado con el mismo serializer que `POST gym/routines`. Va por el servicio
    de R y no por la API porque `source=import` y `source_ref` (el título de Hevy) solo se ponen
    desde el servidor: el cliente no puede. El id, o None si la app no está o no la acepta."""
    try:
        from routines import services
        from routines.models import Routine
        from routines.serializers import RoutineWriteSerializer
    except ImportError:
        return None
    ser = RoutineWriteSerializer(data=payload, context={"profile": user.profile})
    if not ser.is_valid():
        return None
    routine = services.routine_create(
        user.profile, **ser.validated_data, source=Routine.Source.IMPORT, source_ref=source_ref[:160],
    )
    return routine.id


def imported_routine_exists(user, source_ref: str) -> bool:
    """Si ya hay una rutina importada con ese título de origen (para no duplicarla)."""
    try:
        from routines.models import Routine
    except ImportError:
        return False
    return Routine.objects.filter(profile=user.profile, source=Routine.Source.IMPORT, source_ref=source_ref[:160]).exists()


def catalog_name(key: str | None, lang: str, fallback: str) -> str:
    """El nombre del ejercicio del catálogo en `lang` (el español si no hay en ese idioma); el
    mismo `fallback` si la clave no es del catálogo o la app no está. Así, lo que se importa de
    Hevy en inglés («Pull Up») se guarda y se enseña como el del catálogo («Dominadas»)."""
    if not key or not key.startswith("cat:"):
        return fallback
    try:
        from exercises.catalog import catalog_by_key
    except ImportError:
        return fallback
    entry = catalog_by_key().get(key)
    if not entry:
        return fallback
    return entry["names"].get(lang) or entry["names"].get("es") or fallback
