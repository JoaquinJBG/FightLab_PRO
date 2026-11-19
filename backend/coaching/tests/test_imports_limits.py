"""Importar un CSV con muchos ejercicios desconocidos (fix G1-2): consultas acotadas y topes.

Antes, cada nombre desconocido hacía una petición interna a `GET gym/exercises` (que lee todos los
ejercicios propios del perfil) y otra a `POST gym/exercises/custom`: un CSV inventado con miles de
nombres era un DoS. Ahora los ejercicios propios se leen una vez y los nuevos se crean en bloque,
con un tope por importación y otro por perfil. Todos los CSV son inventados.
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from activities import contract
from activities.models import SetLog
from exercises.models import MAX_CUSTOM_EXERCISES, CustomExercise

from .helpers import client_for, make_user, today_fixed  # noqa: F401
from .test_imports import upload

pytestmark = pytest.mark.django_db


def generic(names, days=5) -> str:
    lines = ["date,exercise,weight_kg,reps,rir,set_type,session"]
    for i, name in enumerate(names):
        lines.append(f"2026-09-{10 + i % days:02d},{name},50,8,,,Inventada")
    return "\n".join(lines) + "\n"


def names(n, prefix="Ejercicio inventado"):
    return [f"{prefix} {i}" for i in range(n)]


def _queries(client, text) -> tuple[int, object]:
    with CaptureQueriesContext(connection) as ctx:
        res = upload(client, text)
    return len(ctx.captured_queries), res


def test_queries_do_not_grow_with_the_number_of_new_exercises(today_fixed):
    small_n, small = _queries(client_for(make_user()), generic(names(10)))
    big_n, big = _queries(client_for(make_user()), generic(names(250)))
    assert small.status_code == big.status_code == 201, big.data
    assert big.data["sets"]["imported"] == 250
    assert CustomExercise.objects.count() == 260
    assert big_n <= small_n + 2, (small_n, big_n)


def test_existing_custom_exercises_are_reused_not_duplicated(today_fixed):
    user = make_user()
    mine = CustomExercise.objects.create(profile=user.profile, name="Ejercicio Inventado 3", primary_muscles=["chest"])
    res = upload(client_for(user), generic(names(5)))
    assert res.status_code == 201, res.data
    assert CustomExercise.objects.filter(profile=user.profile).count() == 5  # 4 nuevos + el que ya había
    keys = set(SetLog.objects.filter(exercise__iexact="Ejercicio inventado 3").values_list("exercise_key", flat=True))
    assert keys == {mine.key}


def test_too_many_new_exercises_in_one_import_is_refused(today_fixed):
    user = make_user()
    res = upload(client_for(user), generic(names(contract.MAX_NEW_EXERCISES_PER_IMPORT + 1)))
    assert res.status_code == 400
    assert res.data["code"] == "too_many_exercises"
    assert res.data["params"] == {"max": contract.MAX_NEW_EXERCISES_PER_IMPORT}
    assert not CustomExercise.objects.filter(profile=user.profile).exists()
    assert not SetLog.objects.filter(activity__profile=user.profile).exists()


def test_profile_limit_of_custom_exercises_holds_on_import(today_fixed):
    user = make_user()
    CustomExercise.objects.bulk_create(
        CustomExercise(profile=user.profile, name=f"Ya mío {i}") for i in range(MAX_CUSTOM_EXERCISES - 3)
    )
    res = upload(client_for(user), generic(names(5)))
    assert res.status_code == 400
    assert res.data["code"] == "too_many_custom_exercises"
    assert res.data["params"] == {"max": MAX_CUSTOM_EXERCISES}
    assert CustomExercise.objects.filter(profile=user.profile).count() == MAX_CUSTOM_EXERCISES - 3


def test_profile_limit_of_custom_exercises_holds_on_the_api(today_fixed):
    user = make_user()
    CustomExercise.objects.bulk_create(
        CustomExercise(profile=user.profile, name=f"Ya mío {i}") for i in range(MAX_CUSTOM_EXERCISES)
    )
    res = client_for(user).post(
        "/api/v1/gym/exercises/custom", {"name": "Uno más", "primary_muscles": ["chest"]}, format="json"
    )
    assert res.status_code == 400
    assert res.data["code"] == "too_many_custom_exercises"
    assert CustomExercise.objects.filter(profile=user.profile).count() == MAX_CUSTOM_EXERCISES


def test_dry_run_counts_but_creates_no_exercise(today_fixed):
    user = make_user()
    res = upload(client_for(user), generic(names(5)), dry_run="1")
    assert res.status_code == 200, res.data
    assert not CustomExercise.objects.filter(profile=user.profile).exists()
