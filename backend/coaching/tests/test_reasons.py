import re
from datetime import date
from pathlib import Path

import pytest
from coach import energy, macros, mealplan, safety, strength, trend, zones
from coach.profile import Profile, ProfileIncomplete

from coaching.bridge.reasons import REFERENCE_RE, Reason, parse_reason
from coaching.models import KnowledgeRule

TODAY = date(2026, 10, 29)
ENGINE_DIR = Path(safety.__file__).resolve().parent


def make_profile(**kw):
    base = dict(
        sex="female",
        birth_date=date(1990, 5, 1),
        height_cm=165,
        weight_kg=70,
        goal="fat_loss",
        activity_level="desk_training",
        screening={"scoff_yes_count": 0, "parq_any_yes": False},
    )
    screening = {**base["screening"], **kw.pop("screening", {})}
    return Profile(**{**base, **kw, "screening": screening})


def test_parse_with_rule_and_text():
    r = parse_reason('nutrition.md: "Default RMR equation: Mifflin-St Jeor": about 1500 kcal')
    assert r == Reason(
        "unknown", "nutrition/default-rmr-equation-mifflin-st-jeor", {}, r.original_text
    )  # sin patrón para esa regla: unknown, pero con su regla


def test_parse_extracts_params():
    r = parse_reason(f"{safety.BP}: 165/95, GP review before starting or progressing; light-to-moderate work only")
    assert r.code == "bp_gp_review"
    assert r.rule_key == "recovery-habits/resting-bp-thresholds-to-defer-or-refer"
    assert r.params == {"systolic": 165, "diastolic": 95}


def test_parse_bp_with_missing_number():
    r = parse_reason(f"{safety.BP}: 185/?, no training until reviewed by a GP")
    assert r.code == "bp_no_training"
    assert r.params == {"systolic": 185, "diastolic": None}


def test_parse_injury_area_and_professional():
    r = parse_reason(f"{safety.INJURY}: right shoulder injury, managed by physio: no progression; reduce")
    assert r.code == "injury_managed"
    assert r.params == {"area": "right shoulder", "professional": "physio"}


def test_parse_kcal_with_thousands_separator():
    r = parse_reason(f"{energy.FLOOR_RULE}: raised to the 1,200 kcal floor; going lower needs clinical supervision")
    assert (r.code, r.params) == ("floor_raised", {"floor_kcal": 1200})


def test_parse_protein_note():
    r = parse_reason('nutrition.md: "Protein during fat loss": 2 g/kg/day')
    assert (r.code, r.params["per_kg"]) == ("protein_per_kg", 2.0)
    assert r.rule_key == "nutrition/protein-during-fat-loss"


def test_parse_rule_in_parentheses():
    with pytest.raises(ValueError) as exc:
        energy.tdee(make_profile(), multiplier=1.2, today=TODAY)
    r = parse_reason(str(exc.value))
    assert r.code == "pal_too_low"
    assert r.rule_key == "nutrition/activity-multipliers-pal"
    assert r.params == {"pal": 1.2}


def test_parse_plain_reason_has_no_rule():
    r = parse_reason("no weigh-ins")
    assert (r.code, r.rule_key) == ("no_weigh_ins", None)


def test_unknown_reason_keeps_text_and_is_logged(caplog):
    with caplog.at_level("WARNING"):
        r = parse_reason("something the engine never said")
    assert (r.code, r.rule_key, r.original_text) == ("unknown", None, "something the engine never said")
    assert "sin plantilla" in caplog.text


# --- el contrato con el motor ---------------------------------------------------------


def engine_reasons() -> list[str]:
    """Todos los motivos que el motor produce para un abanico de perfiles."""
    out: list[str] = []

    def add(*items):
        out.extend(items)

    def guarded(fn, *a, **k):
        try:
            return fn(*a, **k)
        except ValueError as exc:
            add(str(exc))
        except ProfileIncomplete:
            pass

    profiles = [
        make_profile(),
        make_profile(birth_date=date(2012, 1, 1)),  # menor de 18
        make_profile(birth_date=date(1950, 1, 1)),  # 65+
        make_profile(birth_date=date(1975, 1, 1)),  # 45+
        make_profile(screening={"scoff_yes_count": 3}),
        make_profile(medications=["glp1"]),
        make_profile(medications=["glp1"], conditions=["pregnant"]),
        make_profile(medications=["beta_blocker"]),
        make_profile(medications=["beta_blocker"], conditions=["pregnant"]),
        make_profile(conditions=["pregnant"]),
        make_profile(conditions=["heart_disease"]),
        make_profile(conditions=["hypertension"]),
        make_profile(screening={"menstrual": "irregular_new"}),
        make_profile(screening={"menstrual": "absent"}),
        make_profile(screening={"parq_any_yes": True}),
        make_profile(screening={"parq_any_yes": True, "parq_followup_yes": True}),
        make_profile(screening={"cardiac_symptoms": True}),
        make_profile(screening={"bp_systolic": 210, "bp_diastolic": 100}),
        make_profile(screening={"bp_systolic": 185}),
        make_profile(screening={"bp_systolic": 165, "bp_diastolic": 80}),
        make_profile(screening={"bp_systolic": 145, "bp_diastolic": 80}),
        make_profile(
            injuries=[
                {"area": "right shoulder", "status": "active", "professional": "physio", "exercises": ["Bench"]},
                {"area": "left knee", "status": "active", "exercises": ["Squat"]},
            ]
        ),
    ]
    profiles += [
        make_profile(weight_kg=120, height_cm=165),  # BMI >= 30: proteína desde el peso de referencia
        Profile(sex="male", birth_date=date(1955, 1, 1), height_cm=165, weight_kg=55, goal="maintenance",
                activity_level="desk", medications=["glp1"], screening={"scoff_yes_count": 0, "parq_any_yes": False}),
        make_profile(weight_kg=100, height_cm=190),  # proteína y grasa mínimas superan las kcal: carbs a 0
    ]
    unscreened = Profile(sex="male", birth_date=date(1990, 1, 1), height_cm=180, weight_kg=80, goal="fat_loss",
                         activity_level="desk")
    profiles.append(unscreened)
    for p in profiles:
        flags = safety.flags(p, TODAY)
        add(*flags.reasons)
        for goal in ("fat_loss", "muscle_gain", "maintenance"):
            p2 = Profile(**{**p.__dict__, "goal": goal})
            t = guarded(energy.calorie_target, p2, flags, today=TODAY)
            if t:
                add(*t.notes)
        t = guarded(energy.calorie_target, p, flags, today=TODAY, tdee_kcal=2000, current_kcal=2600,
                    recalibrated=True)
        if t:
            add(*t.notes)
        t = guarded(energy.calorie_target, p, flags, today=TODAY, current_kcal=1500)
        if t:
            add(*t.notes)
        m = guarded(macros.macro_targets, p, 1000, True, TODAY)
        if m:
            add(*m.notes)
        m = guarded(macros.macro_targets, p, 1250, False, TODAY)
        if m:
            add(*m.notes)
        for in_def in (False, True):
            m = guarded(macros.macro_targets, p, 2500, in_def, TODAY)
            if m:
                add(*m.notes)
        for kwargs in ({}, {"hr_rest": 60, "hr_max": 190}):
            z = guarded(zones.hr_zones, p, flags, today=TODAY, **kwargs)
            if z:
                add(*z.notes)
        add(*trend.weight_trend([], flags).notes)
        add(*trend.weight_trend([(date(2026, 10, 28), 70.0)], None).notes)
    add(*trend.weight_trend([(date(2026, 10, 28), 70.0), (date(2026, 10, 29), 70.0)], None).notes)
    guarded(energy.tdee, profiles[0], 2.5, TODAY)
    guarded(energy.tdee, profiles[0], 1.2, TODAY)
    return out


