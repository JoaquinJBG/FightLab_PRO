import pytest
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_health_ok_sin_autenticacion():
    """GET /health responde 200 sin token: lo usa el health check de Render."""
    client = APIClient()
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.django_db
def test_health_no_esta_bajo_api_v1():
    client = APIClient()
    response = client.get("/api/v1/health")
    assert response.status_code == 404
