"""Paridad con la CLI del motor (aceptación de la fase 4): los mismos números para 3 perfiles.

Perfiles sin ecuación de atletas ni `no_training` (U04 y U06 se comprueban aparte). El perfil
de FightLab se guarda como `profile.yaml` y se pasa por `python -m coach energy|macros|zones`.
"""
import json
from datetime import date

import pytest
from coach import cli
from coach.profile import save_profile

from coaching.bridge.adapters import to_coach_profile

from .helpers import TODAY, client_for, fix_today, make_user

pytestmark = pytest.mark.django_db

PROFILES = {
    "hombre_mantenimiento": dict(profile={"activity_level": "desk", "goal": "maintenance"}, weight=78.0),
    "mujer_perdida_grasa": dict(
        profile={"gender": "FEMALE", "goal": "fat_loss", "activity_level": "active", "height_cm": 165,
                 "date_of_birth": date(1988, 3, 14)},
        weight=71.0,
        # una báscula doméstica no es fiable: sigue Mifflin-St Jeor, igual que el motor
        body_fat=28.0, body_fat_method="smart_scale", resting_hr=58,
    ),
    "hombre_ganancia_con_suelo_de_grasa": dict(
        profile={"goal": "muscle_gain", "activity_level": "desk", "height_cm": 190,
                 "date_of_birth": date(1999, 8, 2)},
        weight=95.0, resting_hr=64,
    ),
}


def run_cli(tmp_path, capsys, *argv):
    assert cli.main(["--data-dir", str(tmp_path), "--today", TODAY.isoformat(), *argv, "--json"]) == 0
    return json.loads(capsys.readouterr().out)


@pytest.fixture(params=sorted(PROFILES))
def case(request, tmp_path, capsys):
    user = make_user(**PROFILES[request.param])
    save_profile(to_coach_profile(user, TODAY), tmp_path / "profile.yaml")
    with fix_today():
        api = client_for(user).get("/api/v1/coach/targets")
        zones_api = client_for(user).get("/api/v1/coach/zones")
    assert api.status_code == 200, api.data
    return user, tmp_path, capsys, api.data, zones_api.data


def test_energy_matches_the_cli(case):
    _, tmp_path, capsys, api, _ = case
    out = run_cli(tmp_path, capsys, "energy")
    assert api["equation"]["code"] == "mifflin_st_jeor"
    assert api["equation"]["rmr_kcal"] == out["rmr"]
    assert api["kcal"] == out["target"]["kcal"]
    assert api["maintenance_kcal"] == round(out["target"]["maintenance"])
    assert api["deficit_kcal"] == out["target"]["deficit"]
    assert api["clamped"] == out["target"]["clamped"]


def test_macros_match_the_cli(case):
    _, tmp_path, capsys, api, _ = case
    out = run_cli(tmp_path, capsys, "macros")
    assert api["in_deficit"] == out["in_deficit"]
    assert api["macros"] == {
        "protein_g": out["protein_g"],
        "fat_g": out["fat_g"],
        "fat_min_g": out["fat_min_g"],
        "carbs_g": out["carbs_g"],
        "fibre_g": out["fibre_g"],
        "protein_g_per_kg": out["protein_g_per_kg"],
    }


def test_zones_match_the_cli(case):
    user, tmp_path, capsys, _, zones_api = case
    rest = user.profile.biometrics.exclude(resting_heart_rate=None).first()
    args = ["--hr-rest", str(rest.resting_heart_rate)] if rest else []
    out = run_cli(tmp_path, capsys, "zones", *args)
    assert zones_api["method"] == out["method"]
    assert zones_api["hr_max"] == out["hr_max"] and zones_api["hr_rest"] == out["hr_rest"]
    assert [(z["name"], z["rpe"], z["bpm"]) for z in zones_api["zones"]] == [
        (z["name"], list(z["rpe"]), list(z["bpm"]) if z["bpm"] else None) for z in out["zones"]
    ]
