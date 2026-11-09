"""Al borrar un ticket (a mano o en cascada al borrar la cuenta), se borra su foto de R2.

El borrado del objeto va cuando la transacción se confirma: si se deshace, la foto sigue. Un
fallo de R2 no impide borrar el ticket; queda en el log para borrarlo a mano.
"""
import logging

from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import TicketPhoto
from .storage import StorageError, get_storage

log = logging.getLogger(__name__)


@receiver(post_delete, sender=TicketPhoto)
def delete_object(sender, instance: TicketPhoto, **kwargs) -> None:
    key = instance.key

    def run() -> None:
        storage = get_storage()
        if storage is None:
            log.warning("ticket %s borrado sin R2 configurado: el objeto queda en el bucket", key)
            return
        try:
            storage.delete(key)
        except StorageError as exc:
            log.error("no se pudo borrar %s de R2: %s", key, exc)

    transaction.on_commit(run)
