# Migración de esquema (paso 1/3 de fotos en Postgres, ver 0004 y 0005).
# Añade los campos nuevos sin tocar `image` todavía, para que la migración de
# datos (0004) pueda leer el archivo antiguo antes de que desaparezca.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("profiles", "0002_biometricslog_arm_cm_biometricslog_chest_cm_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="progressphoto",
            name="data",
            field=models.BinaryField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="progressphoto",
            name="content_type",
            field=models.CharField(default="image/jpeg", max_length=32),
        ),
        migrations.AddField(
            model_name="progressphoto",
            name="width",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="progressphoto",
            name="height",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="progressphoto",
            name="image",
            field=models.ImageField(blank=True, null=True, upload_to="progress/%Y/%m/"),
        ),
    ]
