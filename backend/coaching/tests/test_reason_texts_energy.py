"""Plantillas es/en de los motivos de energía, macros, zonas y tendencia (pendiente de la fase 3)."""
import pytest

from coaching.bridge import reason_texts, reasons
from coaching.bridge.reasons import UNKNOWN, parse_reason

from .test_reasons import engine_reasons

# El motivo de menús es de la fase 8.
LATER = {"free_meal_blocked"}


def _body(text: str) -> str:
    return text.split('": ', 1)[1] if '": ' in text else text


def _codes() -> set[str]:
    return (
        {code for _, _, code in reasons.RULE_PATTERNS}
        | {c for _, c in reasons.FREE_PATTERNS}
        | {"protein_per_kg"}
        | reasons.BRIDGE_CODES
    )


def test_every_code_but_menus_has_both_languages():
    missing = {lang: sorted((_codes() - LATER) - set(reason_texts.TEXTS[lang])) for lang in reason_texts.LANGUAGES}
    assert missing == {"es": [], "en": []}


def test_severity_covers_every_template():
    assert set(reason_texts.TEXTS["en"]) == set(reason_texts.SEVERITY)
    assert set(reason_texts.TEXTS["es"]) == set(reason_texts.SEVERITY)
    assert set(reason_texts.SEVERITY.values()) <= {"stop", "refer", "limit", "info"}


def test_english_reproduces_the_engine_text_for_every_reason():
    checked = 0
    for text in engine_reasons():
        reason = parse_reason(text)
        if reason.code == UNKNOWN or reason.code in LATER:
            continue
        assert reason_texts.render(reason, "en") == _body(text), text
        es = reason_texts.render(reason, "es")
        assert es and es != _body(text), text
        checked += 1
    assert checked > 60


def test_spanish_numbers_use_decimal_comma_and_plain_kcal():
    floor = parse_reason(
        'nutrition.md: "Low- and very-low-calorie diets need clinical supervision": '
        "raised to the 1,200 kcal floor; going lower needs clinical supervision"
    )
    assert "1200 kcal" in reason_texts.render(floor, "es")
    assert "1,200 kcal" in reason_texts.render(floor, "en")
    protein = parse_reason('nutrition.md: "Daily protein target for people who lift": 1.6 g/kg/day')
    assert "1,6 g/kg/día" in reason_texts.render(protein, "es")
    assert "1.6 g/kg/day" in reason_texts.render(protein, "en")


@pytest.mark.parametrize("code", ["recalibrate_step", "glp1_low_intake"])
def test_describe_has_text_severity_and_professional_key(code):
    text = {
        "recalibrate_step": 'nutrition.md: "Recalibrate TDEE from the weight trend": one step of 200 kcal '
        "down from the current 2600 kcal; the full target is 1,500 kcal",
        "glp1_low_intake": 'nutrition.md: "GLP-1 users: protein, training and red flags": below 1,800 kcal, '
        "favour nutrient-dense foods and discuss supplements and monitoring with the prescriber",
    }[code]
    info = reason_texts.describe(parse_reason(text), "es")
    assert set(info) == {"text", "professional", "severity"}
    assert "2600" in info["text"] or "1800" in info["text"]


def test_bridge_reasons_render_in_both_languages_with_method_names():
    from coaching.bridge import energy_athletes as ea

    text = f"{ea.TRAINED_RULE}: Cunningham equation from 59.5 kg of fat-free mass (15% body fat by dxa)"
    reason = parse_reason(text)
    assert reason.code == "rmr_cunningham"
    assert reason.params == {"ffm_kg": 59.5, "body_fat_pct": 15.0, "method": "dxa"}
    assert "59.5 kg of fat-free mass (15% body fat by DXA)" in reason_texts.render(reason, "en")
    assert "59,5 kg de masa libre de grasa (15 % de grasa corporal, medida con DXA)" in reason_texts.render(reason, "es")
    unreliable = parse_reason(
        f"{ea.BODY_FAT_RULE}: body fat from smart_scale is not accurate enough for an FFM equation, "
        "so Mifflin-St Jeor is used"
    )
    assert "una báscula doméstica" in reason_texts.render(unreliable, "es")
    convention = parse_reason(
        "FightLab convention: no training until a clinician clears it, so the energy estimate uses "
        "the desk activity level"
    )
    assert convention.code == "no_training_desk_pal" and convention.rule_key is None
