# Migración de esquema (paso 3/3, ver 0003 y 0004): ya con los datos
# copiados, se retira el ImageField antiguo y `data` pasa a obligatorio.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("profiles", "0004_backfill_progressphoto_data"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="progressphoto",
            name="image",
        ),
        migrations.AlterField(
            model_name="progressphoto",
            name="data",
            field=models.BinaryField(),
        ),
    ]
