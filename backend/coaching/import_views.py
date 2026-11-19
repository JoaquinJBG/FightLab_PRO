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

from . import history_import, imports
from .bridge import history_files, importers
from .safety_views import _today


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


MAX_HISTORY_FILES = 60  # un año de CSV semanales, la copia JSON y los archivos del coach
MAX_HISTORY_BYTES = 25 * 1024 * 1024
HISTORY_EXTENSIONS = (".json", ".csv", ".txt", ".md")


class HistoryImportView(APIView):
    """`POST /coach/import/history` (fase 10): la copia JSON y los CSV de ParteDiario y los
    archivos del coach (`checkins.csv`, `reviews/FIN.md`, `sessions.csv`), varios a la vez.

    Multipart con `files` (uno o más), `dry_run` (`1`: solo el resumen) y `on_conflict` (`keep`,
    por defecto: lo que ya hay en FightLab se queda; `replace`: gana el archivo). Un archivo que no
    se puede leer sale en `files[].error` y no impide importar los demás.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "coach-import"

    def post(self, request):
        uploads = request.FILES.getlist("files")
        if not uploads:
            return _bad("missing_file")
        if len(uploads) > MAX_HISTORY_FILES:
            return _bad("too_many_files", {"max": MAX_HISTORY_FILES})
        if sum(u.size for u in uploads) > MAX_HISTORY_BYTES:
            return _bad("too_large", {"mb": MAX_HISTORY_BYTES // (1024 * 1024)})
        on_conflict = request.data.get("on_conflict") or "keep"
        if on_conflict not in history_import.ON_CONFLICT:
            return _bad("bad_conflict_mode")
        dry_run = request.data.get("dry_run") in ("1", "true")

        files, parsed = [], []
        for upload in uploads:
            name = (upload.name or "")[:200]
            entry = {"name": name, "kind": None, "days": 0, "reviews": 0, "error": None}
            files.append(entry)
            if upload.size > importers.MAX_IMPORT_BYTES:
                entry["error"] = {"code": "too_large", "params": {"mb": importers.MAX_IMPORT_BYTES // (1024 * 1024)}}
                continue
            if not name.lower().endswith(HISTORY_EXTENSIONS):
                entry["error"] = {"code": "unknown_format", "params": {}}
                continue
            try:
                result = history_files.parse_file(name, upload.read())
            except importers.ImportFileError as exc:
                entry["error"] = {"code": exc.code, "params": exc.params}
                continue
            entry.update(kind=result.kind, days=len(result.days), reviews=len(result.reviews))
            parsed.append(result)
        try:
            body = history_import.import_history(
                request.user, parsed, today=_today(request.user.profile), on_conflict=on_conflict, dry_run=dry_run
            )
        except history_import.HistoryError as exc:
            return _bad(exc.code, exc.params)
        body["files"] = files
        return Response(body, status=status.HTTP_200_OK if dry_run else status.HTTP_201_CREATED)
