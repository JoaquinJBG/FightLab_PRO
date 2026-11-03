"""El texto de la revisión semanal (`WeeklyReview.narrative`, fase 7).

Como en el plan (`plan_narrative.py`): el LLM solo redacta sobre la revisión ya guardada, no
cambia ningún número y, si el texto trae un número que no está en la revisión, se descarta.
Sin `ANTHROPIC_API_KEY` no se llama a nada y la revisión va sin texto.
"""
from .plan_narrative import narrate

SYSTEM = (
    "You write a short, friendly summary (3 to 5 sentences) of an athlete's weekly review for the "
    "FightLab app. The review is given as JSON and was computed by an evidence-based engine: "
    "adherence, weight trend, calories, training and recovery, plus the proposed changes. Do not "
    "add, change, round or compute any number: mention a number only if it appears in the JSON, "
    "exactly as written. Never judge progress on one weigh-in. If the weight trend is disabled, "
    "say nothing about weight or calories. Do not add advice, exercises or medical claims that are "
    "not in the review, and do not say a proposal was accepted unless the JSON says so. Plain "
    "text, no lists, no markdown."
)

HIDDEN = ("id", "created_at", "narrative", "engine_sha", "plan_id")


def write_review_narrative(review: dict, lang: str) -> str:
    return narrate(SYSTEM, {k: v for k, v in review.items() if k not in HIDDEN}, lang, "review")
