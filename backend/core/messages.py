"""Mensajes propios del backend para el usuario, en español e inglés.

Sin gettext ni compilemessages: el idioma sale de `get_language()`, que fija
`LocaleMiddleware` según `Accept-Language`. Si el idioma no está, se usa español.
Los mensajes de validación de DRF/Django ya vienen traducidos por el framework.
"""

from django.utils.translation import get_language

DEFAULT_LANGUAGE = "es"

MESSAGES: dict[str, dict[str, str]] = {
    "es": {
        "chat_bad_messages": "Formato de mensajes inválido.",
        "chat_bad_context": "Contexto inválido.",
        "chat_context_too_large": "Contexto demasiado grande.",
        "ai_not_configured": "IA no configurada.",
        "ai_bad_chat_reply": "La IA no devolvió una respuesta válida.",
        "ai_bad_analysis": "La IA no devolvió un análisis válido.",
        "ai_service_error": "Error del servicio de IA.",
        "image_missing": "Falta el archivo 'image'.",
        "image_too_large": "La imagen supera los 8 MB.",
        "image_invalid": "El archivo no es una imagen válida.",
        "image_unsupported": "Formato no soportado: usa JPG, PNG o WebP.",
        "kind_invalid": "kind inválido.",
        "limit_invalid": "limit inválido.",
        "delete_needs_scope": "Falta kind= o all=1.",
        "sync_bad_format": "Formato inválido: se espera {items: [...]}.",
        "sync_max_items": "Máximo {n} items por petición.",
        "date_too_old": "Fecha demasiado antigua.",
        "date_in_future": "Fecha en el futuro.",
        "detail_too_large": "detail demasiado grande (máx 8 KB).",
        "sets_duplicated": "Hay dos series con el mismo ejercicio y número.",
        "plan_too_few_gym_days": "Elige al menos 2 días de gimnasio: el mínimo son 2 sesiones de cuerpo completo a la semana.",
        "plan_too_many_gym_days": "Como mucho 6 días de gimnasio: deja al menos uno de descanso.",
        "plan_gym_days_invalid": "Días de gimnasio no válidos.",
        "plan_mma_days_invalid": "Días de MMA no válidos.",
        "plan_cardio_days_invalid": "Días de cardio no válidos.",
        "review_week_end_future": "La semana revisada no puede acabar después de hoy.",
        "review_week_end_too_old": "Solo se pueden revisar las últimas 8 semanas.",
        "review_signs_invalid": "Señales de descarga no válidas.",
        "review_accept_invalid": "Esa propuesta no está en la revisión.",
    },
    "en": {
        "chat_bad_messages": "Invalid message format.",
        "chat_bad_context": "Invalid context.",
        "chat_context_too_large": "Context too large.",
        "ai_not_configured": "AI not configured.",
        "ai_bad_chat_reply": "The AI did not return a valid reply.",
        "ai_bad_analysis": "The AI did not return a valid analysis.",
        "ai_service_error": "AI service error.",
        "image_missing": "Missing 'image' file.",
        "image_too_large": "The image is larger than 8 MB.",
        "image_invalid": "The file is not a valid image.",
        "image_unsupported": "Unsupported format: use JPG, PNG or WebP.",
        "kind_invalid": "Invalid kind.",
        "limit_invalid": "Invalid limit.",
        "delete_needs_scope": "Missing kind= or all=1.",
        "sync_bad_format": "Invalid format: expected {items: [...]}.",
        "sync_max_items": "At most {n} items per request.",
        "date_too_old": "Date too far in the past.",
        "date_in_future": "Date in the future.",
        "detail_too_large": "detail too large (max 8 KB).",
        "sets_duplicated": "Two sets share the same exercise and number.",
        "plan_too_few_gym_days": "Choose at least 2 gym days: the minimum is 2 full-body sessions a week.",
        "plan_too_many_gym_days": "At most 6 gym days: keep at least one rest day.",
        "plan_gym_days_invalid": "Invalid gym days.",
        "plan_mma_days_invalid": "Invalid MMA days.",
        "plan_cardio_days_invalid": "Invalid cardio days.",
        "review_week_end_future": "The reviewed week cannot end after today.",
        "review_week_end_too_old": "Only the last 8 weeks can be reviewed.",
        "review_signs_invalid": "Invalid deload signs.",
        "review_accept_invalid": "That proposal is not in the review.",
    },
}


def msg(key: str, **params) -> str:
    """Texto de `key` en el idioma activo (español si no hay catálogo para él)."""
    lang = (get_language() or DEFAULT_LANGUAGE).split("-")[0]
    text = MESSAGES.get(lang, MESSAGES[DEFAULT_LANGUAGE])[key]
    return text.format(**params) if params else text
