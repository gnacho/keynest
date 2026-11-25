#!/usr/bin/env python3
"""Upload an Airbnb host session to Keynest with a one-time pairing code.

The web UI generates the pairing code (Renovar button on the expired-session
ribbon) and then waits for POST /api/airbnb/session. This tool produces that
request without a browser automation stack: it takes the cookies from a
logged-in browser profile, validates them against the host reservations API and
only then spends the code.

Dependencies: httpx (plus h2). Nothing else, so it runs on the same Python
runtime the scraper host already has.

Usage:

    python3 import-airbnb-session.py --pairing-code ABC123 \\
        --keynest-url http://127.0.0.1:8081 \\
        --session storage-state.json

Input formats, any of them:

    - Playwright storage_state: {"cookies": [...], "origins": [...]}
    - a cookie list exported by a browser extension (Cookie-Editor, Export
      Cookies...): [{"name": ..., "value": ..., "domain": ...}, ...]
    - any JSON with a "cookies" list

Without --session nor --cookies-json it reads the JSON from stdin, so this
also works from a pipe:

    python3 -c 'print(json.dumps(cookies))' | python3 import-airbnb-session.py \\
        --pairing-code ABC123

Exit codes: 0 session uploaded, 2 session not valid (code untouched),
3 code rejected or write error, 4 bad input.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://www.airbnb.es"
API_KEY = "d306zoyjsyarp7ifhu67rjxn52tv0t20"
PAGE_SIZE = 40
EXIT_INVALID_SESSION = 2
EXIT_REJECTED = 3
EXIT_BAD_INPUT = 4

# /api/v2/reservations answers 404 route_not_found when these are missing, so
# they are part of the liveness probe and not optional decoration.
PROBE_PARAMS = {
    "locale": "es",
    "currency": "EUR",
    "_format": "for_remy",
    "_limit": str(PAGE_SIZE),
    "_offset": "0",
    "collection_strategy": "for_reservations_list",
    "date_min": "2024-01-01",
    "sort_field": "start_date",
    "sort_order": "asc",
}
BROWSER_HEADERS = {
    "X-Airbnb-API-Key": API_KEY,
    "X-Airbnb-Supports-Airlock-V2": "true",
    "X-CSRF-Without-Token": "1",
    "Referer": f"{BASE}/hosting/reservations",
    "Accept-Language": "es-ES",
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
    ),
}


def log(message):
    print(f"[import] {datetime.now().strftime('%H:%M:%S')} {message}", flush=True)


def load_payload(session_path="", cookies_path=""):
    """Read the raw JSON from a file or stdin."""
    if session_path:
        raw = Path(session_path).read_text(encoding="utf-8")
    elif cookies_path:
        raw = Path(cookies_path).read_text(encoding="utf-8")
    else:
        raw = sys.stdin.read()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"input is not valid JSON: {error}") from error


def normalize_storage(payload, base=BASE):
    """Turn any accepted input shape into a Playwright storage_state.

    Keeps airbnb cookies only. When the same name appears twice for the same
    domain (Firefox keeps duplicates until it prunes them) the one with the
    furthest expiry wins.
    """
    if isinstance(payload, dict) and isinstance(payload.get("cookies"), list):
        raw_cookies = payload["cookies"]
        origins = payload.get("origins") or []
    elif isinstance(payload, list):
        raw_cookies = payload
        origins = []
    else:
        raise ValueError("expected a storage_state object or a cookie list")

    best = {}
    for cookie in raw_cookies:
        if not isinstance(cookie, dict):
            continue
        name = cookie.get("name")
        if not name or "value" not in cookie:
            continue
        domain = cookie.get("domain") or ".airbnb.es"
        if "airbnb" not in domain:
            continue
        expires = to_seconds(cookie.get("expires", -1))
        entry = {
            "name": name,
            "value": str(cookie["value"]),
            "domain": domain,
            "path": cookie.get("path") or "/",
            "expires": expires,
            "httpOnly": bool(cookie.get("httpOnly", False)),
            "secure": bool(cookie.get("secure", True)),
            "sameSite": cookie.get("sameSite") or "Lax",
        }
        key = (domain, name)
        current = best.get(key)
        if current is None or expires > current["expires"]:
            best[key] = entry

    if not best:
        raise ValueError("no airbnb cookies in the input")

    if not origins:
        origins = [{"origin": base, "localStorage": []}]
    return {"cookies": list(best.values()), "origins": origins}


def to_seconds(expires):
    """Firefox stores expiry in milliseconds, Playwright in seconds."""
    try:
        value = float(expires)
    except (TypeError, ValueError):
        return -1
    if value <= 0:
        return -1
    if value > 1e11:
        return value / 1000.0
    return value


def cookie_jar(storage):
    return {cookie["name"]: cookie["value"] for cookie in storage["cookies"]}


def client(cookies, timeout=30):
    import httpx

    return httpx.Client(
        headers=BROWSER_HEADERS,
        cookies=cookies,
        timeout=timeout,
        follow_redirects=True,
        http2=True,
    )


def probe_session(storage):
    """Validate the session against the host API before spending the code.

    Returns (alive, detail). A dead session must not consume the pairing code,
    which is single use and expires in ten minutes.
    """
    with client(cookie_jar(storage)) as http:
        response = http.get(f"{BASE}/api/v2/reservations", params=PROBE_PARAMS)
        final_url = str(response.url).lower()
        log(f"airbnb GET /api/v2/reservations -> HTTP {response.status_code}")
        if response.status_code in (401, 403):
            return False, f"HTTP {response.status_code}, session rejected"
        if response.status_code == 404:
            return False, "HTTP 404 route_not_found, check the query parameters"
        if any(marker in final_url for marker in ("/login", "/airlock", "signin")):
            return False, "redirected to login or airlock"
        if response.status_code != 200:
            return False, f"HTTP {response.status_code}"
        content_type = response.headers.get("content-type", "")
        if "json" not in content_type:
            sample = response.text[:2000]
            if "<form" in sample or "challenge" in sample:
                return False, "HTML challenge instead of JSON"
        try:
            body = response.json()
        except ValueError:
            return False, "response is not JSON"
        reservations = body.get("reservations") or body.get("data") or []
        return True, f"{len(reservations)} reservations in the first page"


def upload(storage, code, keynest_url):
    import httpx

    url = f"{keynest_url.rstrip('/')}/api/airbnb/session"
    with httpx.Client(timeout=30) as http:
        response = http.post(url, json={"code": code, "session": storage})
    log(f"POST {url} -> HTTP {response.status_code} {response.text[:200]}")
    return response


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pairing-code", required=True,
                        help="one-time code shown by the Keynest renew dialog")
    parser.add_argument("--keynest-url", default="http://127.0.0.1:8081",
                        help="Keynest base URL (default: %(default)s)")
    parser.add_argument("--session", default="",
                        help="JSON file with a storage_state or a cookie list")
    parser.add_argument("--cookies-json", default="",
                        help="alias of --session for exported cookie files")
    parser.add_argument("--save", default="",
                        help="write the normalized storage_state to this path")
    args = parser.parse_args(argv)

    try:
        storage = normalize_storage(load_payload(args.session, args.cookies_json))
    except (OSError, ValueError) as error:
        log(f"invalid input: {error}")
        return EXIT_BAD_INPUT

    log(f"{len(storage['cookies'])} airbnb cookies normalized")
    if args.save:
        Path(args.save).write_text(json.dumps(storage), encoding="utf-8")
        log(f"storage_state written to {args.save}")

    alive, detail = probe_session(storage)
    if not alive:
        log(f"session is NOT valid ({detail}): nothing uploaded, the code is still unused")
        return EXIT_INVALID_SESSION
    log(f"session is valid: {detail}")

    response = upload(storage, args.pairing_code, args.keynest_url)
    if response.status_code != 200:
        if response.status_code == 401:
            log("Keynest rejected the pairing code (expired or already used)")
        else:
            log(f"upload failed: HTTP {response.status_code}")
        return EXIT_REJECTED

    log("session uploaded to Keynest: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
