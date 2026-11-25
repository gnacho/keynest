#!/usr/bin/env python3
"""Unit tests for scripts/import-airbnb-session.py.

Pure parsing and normalization only: no network, no httpx, no browser.

    python3 -m unittest discover -s scripts/tests -v
"""
import importlib.util
import json
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "import-airbnb-session.py"
spec = importlib.util.spec_from_file_location("import_airbnb_session", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NormalizeStorageTest(unittest.TestCase):
    def test_playwright_storage_state_is_preserved(self):
        payload = {
            "cookies": [
                {"name": "bev", "value": "abc", "domain": ".airbnb.es",
                 "path": "/", "expires": 1830180214, "httpOnly": False,
                 "secure": True, "sameSite": "Lax"},
            ],
            "origins": [{"origin": "https://www.airbnb.es", "localStorage": []}],
        }
        storage = module.normalize_storage(payload)
        self.assertEqual(len(storage["cookies"]), 1)
        self.assertEqual(storage["cookies"][0]["name"], "bev")
        self.assertEqual(storage["origins"][0]["origin"], "https://www.airbnb.es")

    def test_bare_cookie_list_gets_an_origin(self):
        storage = module.normalize_storage([
            {"name": "bev", "value": "abc", "domain": ".airbnb.es"},
        ])
        self.assertEqual(len(storage["cookies"]), 1)
        self.assertEqual(storage["origins"][0]["origin"], module.BASE)

    def test_non_airbnb_cookies_are_dropped(self):
        storage = module.normalize_storage([
            {"name": "bev", "value": "abc", "domain": ".airbnb.es"},
            {"name": "session", "value": "xyz", "domain": ".other.example"},
        ])
        self.assertEqual([c["name"] for c in storage["cookies"]], ["bev"])

    def test_missing_domain_defaults_to_airbnb(self):
        storage = module.normalize_storage([{"name": "bev", "value": "abc"}])
        self.assertEqual(storage["cookies"][0]["domain"], ".airbnb.es")

    def test_duplicates_keep_the_furthest_expiry(self):
        storage = module.normalize_storage([
            {"name": "bev", "value": "old", "domain": ".airbnb.es", "expires": 1800000000},
            {"name": "bev", "value": "new", "domain": ".airbnb.es", "expires": 1900000000},
        ])
        self.assertEqual(len(storage["cookies"]), 1)
        self.assertEqual(storage["cookies"][0]["value"], "new")

    def test_same_name_on_different_domains_is_kept(self):
        storage = module.normalize_storage([
            {"name": "bev", "value": "es", "domain": ".airbnb.es"},
            {"name": "bev", "value": "com", "domain": ".airbnb.com"},
        ])
        self.assertEqual(len(storage["cookies"]), 2)

    def test_entries_without_value_are_skipped(self):
        storage = module.normalize_storage([
            {"name": "bev", "domain": ".airbnb.es"},
            {"value": "abc", "domain": ".airbnb.es"},
            {"name": "li", "value": "1", "domain": ".airbnb.es"},
        ])
        self.assertEqual([c["name"] for c in storage["cookies"]], ["li"])

    def test_no_airbnb_cookies_raises(self):
        with self.assertRaises(ValueError):
            module.normalize_storage([{"name": "x", "value": "1", "domain": ".other"}])

    def test_unknown_shape_raises(self):
        with self.assertRaises(ValueError):
            module.normalize_storage({"cookies": "nope"})

    def test_cookie_jar_maps_names_to_values(self):
        storage = module.normalize_storage([
            {"name": "bev", "value": "abc", "domain": ".airbnb.es"},
            {"name": "li", "value": "1", "domain": ".airbnb.es"},
        ])
        self.assertEqual(module.cookie_jar(storage), {"bev": "abc", "li": "1"})


class ToSecondsTest(unittest.TestCase):
    def test_milliseconds_are_converted(self):
        self.assertAlmostEqual(module.to_seconds(1830180214000), 1830180214.0)

    def test_seconds_are_kept(self):
        self.assertAlmostEqual(module.to_seconds(1830180214), 1830180214.0)

    def test_missing_expiry_is_minus_one(self):
        self.assertEqual(module.to_seconds(-1), -1)
        self.assertEqual(module.to_seconds(None), -1)
        self.assertEqual(module.to_seconds("nonsense"), -1)


class LoadPayloadTest(unittest.TestCase):
    def test_reads_a_file(self):
        from tempfile import NamedTemporaryFile
        with NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump([{"name": "bev", "value": "abc", "domain": ".airbnb.es"}], handle)
            path = handle.name
        payload = module.load_payload(session_path=path)
        self.assertEqual(payload[0]["name"], "bev")
        Path(path).unlink()

    def test_invalid_json_raises_value_error(self):
        from tempfile import NamedTemporaryFile
        with NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            handle.write("{not json")
            path = handle.name
        with self.assertRaises(ValueError):
            module.load_payload(session_path=path)
        Path(path).unlink()


class BadInputExitCodeTest(unittest.TestCase):
    def test_unusable_input_exits_with_bad_input_code(self):
        from tempfile import NamedTemporaryFile
        with NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump({"cookies": []}, handle)
            path = handle.name
        code = module.main(["--pairing-code", "ABC123", "--session", path])
        self.assertEqual(code, module.EXIT_BAD_INPUT)
        Path(path).unlink()


if __name__ == "__main__":
    unittest.main()
