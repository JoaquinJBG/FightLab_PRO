"""Importar el historial de ParteDiario y del coach (fase 10). Todos los datos son inventados."""
import json
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from activities.models import Activity, SetLog
from coaching import targets
from coaching.models import DailyCheckin, DayLog, MealCheck, WeeklyReview
from profiles.models import BiometricsLog

from .helpers import client_for, fix_today, make_user

URL = "/api/v1/coach/import/history"
pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _today():
    with fix_today():  # 2026-10-29
        yield


def backup(**extra) -> str:
    data = {
        "kind": "parte-diario-copia",
        "format": 1,
        "app_version": "1.9.3",
        "days": [
            {"date": "2026-10-20", "weight_kg": 81.4, "sleep_h": 7.5, "intake_kcal": 2300, "trained": True,
             "mobility": False, "quad": "MOLESTIA_LEVE", "energy": 4, "notes": "Buen día", "day_type": "GIMNASIO"},
            {"date": "2026-10-21", "weight_kg": 81.0, "sleep_h": 6, "energy": 3},
        ],
        "meal_checks": [
            {"date": "2026-10-20", "meal": "DESAYUNO", "state": "HECHO"},
            {"date": "2026-10-20", "meal": "CENA", "state": "CAMBIADA", "change": "Tortilla francesa"},
            {"date": "2026-10-21", "meal": "COMIDA", "state": "NO_HECHO"},
        ],
        "cardio_sessions": [
            {"date": "2026-10-20", "type": "PASEO", "minutes": 25},
            {"date": "2026-10-20", "type": "TROTE", "minutes": 15},
            {"date": "2026-10-22", "type": "HIIT_SACO", "minutes": 12},
        ],
        "menus": [{"id": "m1", "title": "Semana inventada", "start": "2026-10-19", "end": "2026-10-25",
                   "imported_at": 1, "json": "{}"}],
        "shopping_checks": [{"menu_id": "m1", "item": "Arroz"}],
        "ticket_photos": [],
    }
    data.update(extra)
    return json.dumps(data)


CSV_HEADER = (
    "date,weight_kg,sleep_h,waist_cm,intake_kcal,trained,cardio_type,cardio_min,mobility,quad,energy,notes,"
    "desayuno_hecho,comida_hecho,merienda_hecho,cena_hecho,desayuno,comida,merienda,cena,"
    "desayuno_estado,comida_estado,merienda_estado,cena_estado,desayuno_cambio,comida_cambio,merienda_cambio,cena_cambio,"
    "tipo_dia,fc_reposo,fc_media,fc_max,min_z1,min_z2,min_z3,cardio_sesiones,cardio_min_eq,columna_futura\n"
)
WEEKLY = CSV_HEADER + (
    '2026-10-12,82.1,7,90.5,2250,true,Varios,40,true,peor,4,"Cansado, pero bien",'
    "true,false,,true,Avena,Lentejas,,Merluza,hecho,cambiada,,hecho,,Bocadillo,,,"
    'cardio,54,128,161,10,20,5,"Paseo con la perra:25;Trote:15",55,x\n'
    "2026-10-13,,6.5,,,,,,,bien,,,,,,,,,,,,,,,,,,,descanso,,,,,,,,,\n"
)


def upload(client, *files, **data):
    payload = [SimpleUploadedFile(name, text.encode("utf-8") if isinstance(text, str) else text) for name, text in files]
    return client.post(URL, {"files": payload, **data}, format="multipart")


def discarded(response) -> dict:
    return {(d["code"], d["field"]): d["count"] for d in response.data["discarded"]}


def notices(response) -> dict:
    return {n["code"]: n["count"] for n in response.data["notices"]}


def weight_on(user, day: date):
    log = user.profile.biometrics.filter(external_id=f"checkin:{day.isoformat()}").first()
    return log and log.weight_kg


# ---------------------------------------------------------------- copia JSON


