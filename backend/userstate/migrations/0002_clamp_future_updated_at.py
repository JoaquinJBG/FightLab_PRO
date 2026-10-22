from datetime import timedelta

from django.db import migrations
from django.utils import timezone


def clamp_future(apps, schema_editor):
    UserState = apps.get_model("userstate", "UserState")
    now = timezone.now()
    UserState.objects.filter(updated_at__gt=now + timedelta(minutes=5)).update(updated_at=now)


class Migration(migrations.Migration):

    dependencies = [
        ("userstate", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(clamp_future, migrations.RunPython.noop),
    ]
