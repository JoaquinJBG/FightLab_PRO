"""Claves de prueba generadas en cada ejecución (nunca reales) y la red cortada: ningún test
llega a un servicio de push. `push_post` sustituye la única llamada HTTP de pywebpush, así que
el cifrado y la firma VAPID sí se ejecutan de verdad."""
import base64
import os
from unittest import mock

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def vapid_keys() -> tuple[str, str]:
    """Como `npx web-push generate-vapid-keys`: privada de 32 bytes y pública sin comprimir."""
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return b64url(private), b64url(public)


def browser_keys() -> dict:
    """Las `keys` que da `PushManager.subscribe()` en un navegador."""
    key = ec.generate_private_key(ec.SECP256R1())
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return {"p256dh": b64url(public), "auth": b64url(os.urandom(16))}


@pytest.fixture
def vapid(settings):
    private, public = vapid_keys()
    settings.VAPID_PRIVATE_KEY = private
    settings.VAPID_PUBLIC_KEY = public
    settings.VAPID_SUBJECT = "https://fightlab.example"
    return public


@pytest.fixture(autouse=True)
def push_post():
    """La respuesta del servicio de push: 201 salvo que el test diga otra cosa."""
    response = mock.Mock(status_code=201, text="", headers={}, reason="Created")
    with mock.patch("pywebpush.requests.post", return_value=response) as post:
        post.response = response
        yield post