def test_backup_goes_to_checkin_biometrics_daylog_meals_and_cardio():
    user = make_user(weight=None, profile={"timezone": "Europe/Madrid"})
    response = upload(client_for(user), ("parte-diario.json", backup()))
    assert response.status_code == 201, response.data
    assert response.data["files"][0]["kind"] == "parte_diario_json" and response.data["files"][0]["error"] is None
    assert response.data["days"] | {} == {"total": 3, "new": 3, "filled": 0, "conflict": 0, "unchanged": 0, "written": 3}
    assert response.data["range"] == {"first": "2026-10-20", "last": "2026-10-22"}

    row = DailyCheckin.objects.get(profile=user.profile, date=date(2026, 10, 20))
    assert (row.sleep_hours, row.intake_kcal, row.energy) == (7.5, 2300, 4)
    # El cuádriceps pasa a la zona "piernas" del check-in y a una nota.
    assert row.soreness_zones == ["legs"]
    assert row.notes == "Buen día; Cuádriceps izquierdo: molestia leve"
    assert weight_on(user, date(2026, 10, 20)) == Decimal("81.40")
    log = user.profile.biometrics.get(external_id="checkin:2026-10-20")
    assert log.timestamp.astimezone(timezone.utc) == datetime(2026, 10, 20, 6, 0, tzinfo=timezone.utc)  # 08:00 Madrid

    day = DayLog.objects.get(profile=user.profile, date=date(2026, 10, 20))
    assert (day.day_type, day.trained, day.mobility) == ("gimnasio", True, False)
    meals = {(m.date.isoformat(), m.meal): (m.state, m.change) for m in MealCheck.objects.filter(profile=user.profile)}
    assert meals == {
        ("2026-10-20", "desayuno"): ("hecho", ""),
        ("2026-10-20", "cena"): ("cambiada", "Tortilla francesa"),
        ("2026-10-21", "comida"): ("no_hecho", ""),
    }

    cardio = list(Activity.objects.filter(profile=user.profile).order_by("started_at"))
    assert [(a.kind, a.source, a.title, a.duration_sec, a.rpe) for a in cardio] == [
        ("SPORT", "IMPORT", "Paseo con la perra", 1500, None),
        ("SPORT", "IMPORT", "Trote", 900, None),
        ("SPORT", "IMPORT", "HIIT saco", 720, None),
    ]
    assert cardio[0].detail["sport_key"] == "walk" and cardio[1].detail["sport_key"] == "run"
    assert cardio[2].detail["format"] == "hiit" and "sport_key" not in cardio[2].detail
    assert response.data["items"]["cardio"] == 3
    # Menús y lista de la compra: no se importan en esta fase, y se dice.
    assert notices(response) == {"menus_later": 1, "shopping_later": 1, "cardio_no_load": 3, "quad_to_soreness": 1}


def test_reimporting_the_same_backup_changes_nothing():
    user = make_user(weight=None)
    client = client_for(user)
    upload(client, ("copia.json", backup()))
    again = upload(client, ("copia.json", backup()))
    assert again.data["days"]["unchanged"] == 3 and again.data["days"]["written"] == 0
    assert Activity.objects.filter(profile=user.profile).count() == 3
    assert MealCheck.objects.filter(profile=user.profile).count() == 3
    assert DailyCheckin.objects.get(profile=user.profile, date=date(2026, 10, 20)).notes.count("Buen día") == 1


def test_a_backup_from_before_v16_has_its_cardio_in_the_day():
    user = make_user(weight=None)
    data = json.loads(backup())
    del data["cardio_sessions"]
    data["days"][1].update(cardio_type="PASEO_TROTE", cardio_min=40)
    response = upload(client_for(user), ("vieja.json", json.dumps(data)))
    assert response.status_code == 201
    walk = Activity.objects.get(profile=user.profile)
    assert walk.title == "Paseo + trote" and walk.duration_sec == 2400 and walk.detail["sport_key"] == "walk"


@pytest.mark.parametrize(
    "content, code",
    [
        ("no es json", "not_json"),
        ('{"kind": "otra-cosa", "format": 1}', "not_backup"),
        ('{"kind": "parte-diario-copia", "format": 2}', "newer_backup"),
        ('{"kind": "parte-diario-copia", "format": 1, "days": {"a": 1}}', "damaged_backup"),
    ],
)
def test_a_file_that_is_not_a_backup_is_explained(content, code):
    user = make_user(weight=None)
    response = upload(client_for(user), ("x.json", content))
    assert response.status_code == 201
    assert response.data["files"][0]["error"]["code"] == code
    assert not DailyCheckin.objects.exists()


# ---------------------------------------------------------------- CSV semanal


