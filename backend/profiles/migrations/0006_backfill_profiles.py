# Migración de datos: crea el UserProfile que falte para cuentas ya existentes
# (superusuarios o usuarios creados desde el admin, que no pasan por email_verify).
# A partir de esta versión, la señal post_save de users.signals ya crea el
# perfil en el alta, así que esto es solo un backfill de una vez para lo que
# ya hubiera en la base antes de desplegarla.
from django.db import migrations


def backfill_profiles(apps, schema_editor):
    User = apps.get_model("users", "CustomUser")
    UserProfile = apps.get_model("profiles", "UserProfile")
    has_profile = set(UserProfile.objects.values_list("user_id", flat=True))
    missing = User.objects.exclude(id__in=has_profile)
    UserProfile.objects.bulk_create([UserProfile(user_id=u.id) for u in missing])


def noop_reverse(apps, schema_editor):
    pass  # no se borran perfiles al revertir: podrían tener datos ya cargados


class Migration(migrations.Migration):

    dependencies = [
        ("profiles", "0005_progressphoto_drop_image"),
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(backfill_profiles, noop_reverse),
    ]
