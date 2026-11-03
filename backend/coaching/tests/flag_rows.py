"""Una entrada por fila de la tabla "Flags and what they change" de `docs/safety.md`.

La usan los tests de `reason_texts` (motivos en es y en) y los de la API de seguridad.
Cada fila describe el perfil que dispara la fila, los flags que deben quedar activos y los
códigos de motivo que deben aparecer. Las filas de "(calculator rule)" (65+, cardiopatía,
suelos calóricos) no son flags: llegan con los objetivos de energía (fase 4).
"""
from dataclasses import dataclass, field
from datetime import date

TODAY = date(2026, 10, 29)
ADULT_DOB = date(1990, 5, 1)

# Lo mínimo para que el perfil no dispare flags propios: SCOFF negativo, PAR-Q+ todo NO.
CLEAN_SCREENING = {"scoff_yes_count": 0, "scoff_positive": False, "parq_any_yes": False, "parq_followup_yes": False}


@dataclass(frozen=True)
class Row:
    id: str
    flags: set[str]
    codes: set[str]
    profile: dict = field(default_factory=dict)  # campos de UserProfile
    screening: dict = field(default_factory=dict)  # se aplica sobre CLEAN_SCREENING
    injuries: list[dict] = field(default_factory=list)
    unset: tuple[str, ...] = ()  # claves de CLEAN_SCREENING que se dejan sin contestar


ROWS = [
    Row("under_18", {"no_calorie_targets", "no_deficit", "no_weight_targets", "refer_gp"}, {"under_18"},
        profile={"date_of_birth": date(2010, 1, 1)}),
    Row("scoff_count", {"no_deficit", "no_weight_targets", "refer_gp"}, {"eating_disorder_screen"},
        screening={"scoff_yes_count": 2}),
    Row("scoff_warning_sign", {"no_deficit", "no_weight_targets", "refer_gp"}, {"eating_disorder_screen"},
        screening={"scoff_yes_count": 1, "scoff_positive": True}),
    Row("glp1", {"no_deficit", "prescriber_owns_weight"}, {"glp1_prescriber"},
        profile={"medications": ["glp1"]}),
    Row("glp1_planning_pregnancy", {"no_deficit", "prescriber_owns_weight", "refer_gp"},
        {"glp1_prescriber", "pregnancy_glp1"},
        profile={"medications": ["glp1"], "conditions": ["planning_pregnancy"], "gender": "FEMALE"}),
    Row("beta_blocker", {"use_rpe_not_hr"}, {"beta_blocker_rpe"}, profile={"medications": ["beta_blocker"]}),
    Row("pregnancy",
        {"no_deficit", "no_weight_targets", "prescriber_owns_weight", "use_rpe_not_hr", "refer_gp"},
        {"pregnancy_no_deficit", "pregnancy_activity", "pregnancy_intensity"},
        profile={"conditions": ["pregnant"], "gender": "FEMALE"}),
    Row("menstrual_irregular", {"hold_deficit", "refer_gp"}, {"menstrual_irregular"},
        profile={"gender": "FEMALE"}, screening={"menstrual": "irregular_new"}),
    Row("menstrual_absent", {"no_deficit", "refer_gp"}, {"menstrual_absent"},
        profile={"gender": "FEMALE"}, screening={"menstrual": "absent"}),
    Row("parq_followup_yes",
        {"refer_gp", "hold_progression", "review_before_vigorous", "no_all_out_sprints"},
        {"parq_followup", "parq_no_sprints", "parq_review_vigorous"},
        screening={"parq_any_yes": True, "parq_followup_yes": True}),
    Row("parq_unanswered", {"review_before_vigorous", "no_all_out_sprints"},
        {"parq_no_sprints", "parq_unanswered_light"}, unset=("parq_any_yes", "parq_followup_yes")),
    Row("parq_any_yes", {"review_before_vigorous", "no_all_out_sprints"},
        {"parq_no_sprints", "parq_review_vigorous"}, screening={"parq_any_yes": True}),
    Row("aged_45", {"review_before_vigorous"}, {"parq_review_vigorous"},
        profile={"date_of_birth": date(1980, 1, 1)}),
    Row("parq_any_yes_reviewed", {"no_all_out_sprints"}, {"parq_no_sprints"},
        screening={"parq_any_yes": True, "vigorous_reviewed": True}),
    Row("injury_assessed", set(), {"injury_managed"},
        injuries=[{"area": "hombro derecho", "status": "active", "since": date(2026, 9, 1),
                   "professional": "fisioterapeuta", "exercises": ["Press banca"]}]),
    Row("injury_unassessed", {"refer_gp"}, {"injury_unassessed"},
        injuries=[{"area": "rodilla", "status": "active", "exercises": ["Sentadilla"]}]),
    Row("cardiac", {"no_training", "hold_progression", "refer_gp"}, {"cardiac_symptoms"},
        screening={"cardiac_symptoms": True}),
    Row("bp_200_110", {"no_training", "hold_progression", "refer_gp"}, {"bp_no_exercise"},
        screening={"bp_systolic": 205, "bp_diastolic": 112}),
    Row("bp_180", {"no_training", "hold_progression", "refer_gp"}, {"bp_no_training"},
        screening={"bp_systolic": 182, "bp_diastolic": 95}),
    Row("bp_160", {"cap_moderate", "hold_progression", "refer_gp"}, {"bp_gp_review"},
        screening={"bp_systolic": 165, "bp_diastolic": 85}),
    Row("bp_diastolic_90", {"cap_moderate", "hold_progression", "refer_gp"}, {"bp_gp_review"},
        screening={"bp_systolic": 130, "bp_diastolic": 92}),
    Row("hypertension_bp_unknown", {"cap_moderate", "hold_progression", "refer_gp"}, {"bp_unknown_hypertension"},
        profile={"conditions": ["hypertension"]}),
    Row("bp_140", {"cap_moderate", "refer_gp"}, {"bp_moderate"},
        screening={"bp_systolic": 145, "bp_diastolic": 85}),
]

BOOL_FLAGS = {
    "no_deficit", "no_weight_targets", "hold_deficit", "use_rpe_not_hr", "prescriber_owns_weight",
    "refer_gp", "no_training", "cap_moderate", "no_calorie_targets", "hold_progression",
    "review_before_vigorous", "no_all_out_sprints",
}


def screening_for(row: Row) -> dict:
    values = {**CLEAN_SCREENING, **row.screening}
    for key in row.unset:
        values.pop(key)
    return values


def coach_profile_for(row: Row):
    """El `coach.profile.Profile` de la fila, sin pasar por la BD."""
    from coach.profile import Profile

    sex = {"FEMALE": "female", "MALE": "male"}.get(row.profile.get("gender", "MALE"))
    return Profile(
        sex=sex,
        birth_date=row.profile.get("date_of_birth", ADULT_DOB),
        height_cm=175,
        weight_kg=70.0,
        medications=list(row.profile.get("medications", [])),
        conditions=list(row.profile.get("conditions", [])),
        screening=screening_for(row),
        injuries=[{k: v for k, v in i.items()} for i in row.injuries],
    )