def test_weekly_csv_with_every_column_and_an_unknown_one_at_the_end():
    user = make_user(weight=None)
    response = upload(client_for(user), ("parte-diario_2026-10-12_2026-10-18.csv", WEEKLY))
    assert response.status_code == 201, response.data
    assert response.data["files"][0]["kind"] == "parte_diario_csv"
    row = DailyCheckin.objects.get(profile=user.profile, date=date(2026, 10, 12))
    assert row.notes == "Cansado, pero bien; Cuádriceps izquierdo: peor" and row.soreness_zones == ["legs"]
    log = user.profile.biometrics.get(external_id="checkin:2026-10-12")
    assert (log.weight_kg, log.waist_cm, log.resting_heart_rate) == (Decimal("82.10"), Decimal("90.5"), 54)
    day = DayLog.objects.get(profile=user.profile, date=date(2026, 10, 12))
    # FC de los entrenamientos y zonas: se guardan sin mostrarse (fase 15).
    assert day.heart == {"fc_media": 128, "fc_max": 161, "min_z1": 10, "min_z2": 20, "min_z3": 5}
    assert day.day_type == "cardio" and day.trained is True and day.mobility is True
    meals = {m.meal: (m.state, m.change, m.dish) for m in MealCheck.objects.filter(date=date(2026, 10, 12))}
    assert meals == {
        "desayuno": ("hecho", "", "Avena"),
        "comida": ("cambiada", "Bocadillo", "Lentejas"),
        "cena": ("hecho", "", "Merluza"),
    }
    assert sorted(Activity.objects.values_list("title", "duration_sec")) == [("Paseo con la perra", 1500), ("Trote", 900)]
    # "bien" en el cuádriceps no deja nada; el tipo de día sí.
    quiet = DailyCheckin.objects.get(profile=user.profile, date=date(2026, 10, 13))
    assert quiet.soreness_zones == [] and quiet.notes == "" and quiet.sleep_hours == 6.5
    assert DayLog.objects.get(date=date(2026, 10, 13)).day_type == "descanso"
    assert notices(response)["heart_hidden"] == 1


def test_an_old_csv_with_only_the_first_columns_and_one_cardio_type():
    user = make_user(weight=None)
    old = (
        "date,weight_kg,sleep_h,waist_cm,intake_kcal,trained,cardio_type,cardio_min,mobility,quad,energy,notes\n"
        "2026-09-01,80,8,,,false,Paseo con la perra,30,,,5,\n"
        "2026-09-02,,7,,,,Varios,45,,,,\n"
    )
    response = upload(client_for(user), ("viejo.csv", old))
    assert response.status_code == 201, response.data
    assert list(Activity.objects.values_list("title", "duration_sec")) == [("Paseo con la perra", 1800)]
    # "Varios" sin el detalle de las sesiones no se puede repartir: se descarta, no se inventa.
    assert discarded(response) == {("cardio_without_detail", "cardio_type"): 1}
    assert DayLog.objects.get(date=date(2026, 9, 1)).trained is False


def test_invalid_values_are_discarded_with_their_reason_and_the_rest_of_the_day_stays():
    user = make_user(weight=None)
    bad = (
        "date,weight_kg,sleep_h,intake_kcal,energy,quad,trained,tipo_dia,cardio_sesiones,fc_max\n"
        "2026-10-01,900,7,abc,7,regular,quizá,fiesta,Trote:0,400\n"
        "2026-13-01,80,,,,,,,,\n"
        "2026-11-15,80,,,,,,,,\n"
        "1999-12-31,80,,,,,,,,\n"
    )
    response = upload(client_for(user), ("raro.csv", bad))
    assert response.status_code == 201, response.data
    assert discarded(response) == {
        ("out_of_range", "weight_kg"): 1,
        ("not_a_number", "intake_kcal"): 1,
        ("out_of_range", "energy"): 1,
        ("unknown_value", "quad"): 1,
        ("unknown_value", "trained"): 1,
        ("unknown_value", "tipo_dia"): 1,
        ("cardio_minutes", "cardio"): 1,
        ("out_of_range", "fc_max"): 1,
        ("bad_date", "date"): 1,
        ("future_date", "date"): 1,
        ("too_old", "date"): 1,
    }
    examples = {d["code"]: d["examples"] for d in response.data["discarded"]}
    assert examples["future_date"] == ["2026-11-15"]
    # Del 1 de octubre se queda lo que sí vale: el sueño.
    assert DailyCheckin.objects.get(profile=user.profile).sleep_hours == 7
    assert not BiometricsLog.objects.filter(profile=user.profile).exists()
    assert not Activity.objects.exists()


