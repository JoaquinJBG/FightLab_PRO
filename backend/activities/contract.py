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


def create_routine(user, payload: dict) -> int | None:
    """`POST gym/routines` (contrato de R): {title, notes, exercises: [{exercise_key, name,
    notes, rest_s, superset, sets: [{set_type, reps, reps_max, weight_kg, rpe, rir}]}]}. El id
    de la rutina creada, o None si la API no está o no la acepta."""
    result = call(user, "POST", "gym/routines", payload)
    if result and result[0] == 201 and isinstance(result[1], dict):
        return result[1].get("id")
    return None
