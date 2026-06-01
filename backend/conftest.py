import django
from django.test import override_settings

# Override email backend for all tests so mail.outbox is available.
django.test.override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
)


def pytest_configure(config):
    """Switch to the in-memory email backend for the full test run."""
    from django.conf import settings

    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