def test_several_weekly_csvs_at_once_and_a_bad_file_does_not_block_the_others():
    user = make_user(weight=None)
    week2 = CSV_HEADER.replace(",columna_futura", "") + "2026-10-19,81.5,7,,,,,,,,,,,,,,,,,,,,,,,,,,gimnasio,,,,,,,,\n"
    response = upload(client_for(user), ("s1.csv", WEEKLY), ("s2.csv", week2), ("foto.jpg", b"\xff\xd8"), ("vacio.csv", ""))
    assert response.status_code == 201
    assert [(f["name"], f["kind"], f["error"] and f["error"]["code"]) for f in response.data["files"]] == [
        ("s1.csv", "parte_diario_csv", None),
        ("s2.csv", "parte_diario_csv", None),
        ("foto.jpg", None, "unknown_format"),
        ("vacio.csv", None, "empty_file"),
    ]
    assert response.data["days"]["total"] == 3
    assert weight_on(user, date(2026, 10, 19)) == Decimal("81.50")


# ---------------------------------------------------------------- lo que ya hay


def _existing_day(user):
    client = client_for(user)
    client.post("/api/v1/coach/checkin", {"date": "2026-10-20", "weight_kg": 80, "notes": "Rodilla rara"}, format="json")
    return client


def test_preview_lists_new_and_conflicting_days_and_writes_nothing():
    user = make_user(weight=None)
    client = _existing_day(user)
    preview = upload(client, ("copia.json", backup()), dry_run="1")
    assert preview.status_code == 200 and preview.data["dry_run"] is True
    assert preview.data["days"]["new"] == 2 and preview.data["days"]["conflict"] == 1
    assert preview.data["conflicts"] == [{"date": "2026-10-20", "fields": ["weight_kg"]}]
    assert not MealCheck.objects.exists() and not Activity.objects.exists() and not DayLog.objects.exists()
    assert weight_on(user, date(2026, 10, 20)) == Decimal("80.00")


def test_keep_leaves_what_fightlab_has_and_only_fills_the_gaps():
    user = make_user(weight=None)
    client = _existing_day(user)
    response = upload(client, ("copia.json", backup()))
    assert response.data["on_conflict"] == "keep"
    assert weight_on(user, date(2026, 10, 20)) == Decimal("80.00")
    row = DailyCheckin.objects.get(profile=user.profile, date=date(2026, 10, 20))
    # Las notas se suman: la molestia apuntada en FightLab se queda.
    assert row.notes == "Rodilla rara; Buen día; Cuádriceps izquierdo: molestia leve"
    assert row.sleep_hours == 7.5  # faltaba: se rellena


def test_replace_puts_the_file_values_after_confirming():
    user = make_user(weight=None)
    client = _existing_day(user)
    response = upload(client, ("copia.json", backup()), on_conflict="replace")
    assert response.status_code == 201
    assert weight_on(user, date(2026, 10, 20)) == Decimal("81.40")
    assert upload(client, ("copia.json", backup()), on_conflict="otro").data["code"] == "bad_conflict_mode"


def test_a_cardio_session_logged_in_fightlab_is_never_touched():
    user = make_user(weight=None)
    Activity.objects.create(
        profile=user.profile, kind="SPORT", title="Correr", duration_sec=1800,
        started_at=datetime(2026, 10, 20, 18, 0, tzinfo=timezone.utc),
    )
    upload(client_for(user), ("copia.json", backup()), on_conflict="replace")
    assert Activity.objects.filter(profile=user.profile, source="MANUAL").count() == 1


def test_a_changed_cardio_day_is_a_conflict():
    user = make_user(weight=None)
    client = client_for(user)
    upload(client, ("copia.json", backup()))
    data = json.loads(backup())
    data["cardio_sessions"][0]["minutes"] = 30
    keep = upload(client, ("copia.json", json.dumps(data)))
    assert {"date": "2026-10-20", "fields": ["cardio"]} in keep.data["conflicts"]
    assert Activity.objects.get(title="Paseo con la perra").duration_sec == 1500
    upload(client, ("copia.json", json.dumps(data)), on_conflict="replace")
    assert Activity.objects.get(title="Paseo con la perra").duration_sec == 1800
    assert Activity.objects.filter(profile=user.profile).count() == 3