def test_every_reason_the_engine_produces_is_understood():
    reasons = engine_reasons()
    assert len(reasons) > 60
    unknown = sorted({r for r in reasons if parse_reason(r).code == "unknown"})
    assert unknown == []


def test_every_rule_literal_resolves_to_a_pattern_or_is_a_known_unused_rule():
    """Cada literal de regla de safety/energy/zones/mealplan tiene un código (o es de otra fase)."""
    from coaching.bridge import reasons

    literals = {
        v
        for mod in (safety, energy, zones, mealplan)
        for v in vars(mod).values()
        if isinstance(v, str) and re.fullmatch(r'[\w-]+\.md: "[^"]+"', v)
    }
    covered = {reasons.heading_of(rule) for rule, _, _ in reasons.RULE_PATTERNS} | reasons.INLINE_RULE_HEADINGS
    # RPE_REASON_RULES y BANDS... son tuplas/consts ya cubiertas; PARQ_THRESHOLDS/etc. también
    missing = {reasons.heading_of(v) for v in literals} - covered
    # Reglas de apoyo que el motor solo cita en comentarios o como prefijo de filtro
    assert missing == set(), missing


@pytest.mark.django_db
def test_every_rule_cited_by_the_engine_exists_as_a_knowledge_rule(real_knowledge):
    """Si el autor renombra un encabezado, este test lo detecta (spec §7.3)."""
    keys = set(KnowledgeRule.objects.values_list("key", flat=True))
    headings = {}
    # 1) los literales *_RULE y PARQ/BP/... de los módulos del motor
    for mod in (safety, energy, zones, mealplan, strength):
        for name, v in vars(mod).items():
            if isinstance(v, str) and re.fullmatch(r'[\w-]+\.md: "[^"]+"', v):
                headings[f"{mod.__name__}.{name}"] = v
    assert len(headings) >= 25
    # 2) cualquier `archivo.md: "Encabezado"` escrito en el código del motor
    for path in ENGINE_DIR.glob("*.py"):
        for m in REFERENCE_RE.finditer(path.read_text(encoding="utf-8")):
            if m.group("heading").endswith("...") or "{" in m.group("heading"):
                continue  # referencia abreviada en un comentario, o plantilla de f-string
            headings[f"{path.name}:{m.group(0)}"] = m.group(0)
    for where, literal in headings.items():
        assert parse_reason(literal).rule_key in keys, f"{where}: {literal}"


@pytest.mark.django_db
def test_every_parsed_engine_reason_points_to_an_existing_rule(real_knowledge):
    keys = set(KnowledgeRule.objects.values_list("key", flat=True))
    for text in engine_reasons():
        r = parse_reason(text)
        if r.rule_key:
            assert r.rule_key in keys, text


def test_every_code_is_reachable_from_the_engine():
    """Ninguna plantilla de `reasons.py` es letra muerta: el motor produce un motivo para cada una."""
    from coaching.bridge import reasons

    seen = {parse_reason(r).code for r in engine_reasons()}
    seen.add(parse_reason(f"{mealplan.FREE_MEAL_RULE}: no free meal after a positive eating-disorder screen").code)
    expected = {code for _, _, code in reasons.RULE_PATTERNS} | {c for _, c in reasons.FREE_PATTERNS}
    expected.add("protein_per_kg")
    assert expected - seen == set()
    # Los motivos del puente (U04, U06) no salen del motor: no pueden ser letra muerta, pero se
    # comprueban en `test_energy_athletes.py` y `test_targets_api.py`.
    assert not (reasons.BRIDGE_CODES & seen)
