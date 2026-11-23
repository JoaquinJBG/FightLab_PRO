"""Dónde viven las fotos de los tickets: Cloudflare R2 (API de S3) o, en las pruebas, la memoria.

R2 se configura solo con variables de entorno del backend (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET` y, opcional, `R2_SIGNED_URL_SECONDS`). Sin las cuatro
primeras no hay almacenamiento: la subida queda apagada y la API lo dice
(`tickets_not_configured`). El bucket es privado: no hay URL pública, solo URLs firmadas que
caducan. Las pruebas nunca llaman a R2: usan `MemoryStorage` (`TICKETS_STORAGE = "memory"`).
"""
from __future__ import annotations

from django.conf import settings


class StorageError(Exception):
    pass


class MemoryStorage:
    """Almacenamiento falso en memoria para las pruebas. Los objetos se comparten entre
    instancias (como un bucket) y `reset()` los borra."""

    name = "memory"
    objects: dict[str, tuple[bytes, str]] = {}

    @classmethod
    def reset(cls) -> None:
        cls.objects.clear()

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = (data, content_type)

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    def signed_url(self, key: str, seconds: int) -> str:
        if key not in self.objects:
            raise StorageError("missing")
        return f"https://storage.invalid/{key}?expires={seconds}&signature=fake"


class R2Storage:
    """Cliente S3 de `boto3` contra el endpoint de R2 de la cuenta."""

    name = "r2"

    def __init__(self, account_id: str, access_key: str, secret_key: str, bucket: str):
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
            # Desde boto3 1.36 las sumas de comprobación van por defecto en cada petición; con R2,
            # solo cuando la operación las exige.
            config=Config(
                signature_version="s3v4",
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
                retries={"max_attempts": 2},
                connect_timeout=5,
                read_timeout=15,
            ),
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        try:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        except Exception as exc:  # botocore: red, credenciales, bucket
            raise StorageError(type(exc).__name__) from exc

    def delete(self, key: str) -> None:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            raise StorageError(type(exc).__name__) from exc

    def signed_url(self, key: str, seconds: int) -> str:
        # Firmar no llama a R2: es una cuenta local con la clave secreta.
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=seconds
        )


_cached: dict[tuple, R2Storage] = {}


def r2_settings() -> tuple[str, str, str, str]:
    return (settings.R2_ACCOUNT_ID, settings.R2_ACCESS_KEY_ID, settings.R2_SECRET_ACCESS_KEY, settings.R2_BUCKET)


def get_storage():
    """El almacenamiento configurado, o `None` si la subida está apagada."""
    if getattr(settings, "TICKETS_STORAGE", "r2") == "memory":
        return MemoryStorage()
    values = r2_settings()
    if not all(values):
        return None
    if values not in _cached:
        _cached.clear()
        _cached[values] = R2Storage(*values)
    return _cached[values]


def signed_url_seconds() -> int:
    return settings.R2_SIGNED_URL_SECONDS