# ---------------------------------------------------------------- flags


def test_with_no_weight_targets_weight_waist_and_kcal_are_not_saved():
    user = make_user(weight=None, screening={"scoff_yes_count": 3})
    response = upload(client_for(user), ("parte.csv", WEEKLY), ("checkins.csv", "date,weight_kg,waist_cm,intake_kcal,sleep_hours,notes\n2026-10-02,70,80,1900,8,\n"))
    assert response.status_code == 201
    assert response.data["weight_blocked"] == {"active": True, "count": 6, "fields": ["intake_kcal", "waist_cm", "weight_kg"]}
    assert not BiometricsLog.objects.filter(profile=user.profile, weight_kg__isnull=False).exists()
    assert not DailyCheckin.objects.filter(profile=user.profile, intake_kcal__isnull=False).exists()
    # El resto sí: sueño, FC en reposo, comidas y cardio.
    assert DailyCheckin.objects.get(profile=user.profile, date=date(2026, 10, 2)).sleep_hours == 8
    assert user.profile.biometrics.get(external_id="checkin:2026-10-12").resting_heart_rate == 54
    assert MealCheck.objects.filter(profile=user.profile).count() == 3


# ---------------------------------------------------------------- archivos del coach


def test_coach_checkins_csv():
    user = make_user(weight=None)
    text = "date,weight_kg,waist_cm,intake_kcal,sleep_hours,notes\n2026-10-01,78.2,84.0,2100.0,7.5,\"Viaje, poco sueño\"\n"
    response = upload(client_for(user), ("checkins.csv", text))
    assert response.data["files"][0]["kind"] == "coach_checkins"
    row = DailyCheckin.objects.get(profile=user.profile)
    assert (row.intake_kcal, row.sleep_hours, row.notes) == (2100, 7.5, "Viaje, poco sueño")
    assert user.profile.biometrics.get(external_id="checkin:2026-10-01").waist_cm == Decimal("84.0")


REVIEW = "tdee_kcal: 2650.5\ntarget_kcal: 2300\nin_deficit: true\n\n- Adherencia: 4 de 4 sesiones (inventado).\n- Peso: bajando 0,3 kg por semana.\n"


def test_coach_review_becomes_an_imported_accepted_review_used_by_the_targets():
    user = make_user()
    client = client_for(user)
    response = upload(client, ("2026-10-25.md", REVIEW))
    assert response.status_code == 201, response.data
    assert response.data["reviews"] == {"total": 1, "new": 1, "conflict": 0, "unchanged": 0, "kept_app": 0, "written": 1}
    review = WeeklyReview.objects.get(profile=user.profile)
    assert (review.source, review.status, review.week_end) == ("import", "accepted", date(2026, 10, 25))
    assert (review.recalibrated_tdee, review.target_kcal, review.in_deficit, review.accepted) == (2650.5, 2300, True, ["calories"])
    assert review.narrative.startswith("- Adherencia") and "tdee_kcal" not in review.narrative
    # Como el `/plan` del coach con `data/reviews/`: su TDEE es el mantenimiento de los objetivos.
    flags = type("F", (), {"no_weight_targets": False, "no_training": False})()
    assert targets.accepted_review(user, flags) == review
    # No es la "última revisión" de la app (no tiene adherencia ni tendencia): sale aparte.
    state = client.get("/api/v1/coach/review").data
    assert state["latest"] is None
    assert state["imported"] == [
        {"id": review.id, "week_end": "2026-10-25", "tdee_kcal": 2650.5, "target_kcal": 2300, "in_deficit": True,
         "text": review.narrative}
    ]

    again = upload(client, ("2026-10-25.md", REVIEW))
    assert again.data["reviews"]["unchanged"] == 1 and WeeklyReview.objects.count() == 1
    changed = upload(client, ("2026-10-25.md", REVIEW.replace("2300", "2200")))
    assert changed.data["reviews"]["conflict"] == 1 and WeeklyReview.objects.get().target_kcal == 2300
    upload(client, ("2026-10-25.md", REVIEW.replace("2300", "2200")), on_conflict="replace")
    assert WeeklyReview.objects.get().target_kcal == 2200


