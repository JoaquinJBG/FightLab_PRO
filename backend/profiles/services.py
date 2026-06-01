from .models import BiometricsLog, UserProfile

EDITABLE_PROFILE_FIELDS = {
    "date_of_birth", "gender", "height_cm",
    "dominant_stance", "preferred_units", "timezone",
}


def profile_update(*, user, **fields) -> UserProfile:
    profile = user.profile
    for key, value in fields.items():
        if key in EDITABLE_PROFILE_FIELDS:
            setattr(profile, key, value)
    profile.full_clean()
    profile.save()
    return profile


def biometrics_create(*, user, **fields) -> BiometricsLog:
    from django.utils import timezone as tz
    if "timestamp" not in fields or fields.get("timestamp") is None:
        fields.setdefault("timestamp", tz.now())
    log = BiometricsLog(profile=user.profile, **fields)
    log.full_clean()  # enforces sleep_quality_score 1..10 etc.
    log.save()
    return log
