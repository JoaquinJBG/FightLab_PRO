import re
from datetime import timedelta

MAX_VALUE_BYTES = 64 * 1024
MAX_BULK_ITEMS = 200
MAX_USER_BYTES = 5 * 1024 * 1024

DATED_KEY_RE = re.compile(r"^(?:nutri|water|coach_dismissed)_(\d{4}-\d{2}-\d{2})$")
DATE_WINDOW = timedelta(days=731)
CLIENT_CLOCK_SKEW = timedelta(minutes=5)
