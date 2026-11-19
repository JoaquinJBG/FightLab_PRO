"""Llamadas a las APIs de las otras ramas de F17 por su contrato HTTP, sin red (rama H).

Importar de Hevy crea ejercicios propios (rama E) y rutinas (rama R). Los ejercicios propios se
leen y se crean en bloque con el modelo de E (`exercise_keys`): pasar por su vista con una
petición interna por nombre era un DoS con un CSV de miles de nombres (fix G1-2). `call` queda
para llamar a una vista por su contrato HTTP: si la ruta no existe (la app aún no está), devuelve
None y quien llama lo cuenta como «no disponible», sin romper la importación.
"""
from __future__ import annotations

from django.urls import Resolver404, resolve
from rest_framework.test import APIRequestFactory, force_authenticate

API_PREFIX = "/api/v1/"
# Un ejercicio propio creado al importar: el CSV no trae su músculo.
IMPORTED_MUSCLE = "full_body"
IMPORTED_NOTE = "Importado de Hevy: revisa sus músculos y su material."
# Ejercicios propios nuevos que puede crear una sola importación (fix G1-2).
MAX_NEW_EXERCISES_PER_IMPORT = 300
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


def norm_name(text: str) -> str:
    return " ".join(text.lower().split())


class ExerciseLimit(Exception):
    """Una importación que crearía demasiados ejercicios propios: `code` y el tope (`limit`)."""

    def __init__(self, code: str, limit: int):
        super().__init__(code)
        self.code = code
        self.limit = limit


def exercise_keys(user, names, *, create: bool) -> dict[str, str | None]:
    """La clave de cada ejercicio importado, por su nombre normalizado (`norm_name`): la del
    catálogo si se conoce; si no, la de un ejercicio propio del usuario con ese nombre (como los
    personalizados de Hevy), que se crea si no existe y `create`. None si la biblioteca no está.

    Los ejercicios propios se leen una sola vez y los nuevos se crean en bloque, directamente con el
    modelo (sin pasar por la vista: un CSV con miles de nombres hacía miles de peticiones internas).
    Lanza `ExerciseLimit` antes de crear nada si pasaría de `MAX_NEW_EXERCISES_PER_IMPORT` nuevos o
    del tope de ejercicios propios por perfil (`exercises.models.MAX_CUSTOM_EXERCISES`)."""
    out: dict[str, str | None] = {}
    unknown: dict[str, str] = {}
    for name in names:
        norm = norm_name(name)
        if not norm or norm in out or norm in unknown:
            continue
        key = legacy_key(name)
        if key is None:
            unknown[norm] = " ".join(name.split())[:120]
        else:
            out[norm] = key
    if not unknown:
        return out
    try:
        from exercises.models import MAX_CUSTOM_EXERCISES, CustomExercise
    except ImportError:
        return {**out, **dict.fromkeys(unknown)}
    mine: dict[str, str] = {}
    owned = 0
    for pk, name in CustomExercise.objects.filter(profile=user.profile).order_by("id").values_list("id", "name"):
        owned += 1
        mine.setdefault(norm_name(name), f"custom:{pk}")
    missing = [n for n in unknown if n not in mine]
    if len(missing) > MAX_NEW_EXERCISES_PER_IMPORT:
        raise ExerciseLimit("too_many_exercises", MAX_NEW_EXERCISES_PER_IMPORT)
    if owned + len(missing) > MAX_CUSTOM_EXERCISES:
        raise ExerciseLimit("too_many_custom_exercises", MAX_CUSTOM_EXERCISES)
    out.update({n: mine.get(n) for n in unknown})
    if create and missing:
        # Hevy no dice el músculo: «cuerpo completo» y una nota para que el usuario lo cambie.
        made = CustomExercise.objects.bulk_create(
            CustomExercise(
                profile=user.profile, name=unknown[n], primary_muscles=[IMPORTED_MUSCLE], notes=IMPORTED_NOTE
            )
            for n in missing
        )
        out.update({n: ex.key for n, ex in zip(missing, made)})
    return out


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
