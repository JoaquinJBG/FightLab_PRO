"""Catálogo de motivos es/en (Task 3.5): un perfil por fila de la tabla de flags."""
import pytest
from coach import safety

from coaching.bridge import reason_texts
from coaching.bridge.reasons import UNKNOWN, Reason, parse_reason

from .flag_rows import ROWS, TODAY, coach_profile_for


def _body(text: str) -> str:
    """El texto del motor tras `archivo.md: "Encabezado": `."""
    return text.split('": ', 1)[1]


@pytest.mark.parametrize("row", ROWS, ids=lambda r: r.id)
def test_every_flag_row_reason_has_both_languages(row):
    flags = safety.flags(coach_profile_for(row), TODAY)
    reasons = [parse_reason(text) for text in flags.reasons]
    assert row.codes <= {r.code for r in reasons}, flags.reasons
    for reason in reasons:
        assert reason.code != UNKNOWN, reason.original_text
        assert reason.rule_key, reason.original_text
        for lang in reason_texts.LANGUAGES:
            assert reason.code in reason_texts.TEXTS[lang], (lang, reason.code)
        # En inglés se reproduce el texto original del motor.
        assert reason_texts.render(reason, "en") == _body(reason.original_text)
        es = reason_texts.render(reason, "es")
        assert es and es != _body(reason.original_text), reason.code


def test_both_catalogs_have_the_same_codes():
    assert set(reason_texts.TEXTS["es"]) == set(reason_texts.TEXTS["en"])
    assert set(reason_texts.TEXTS["en"]) == set(reason_texts.SEVERITY)


@pytest.mark.parametrize("row", ROWS, ids=lambda r: r.id)
def test_professional_and_severity(row):
    flags = safety.flags(coach_profile_for(row), TODAY)
    for reason in map(parse_reason, flags.reasons):
        info = reason_texts.describe(reason, "es")
        assert info["severity"] in ("stop", "refer", "limit")
        if info["severity"] == "stop":
            assert flags.no_training
        if info["severity"] in ("stop", "refer"):
            assert info["professional"], reason.code


def test_injury_professional_is_the_named_one():
    reason = Reason("injury_managed", "recovery-habits/x", {"area": "hombro", "professional": "fisio"}, "")
    assert reason_texts.describe(reason, "en")["professional"] == "fisio"


def test_unknown_reason_falls_back_to_the_original_text():
    text = 'nutrition.md: "Some heading": something new from the engine'
    reason = parse_reason(text)
    assert reason.code == UNKNOWN
    assert reason_texts.render(reason, "es") == "something new from the engine"


def test_language_fallback_is_spanish():
    reason = parse_reason(safety.flags(coach_profile_for(ROWS[0]), TODAY).reasons[0])
    assert reason_texts.render(reason, "fr") == reason_texts.render(reason, "es")


def test_deferral_line_is_copied_from_docs_safety():
    """Literal de `docs/safety.md`, en los dos idiomas (se lee del archivo del motor)."""
    text = reason_texts.SAFETY_DOC.read_text(encoding="utf-8")
    assert reason_texts.DEFERRAL_LINE["es"].startswith("Esto es orientación general de un entrenador automatizado")
    assert reason_texts.DEFERRAL_LINE["en"].startswith("This is general guidance from an automated coach")
    for line in reason_texts.DEFERRAL_LINE.values():
        assert f"`{line}`" in text


def test_disclaimer_is_the_first_sentence_of_the_deferral_line():
    assert reason_texts.DISCLAIMER["es"] == (
        "Esto es orientación general de un entrenador automatizado, no consejo médico."
    )
    assert reason_texts.DISCLAIMER["en"] == "This is general guidance from an automated coach, not medical advice."
