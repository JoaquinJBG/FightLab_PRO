"""`GET /coach/session-check`: aviso al registrar a mano una sesión vigorosa (spec §8.2)."""
import re

import pytest

from coaching import rules, session_check

from .helpers import client_for, make_user, today_fixed  # noqa: F401
from .test_rules import _headings

pytestmark = pytest.mark.django_db

REVIEW = {"parq_any_yes": True}  # algún SÍ en el PAR-Q+ y sin revisión: review_before_vigorous
NO_TRAINING = {"cardiac_symptoms": True}
CAP = {"bp_systolic": 145, "bp_diastolic": 80}  # cap_moderate


def check(user, **params):
    response = client_for(user).get("/api/v1/coach/session-check", params)
    assert response.status_code == 200, response.data
    return response.data


def keys(data):
    return [m["key"] for m in data["modalities"]]


def test_the_effort_rule_exists_in_the_knowledge():
    file, heading = re.fullmatch(r'([\w-]+\.md): "(.+)"', session_check.EFFORT_SCALE).groups()
    assert heading in _headings(file)


def test_clean_profile_never_warns(today_fixed):
    data = check(make_user(), kind="MMA", work_type="Sparring", art="Boxeo", rpe=9)
    assert keys(data) == ["sparring_hard"]
    assert data["warn"] is False and data["flags"] == [] and data["reasons"] == []


@pytest.mark.parametrize(
    ("params", "modality"),
    [
        ({"kind": "MMA", "work_type": "Sparring", "art": "Boxeo", "rpe": 8}, "sparring_hard"),
        ({"kind": "MMA", "work_type": "Sparring", "art": "BJJ", "rpe": 8}, "rolling_hard"),
        ({"kind": "MMA", "work_type": "Pads", "art": "Muay Thai", "rpe": 7}, "pads_hard"),
        ({"kind": "MMA", "work_type": "Acondicionamiento", "art": "MMA", "rpe": 9}, "hiit"),
        ({"kind": "SPORT", "sport_key": "rope"}, "jump_rope"),
        ({"kind": "SPORT", "sport_key": "run", "sport_format": "hiit"}, "hiit"),
        ({"kind": "SPORT", "sport_key": "bike", "sport_format": "sprints"}, "sprints"),
        ({"kind": "GYM", "includes": ["one_rm_test"]}, "one_rm_test"),
        ({"kind": "GYM", "includes": ["plyometrics"]}, "plyometrics"),
    ],
)
def test_vigorous_sessions_warn_with_review_before_vigorous(today_fixed, params, modality):
    data = check(make_user(screening=REVIEW), **params)
    assert keys(data) == [modality]
    assert data["warn"] is True
    assert "review_before_vigorous" in data["flags"]
    assert data["blocks_saving"] is False  # el registro de lo ya hecho no se bloquea
    assert [r["code"] for r in data["reasons"]] == ["parq_review_vigorous"]
    assert all(r["text"] for r in data["reasons"])


@pytest.mark.parametrize(
    "params",
    [
        {"kind": "MMA", "work_type": "Sparring", "art": "Boxeo", "rpe": 5},
        {"kind": "MMA", "work_type": "Técnica", "art": "Boxeo", "rpe": 9},
        {"kind": "MMA", "work_type": "Drilling", "art": "Karate", "rpe": 4},
        {"kind": "SPORT", "sport_key": "run", "sport_format": "continuous"},
        {"kind": "SPORT", "sport_key": "walk"},
        {"kind": "GYM"},
    ],
)
def test_moderate_sessions_do_not_warn(today_fixed, params):
    assert check(make_user(screening=REVIEW), **params)["warn"] is False


def test_sprints_warn_for_the_review_only(today_fixed):
    """`no_all_out_sprints` es para SIT y REHIT (`rules.py`); los sprints los para la revisión."""
    data = check(make_user(screening=REVIEW), kind="SPORT", sport_key="run", sport_format="sprints")
    assert data["modalities"][0]["intensity"] == "maximal"
    assert data["flags"] == ["review_before_vigorous"]
    assert [r["code"] for r in data["reasons"]] == ["parq_review_vigorous"]


def test_no_training_warns_with_its_reason(today_fixed):
    data = check(make_user(screening=NO_TRAINING), kind="MMA", work_type="Sparring", art="Boxeo", rpe=8)
    assert data["warn"] is True and "no_training" in data["flags"]
    assert "cardiac_symptoms" in [r["code"] for r in data["reasons"]]
    # La regla de la modalidad va con su chip.
    assert data["modalities"][0]["rule_key"].startswith("combat-sports/")


def test_cap_moderate_warns(today_fixed):
    data = check(make_user(screening=CAP), kind="SPORT", sport_key="rope")
    assert data["flags"] == ["cap_moderate"]
    assert [r["code"] for r in data["reasons"]] == ["bp_moderate"]


def test_rpe_basis_is_a_fightlab_convention_in_combat(today_fixed):
    data = check(make_user(), kind="MMA", work_type="Sparring", art="Boxeo", rpe=8)
    assert data["rpe_basis"]["threshold"] == session_check.VIGOROUS_RPE == 7
    assert data["rpe_basis"]["convention"] == "fightlab"
    assert data["rpe_basis"]["rule_key"].startswith("cardio-health/")
    assert check(make_user(), kind="SPORT", sport_key="rope")["rpe_basis"] is None


def test_without_rpe_sparring_counts_as_hard(today_fixed):
    assert keys(check(make_user(), kind="MMA", work_type="Sparring", art="Boxeo")) == ["sparring_hard"]


def test_every_mapped_modality_exists():
    for work in ("Sparring", "Pads", "Saco", "Drilling", "Técnica", "Acondicionamiento"):
        for art in ("Boxeo", "BJJ"):
            for rpe in (None, 3, 9):
                found, _ = session_check.modalities_for("MMA", work_type=work, art=art, rpe=rpe)
                assert all(k in rules.MODALITY_INTENSITY for k in found)


def test_bad_parameters(today_fixed):
    client = client_for(make_user())
    assert client.get("/api/v1/coach/session-check", {"kind": "FOO"}).status_code == 400
    assert client.get("/api/v1/coach/session-check", {"kind": "SPORT", "sport_format": "x"}).status_code == 400
