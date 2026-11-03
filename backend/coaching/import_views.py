"""`POST /coach/import`: subir un CSV de Hevy o genérico y guardar sus series (Task 9.1).

Multipart con `file` (el CSV), `importer` (`auto`, `hevy_csv` o `generic_csv`; por defecto
`auto`, el que reconozca las columnas) y `dry_run` (`1`: solo el resumen, sin guardar nada).
Un archivo que no se puede leer responde 400 con `{"code", "params", "detail"}`; `code` lo traduce
la app y `detail` es el mensaje del motor, en inglés.
"""
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import imports
from .bridge import importers


def _bad(code: str, params: dict | None = None, detail: str = "") -> Response:
    return Response({"code": code, "params": params or {}, "detail": detail}, status=status.HTTP_400_BAD_REQUEST)


class ImportView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "coach-import"

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return _bad("missing_file")
        if upload.size > importers.MAX_IMPORT_BYTES:
            return _bad("too_large", {"mb": importers.MAX_IMPORT_BYTES // (1024 * 1024)})
        if not upload.name.lower().endswith((".csv", ".txt")):
            return _bad("not_csv")
        choice = request.data.get("importer") or "auto"
        if choice != "auto" and choice not in importers.IMPORTERS:
            return _bad("unknown_format")
        dry_run = request.data.get("dry_run") in ("1", "true")
        try:
            parsed = importers.parse(upload.read(), None if choice == "auto" else choice)
            result = imports.import_sets(request.user, parsed, dry_run=dry_run)
        except importers.ImportFileError as exc:
            return _bad(exc.code, exc.params, exc.detail)
        return Response(result, status=status.HTTP_200_OK if dry_run else status.HTTP_201_CREATED)