def test_a_review_made_in_the_app_that_week_is_never_replaced():
    user = make_user()
    WeeklyReview.objects.create(profile=user.profile, week_end=date(2026, 10, 25), narrative="De la app")
    response = upload(client_for(user), ("2026-10-25.md", REVIEW), on_conflict="replace")
    assert response.data["reviews"]["kept_app"] == 1
    assert list(WeeklyReview.objects.values_list("source", "narrative")) == [("app", "De la app")]


def test_review_numbers_are_not_saved_with_no_weight_targets_and_bad_names_are_explained():
    user = make_user(weight=None, profile={"date_of_birth": date(2012, 1, 1)})
    response = upload(client_for(user), ("2026-10-25.md", REVIEW), ("revision.md", REVIEW))
    review = WeeklyReview.objects.get(profile=user.profile)
    assert (review.recalibrated_tdee, review.target_kcal, review.in_deficit) == (None, None, None)
    assert response.data["weight_blocked"]["fields"] == ["in_deficit", "target_kcal", "tdee_kcal"]
    assert response.data["files"][1]["error"]["code"] == "review_name"


SESSIONS = (
    "source,start_time,exercise,exercise_index,set_index,set_type,weight_kg,reps,rir,rpe,distance_km,duration_s,session_title,notes\n"
    "hevy_csv,2026-09-03T18:00:00,Bench Press (Barbell),0,0,normal,80.0,6,,8.0,,,Push A,\n"
    "hevy_csv,2026-09-03T18:00:00,Bench Press (Barbell),0,1,normal,80.0,5,,,,,Push A,\n"
    "generic_csv,2026-09-05T00:00:00,Sentadilla,0,0,normal,100.0,5,2.0,,,,Pierna,\n"
)


def test_coach_sessions_csv_goes_through_the_phase_9_importer():
    user = make_user(weight=None)
    client = client_for(user)
    response = upload(client, ("sessions.csv", SESSIONS))
    assert response.data["files"][0]["kind"] == "sets"
    result = response.data["sets"][0]["result"]
    assert result["importer"] == "coach_sessions" and result["sets"]["imported"] == 3 and result["sessions"]["new"] == 2
    assert SetLog.objects.filter(activity__profile=user.profile).count() == 3
    # El mismo `session_id` que una importación de Hevy: no se duplica.
    again = upload(client, ("sessions.csv", SESSIONS))
    assert again.data["sets"][0]["result"]["sets"]["duplicates"] == 3


def test_a_hevy_or_generic_csv_is_also_accepted():
    user = make_user(weight=None)
    response = upload(client_for(user), ("gym.csv", "date,exercise,weight_kg,reps\n2026-09-10,Press banca,70,8\n"))
    assert response.data["sets"][0]["result"]["importer"] == "generic_csv"


# ---------------------------------------------------------------- límites


def test_limits_and_auth():
    from rest_framework.test import APIClient

    assert APIClient().post(URL, {}, format="multipart").status_code == 401
    user = make_user(weight=None)
    client = client_for(user)
    assert upload(client).data["code"] == "missing_file"
    many = [(f"{i}.csv", "date,sleep_h\n") for i in range(61)]
    assert upload(client, *many).data["code"] == "too_many_files"
    big = upload(client, ("grande.csv", b"date,sleep_h\n" + b"2026-10-01,7\n" * 500_000))
    assert big.data["files"][0]["error"]["code"] == "too_large"
    binary = upload(client, ("x.csv", b"date,sleep_h\n\x00\x01"))
    assert binary.data["files"][0]["error"]["code"] == "not_csv"
    latin = upload(client, ("x.csv", "date,notes\n2026-10-01,cañón\n".encode("latin-1")))
    assert latin.data["files"][0]["error"]["code"] == "encoding"


def test_a_user_only_writes_to_their_own_account():
    one, other = make_user(weight=None), make_user(weight=None)
    upload(client_for(one), ("copia.json", backup()))
    assert not DailyCheckin.objects.filter(profile=other.profile).exists()
    assert not MealCheck.objects.filter(profile=other.profile).exists()
