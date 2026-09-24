import pytest


@pytest.fixture(autouse=True)
def _beta_allowlist_open(settings):
    """Los tests de este paquete no prueban la beta cerrada por defecto: la
    dejamos abierta (equivalente a DEBUG local) salvo que un test la
    reconfigure explícitamente para probar el cierre por invitación."""
    settings.DEBUG = True
    settings.BETA_ALLOWED_EMAILS = []
