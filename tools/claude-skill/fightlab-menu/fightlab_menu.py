#!/usr/bin/env python3
"""FightLab menu helper for the `fightlab-menu` Claude Code skill (phase 14, route B).

Only the Python standard library: no paid service, no AI call. Claude (the user's own
subscription) writes the menu; this script only talks to FightLab with the user's personal token.

Commands:
  context [--start YYYY-MM-DD] [--days N] [--meals breakfast,lunch,dinner,snack] [--tupper lunch] [--out FILE]
      Download the menu context (targets, tastes, kitchen, foods, recent menus, instructions).
  check MENU.json [--context FILE]
      Check the file locally (format, dish ids, food names) and with FightLab's engine
      (dry run: nothing is saved). Exit code 0 when every day passes, 1 when not.
  upload MENU.json [--replace-start]
      Save the menu in FightLab (origin "your AI"). Same id again replaces it.

Configuration (never in a repository):
  FIGHTLAB_URL         the address shown in Profile > My AI (https://<app>/api/ext), or a Django
                       API base such as http://127.0.0.1:8000/api/v1 for local development.
                       Fallback: the file ~/.config/fightlab/url
  FIGHTLAB_TOKEN       the personal token (flm_...). Fallback: the file named by
                       FIGHTLAB_TOKEN_FILE, else ~/.config/fightlab/token
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "fightlab"
TIMEOUT = 75  # the free backend can take ~50 s to wake up
USER_AGENT = "fightlab-menu-skill/1"
EXIT_OK, EXIT_FAIL, EXIT_ERROR = 0, 1, 2


class Problem(Exception):
    """A clear, final error for the user (no traceback)."""


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig").strip()  # PowerShell 5 writes a BOM
    except OSError:
        return ""


def base_url() -> str:
    url = os.environ.get("FIGHTLAB_URL", "").strip() or _read(CONFIG_DIR / "url")
    if not url:
        raise Problem("FIGHTLAB_URL is not set: use the address from Profile > My AI (it ends in /api/ext).")
    if not url.startswith(("https://", "http://127.0.0.1", "http://localhost")):
        raise Problem("FIGHTLAB_URL must start with https:// (or http://localhost for local development).")
    return url.rstrip("/")


def token() -> str:
    value = os.environ.get("FIGHTLAB_TOKEN", "").strip()
    if not value:
        file = os.environ.get("FIGHTLAB_TOKEN_FILE", "").strip()
        value = _read(Path(file).expanduser()) if file else _read(CONFIG_DIR / "token")
    if not value.startswith("flm_"):
        raise Problem("No personal token: create one in Profile > My AI and put it in FIGHTLAB_TOKEN or ~/.config/fightlab/token.")
    return value


def request(method: str, path: str, body: dict | None = None, query: dict | None = None) -> tuple[int, dict]:
    url = f"{base_url()}/{path}"
    if query:
        url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v not in (None, "")})
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token()}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", USER_AGENT)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"detail": raw[:300]}
        if exc.code == 401:
            raise Problem(f"401: {payload.get('detail') or 'invalid or revoked token'}") from None
        return exc.code, payload if isinstance(payload, dict) else {"detail": str(payload)}
    except urllib.error.URLError as exc:
        raise Problem(f"Cannot reach FightLab at {base_url()}: {exc.reason}") from None


def fold(text: str) -> str:
    """Like FightLab: case and accents do not matter in food names."""
    decomposed = unicodedata.normalize("NFKD", " ".join(str(text).split()).casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def _out(text: str = "") -> None:
    sys.stdout.write(text + "\n")


# ---------------------------------------------------------------- local check


def load_menu(path: str) -> dict:
    try:
        text = Path(path).read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise Problem(f"Cannot read {path}: {exc}") from None
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise Problem(f"{path} is not valid JSON (line {exc.lineno}, column {exc.colno}): {exc.msg}") from None
    if not isinstance(data, dict):
        raise Problem(f"{path} must contain one JSON object.")
    return data


def local_problems(menu: dict, food_names: set[str] | None = None) -> list[str]:
    """Format problems FightLab would reject, before calling it. Food names are checked only when
    the context is given (case and accents do not matter, as in FightLab)."""
    out = []
    if menu.get("schema") != 1:
        out.append('"schema" must be 1')
    days = menu.get("days")
    dishes = menu.get("dishes") or {}
    if not isinstance(days, list) or not days:
        return out + ['"days" must be a non-empty list']
    if not isinstance(dishes, dict):
        return out + ['"dishes" must be an object keyed by dish id']
    dates = []
    for day in days:
        when = day.get("date") if isinstance(day, dict) else None
        try:
            dates.append(date.fromisoformat(str(when)))
        except ValueError:
            out.append(f"day with an invalid date: {when!r}")
            continue
        meals = day.get("meals")
        if not isinstance(meals, list) or not meals:
            out.append(f"{when}: no meals")
            continue
        for meal in meals:
            if not isinstance(meal, dict) or not meal.get("meal"):
                out.append(f"{when}: a meal without its label")
            elif not meal.get("free") and meal.get("dish_id") not in dishes:
                out.append(f"{when}: {meal.get('meal')}: dish_id {meal.get('dish_id')!r} is not in \"dishes\"")
    if dates != sorted(set(dates)):
        out.append("days must be in date order, one per date")
    for dish_id, dish in dishes.items():
        if not isinstance(dish, dict) or not dish.get("name"):
            out.append(f"dishes.{dish_id}: needs a name")
            continue
        items = dish.get("ingredients")
        if not isinstance(items, list) or not items:
            out.append(f"dishes.{dish_id}: needs ingredients")
            continue
        for item in items:
            food = item.get("food") if isinstance(item, dict) else None
            amount = item.get("ml", item.get("grams")) if isinstance(item, dict) else None
            if not food or not isinstance(amount, (int, float)) or isinstance(amount, bool) or amount <= 0:
                out.append(f"dishes.{dish_id}: each ingredient needs food and grams (or ml) above 0")
            elif food_names is not None and fold(food) not in food_names:
                out.append(f"dishes.{dish_id}: unknown food {food!r} (use a name from \"foods\")")
    return out


# ---------------------------------------------------------------- commands


def cmd_context(args) -> int:
    status, data = request("GET", "menu/context", query={
        "start": args.start, "days": args.days, "meals": args.meals, "tupper": args.tupper,
    })
    if status != 200:
        _out(f"FightLab said {status}: {data.get('code', '')} {data.get('detail', '')}".strip())
        for reason in data.get("reasons") or []:
            _out(f"- {reason.get('text') or reason.get('code')}")
        return EXIT_ERROR
    text = json.dumps(data, ensure_ascii=False, indent=1)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        req = data["request"]
        _out(f"Context saved to {args.out}: {req['start']} to {req['end']} ({req['days']} days), "
             f"meals {', '.join(req['meals'])}; {len(data.get('foods') or [])} foods; id {req['id']}.")
    else:
        _out(text)
    return EXIT_OK


def _food_names(path: str | None) -> set[str] | None:
    if not path:
        return None
    ctx = load_menu(path)
    return {fold(row[0]) for row in ctx.get("foods") or [] if row}


def _status_line(day: dict) -> str:
    check = day.get("check") or {}
    totals = day.get("totals") or {}
    bad = [f"{k} {v}" for k, v in check.items() if v != "ok"]
    numbers = ", ".join(f"{k} {totals[k]}" for k in ("kcal", "protein_g", "fat_g", "fibre_g", "carbs_g") if k in totals)
    flags = [f"{f.get('kind')}: {f.get('entry')}" for f in day.get("blocking") or []]
    extra = ([f"not ok: {', '.join(bad)}"] if bad else []) + (["repeats a dish"] if day.get("repeats") else []) + flags
    return f"{day['date']}: {'OK' if day.get('ok') else 'FAIL'} ({numbers})" + (f" | {'; '.join(extra)}" if extra else "")


def _rejected_line(day: dict) -> str:
    """Why FightLab did not save a day (R4-1): targets, repeats, blocking flags and unknown foods."""
    check = day.get("check") or {}
    why = [f"{k} {v}" for k, v in check.items() if v != "ok"]
    if day.get("repeats"):
        why.append("repeats a dish")
    why += [f"{f.get('kind')}: {f.get('entry')}" for f in day.get("blocking") or []]
    if day.get("unknown"):
        why.append("not in the food table, not counted: " + ", ".join(day["unknown"]))
    return f"- {day.get('date')}: " + ("; ".join(why) or "does not pass")


def cmd_check(args) -> int:
    menu = load_menu(args.menu)
    problems = local_problems(menu, _food_names(args.context))
    if problems:
        _out("Fix these before checking with FightLab:")
        for p in problems:
            _out(f"- {p}")
        return EXIT_FAIL
    status, data = request("POST", "menu/import", {"menu": menu, "dry_run": True})
    if status != 200:
        _out(f"FightLab refused it ({status} {data.get('code', '')}): {data.get('detail', '')}")
        if data.get("info"):
            _out(f"Where: {data['info']}")
        return EXIT_FAIL
    targets = data.get("targets") or {}
    if targets:
        _out("Targets per day: " + ", ".join(f"{k} {v}" for k, v in targets.items() if k != "in_deficit"))
    if not data.get("checked"):
        _out("FightLab could not check it (no calorie targets): it would be saved without the engine check.")
    for day in data.get("days") or []:
        _out(_status_line(day))
    if data.get("unknown_foods"):
        _out("Unknown foods (use exact names from \"foods\"): " + ", ".join(data["unknown_foods"]))
    for rep in data.get("repeats") or []:
        _out(f"Repeated dish: {rep.get('dish')} on {', '.join(rep.get('dates') or [])}")
    warnings = [f for f in data.get("taste_flags") or [] if not f.get("blocking")]
    for flag in warnings:
        _out(f"Note ({flag.get('kind')}): {flag.get('entry')} on {flag.get('date')}")
    _out("ALL DAYS PASS" if data.get("ok") else "SOME DAYS FAIL: adjust them and check again.")
    return EXIT_OK if data.get("ok") else EXIT_FAIL


def cmd_upload(args) -> int:
    menu = load_menu(args.menu)
    problems = local_problems(menu)
    if problems:
        _out("Not uploaded. Fix these first:")
        for p in problems:
            _out(f"- {p}")
        return EXIT_FAIL
    body = {"menu": menu, **({"replace_start": True} if args.replace_start else {})}
    status, data = request("POST", "menu/import", body)
    if status == 409 and data.get("code") == "start_taken":
        params = data.get("params") or {}
        counts = (f" The saved one has {params['old_ok']} of {params.get('old_days')} valid days; this one has "
                  f"{params.get('new_ok')} of {params.get('new_days')}.") if "old_ok" in params else ""
        _out("Another menu already starts that day." + counts + " Ask the user, then run upload again with --replace-start.")
        return EXIT_FAIL
    if data.get("code") == "no_valid_days":
        # R4-1: no day meets the targets, so FightLab saves nothing and keeps the user's menu.
        _out(f"Not uploaded: {data.get('detail', '')}")
        for day in data.get("rejected") or []:
            _out(_rejected_line(day))
        _out("Fix those days (run check) and upload again.")
        return EXIT_FAIL
    if status not in (200, 201):
        _out(f"Not uploaded ({status} {data.get('code', '')}): {data.get('detail', '')}")
        if data.get("info"):
            _out(f"Where: {data['info']}")
        return EXIT_FAIL
    summary = data["summary"]
    verb = "Replaced" if data.get("replaced") else "Saved"
    _out(f"{verb} in FightLab: {summary.get('title') or summary['menu_id']} ({summary['start']} to {summary['end']}, "
         f"{summary['days']} days). Days that meet the targets: {data.get('days_ok')} of {summary['days']}.")
    if data.get("rejected"):
        # R4-1: the days that do not meet the targets are not saved.
        _out("Days not saved because they do not meet the targets:")
        for day in data["rejected"]:
            _out(_rejected_line(day))
    elif data.get("days_failing"):
        _out("Days that do not: " + ", ".join(data["days_failing"]))
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="fightlab_menu", description="FightLab menu helper for the fightlab-menu skill.")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("context", help="download the menu context")
    p.add_argument("--start")
    p.add_argument("--days", type=int)
    p.add_argument("--meals", help="comma-separated: breakfast,lunch,dinner,snack")
    p.add_argument("--tupper", help="comma-separated meals packed in a lunchbox")
    p.add_argument("--out", help="file to save the context to (else printed)")
    p.set_defaults(run=cmd_context)
    p = sub.add_parser("check", help="check a menu file (nothing is saved)")
    p.add_argument("menu")
    p.add_argument("--context", help="the context file, to check food names locally too")
    p.set_defaults(run=cmd_check)
    p = sub.add_parser("upload", help="save a menu file in FightLab")
    p.add_argument("menu")
    p.add_argument("--replace-start", action="store_true", help="replace another menu that starts the same day")
    p.set_defaults(run=cmd_upload)
    args = parser.parse_args(argv)
    try:
        return args.run(args)
    except Problem as exc:
        _out(f"ERROR: {exc}")
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
