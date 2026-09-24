from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_profile_for_new_user(sender, instance, created, **kwargs):
    """Todo CustomUser necesita un UserProfile, o el resto de la API (que
    hace request.user.profile) responde 500. Cubre altas por register/verify-email,
    pero también createsuperuser y usuarios creados a mano desde el admin, que
    hoy no pasan por email_verify."""
    if not created:
        return
    from profiles.models import UserProfile

    UserProfile.objects.get_or_create(user=instance)
