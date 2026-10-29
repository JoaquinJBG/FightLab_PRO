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
    return {code for _, _, code in reasons.RULE_PATTERNS} | {c for _, c in reasons.FREE_PATTERNS} | {"protein_per_kg"}


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
