"""U04: ecuaciones de RMR para atletas (ten Haaf, Cunningham) en el puente."""
from datetime import date

import pytest
from coach import energy
from coach.profile import Profile

from coaching.bridge import energy_athletes as ea
from coaching.bridge.reasons import parse_reason

TODAY = date(2026, 10, 29)


def athlete(**kw):
    base = dict(
        sex="male", birth_date=date(2000, 5, 1), height_cm=175, weight_kg=70, goal="maintenance",
        activity_level="desk_training", screening={"scoff_yes_count": 0, "parq_any_yes": False},
    )
    return Profile(**{**base, **kw})


def bf(pct=15.0, method="dxa", day=date(2026, 10, 1), weight=None):
    return ea.BodyFat(pct=pct, method=method, date=day, weight_kg=weight)


def test_ten_haaf_matches_the_formula_of_the_rule():
    p = athlete()
    age = p.age(TODAY)
    kj = 49.940 * 70 + 2459.053 * 1.75 - 34.014 * age + 799.257 + 122.502
    assert ea.ten_haaf_rmr(p, TODAY) == pytest.approx(kj / 4.184)
    # mujer: sin el término de sexo
    f = athlete(sex="female")
    assert ea.ten_haaf_rmr(f, TODAY) == pytest.approx((kj - 799.257) / 4.184)


def test_cunningham_is_500_plus_22_per_kg_of_ffm():
    assert ea.cunningham_rmr(60.0) == pytest.approx(500 + 22 * 60)


def test_reliable_body_fat_uses_cunningham_from_the_ffm():
    choice = ea.choose_rmr(athlete(), bf(pct=15, method="dxa"), TODAY)
    assert choice.equation == "cunningham"
    assert choice.ffm_kg == pytest.approx(70 * 0.85)
    assert choice.rmr_kcal == pytest.approx(500 + 22 * 70 * 0.85)
    codes = [parse_reason(n).code for n in choice.notes]
    assert "rmr_cunningham" in codes
    assert choice.rule_key == "nutrition/trained-clients-cunningham-or-ten-haaf"


def test_ffm_uses_the_weight_of_the_same_measurement_when_it_has_one():
    choice = ea.choose_rmr(athlete(weight_kg=70), bf(pct=20, weight=75.0), TODAY)
    assert choice.ffm_kg == pytest.approx(75 * 0.8)


@pytest.mark.parametrize("method", ["smart_scale", "", None, "other"])
def test_unreliable_body_fat_falls_back_to_msj_and_says_why(method):
    p = athlete()
    choice = ea.choose_rmr(p, bf(method=method), TODAY)
    assert choice.equation == "mifflin_st_jeor"
    assert choice.rmr_kcal == pytest.approx(energy.rmr_mifflin(p, TODAY))
    reason = parse_reason(next(n for n in choice.notes if "Body-fat" in n))
    assert reason.code == "body_fat_unreliable"
    assert reason.rule_key == "nutrition/body-fat-measurement-error-carries-into-rmr"
    assert choice.rule_key == "nutrition/default-rmr-equation-mifflin-st-jeor"


def test_old_body_fat_is_ignored_like_no_body_fat():
    choice = ea.choose_rmr(athlete(), bf(day=date(2026, 5, 1)), TODAY)  # > 90 días
    assert choice.equation == "ten_haaf"


def test_trained_client_without_body_composition_uses_ten_haaf():
    choice = ea.choose_rmr(athlete(), None, TODAY)
    assert choice.equation == "ten_haaf"
    assert choice.ffm_kg is None
    assert "rmr_ten_haaf" in [parse_reason(n).code for n in choice.notes]


@pytest.mark.parametrize(
    "kw",
    [
        {"activity_level": "desk"},  # no entrena con regularidad
        {"weight_kg": 100, "height_cm": 170},  # IMC >= 30: la regla de obesidad lo excluye
        {"birth_date": date(1955, 1, 1)},  # mayores: la regla no lo generaliza
    ],
)
def test_outside_the_population_of_the_rule_uses_msj(kw):
    p = athlete(**kw)
    for body in (None, bf()):
        choice = ea.choose_rmr(p, body, TODAY)
        assert choice.equation == "mifflin_st_jeor"
        assert choice.rmr_kcal == pytest.approx(energy.rmr_mifflin(p, TODAY))
        assert choice.notes == []


def test_the_chosen_rmr_goes_through_calorie_target_as_tdee():
    """El RMR de atleta × PAL del motor entra como `tdee_kcal`: suelos y bloqueos siguen vigentes."""
    from coach import safety

    p = athlete(goal="fat_loss")
    flags = safety.flags(p, TODAY)
    choice = ea.choose_rmr(p, None, TODAY)
    target = energy.calorie_target(p, flags, today=TODAY, tdee_kcal=choice.rmr_kcal * energy.pal(p))
    assert target.maintenance == pytest.approx(choice.rmr_kcal * energy.pal(p))
    assert target.deficit == 500
