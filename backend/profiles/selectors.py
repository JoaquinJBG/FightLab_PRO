from .models import BiometricsLog, UserProfile


def profile_get(*, user) -> UserProfile:
    return user.profile


def biometrics_list(*, user, date_from=None, date_to=None):
    qs = BiometricsLog.objects.filter(profile=user.profile)
    if date_from is not None:
        qs = qs.filter(timestamp__gte=date_from)
    if date_to is not None:
        qs = qs.filter(timestamp__lte=date_to)
    return qs
