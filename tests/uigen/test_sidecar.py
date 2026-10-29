"""test_sidecar.py — end-to-end test of sidecar/uigen_sidecar.py (demo mode).

Zero third-party dependencies. Runs either way:
    python tests/uigen/test_sidecar.py      (plain assert script)
    pytest tests/uigen/test_sidecar.py      (if pytest is available)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SIDECAR = ROOT / "sidecar" / "uigen_sidecar.py"


def run_sidecar(sub: str, args: dict, store: Path) -> dict:
    """Invoke the sidecar over stdio exactly like server.mjs does."""
    env = dict(os.environ)
    env["UIGEN_STORE_DIR"] = str(store)
    env["UIGEN_FORCE_DEMO"] = "1"  # deterministic demo mode for tests
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.run(
        [sys.executable, str(SIDECAR), sub],
        input=json.dumps(args, ensure_ascii=False),
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
        cwd=str(ROOT),
        timeout=60,
    )
    assert proc.returncode == 0, f"sidecar {sub} exited {proc.returncode}: {proc.stderr}"
    out = json.loads(proc.stdout)
    assert isinstance(out, dict), f"sidecar {sub} must emit one JSON object"
    return out


class State:
    """Shared fixture state across test functions (works for script & pytest)."""

    tmp: Path | None = None
    store: Path | None = None
    version_id: str = ""


def _setup() -> tuple[Path, Path]:
    if State.tmp is None:
        State.tmp = Path(tempfile.mkdtemp(prefix="uigen-sidecar-test-"))
        State.store = State.tmp / "store"
        State.store.mkdir(parents=True, exist_ok=True)
    return State.tmp, State.store


def test_generate_demo_mode() -> None:
    tmp, store = _setup()
    out = run_sidecar(
        "generate",
        {
            "prompt": "社区图书馆借阅 App,含首页推荐、图书列表、详情页与个人中心",
            "format": "jsx",
            "screenCount": 4,
        },
        store,
    )
    assert out["ok"] is True, out
    assert out["engine"] in ("demo", "demo+hba-prompts"), out["engine"]
    assert out["format"] == "jsx"
    assert out["screenCount"] == 4
    assert len(out["screens"]) == 4
    for s in out["screens"]:
        assert s["id"] and s["name"], "screen has id and name"
        assert s["html"].startswith("<!doctype html>"), f"{s['id']} html is a full document"
        assert "width=390" in s["html"], f"{s['id']} html targets the 390px viewport"
        assert "export default" in s["jsx"], f"{s['id']} jsx is a component"
        assert "<template>" in s["vue"] and "export default" in s["vue"], f"{s['id']} vue is an SFC"
        assert isinstance(s["hotspots"], list) and len(s["hotspots"]) >= 1, f"{s['id']} has hotspots"
        for h in s["hotspots"]:
            assert h["to"] and isinstance(h["x"], int) and isinstance(h["w"], int)
    assert out["versionId"], "version persisted with an id"
    State.version_id = out["versionId"]

    # store layout shared with server.mjs
    assert (store / "versions.json").is_file()
    assert (store / out["versionId"] / "meta.json").is_file()
    assert (store / out["versionId"] / "screens" / "s1.html").is_file()
    assert (store / out["versionId"] / "screens" / "s1.jsx").is_file()
    assert (store / out["versionId"] / "screens" / "s1.vue").is_file()


def test_generate_requires_prompt() -> None:
    _, store = _setup()
    out = run_sidecar("generate", {"prompt": "   "}, store)
    assert out["ok"] is False and "prompt" in out["error"]


def test_list_versions() -> None:
    _, store = _setup()
    run_sidecar("generate", {"prompt": "第二版:外卖点餐", "screenCount": 2}, store)
    out = run_sidecar("list_versions", {"limit": 10}, store)
    assert out["ok"] is True
    ids = [v["id"] for v in out["versions"]]
    assert State.version_id in ids, "first version listed"
    assert len(ids) >= 2
    assert out["versions"][0]["id"] == ids[0], "newest first ordering kept"
    for v in out["versions"]:
        assert set(["id", "createdAt", "prompt", "format", "screenCount"]).issubset(v.keys())


def test_get_version() -> None:
    _, store = _setup()
    out = run_sidecar("get_version", {"versionId": State.version_id}, store)
    assert out["ok"] is True
    assert out["version"]["id"] == State.version_id
    assert len(out["version"]["screens"]) == 4
    assert out["version"]["screens"][0]["html"]
    missing = run_sidecar("get_version", {"versionId": "does-not-exist"}, store)
    assert missing["ok"] is False


def test_export() -> None:
    tmp, store = _setup()
    dest = tmp / "export"
    out = run_sidecar("export", {"versionId": State.version_id, "targetDir": str(dest)}, store)
    assert out["ok"] is True, out
    assert Path(out["targetDir"]) == dest
    names = [f["name"] for f in out["files"]]
    assert "manifest.json" in names
    assert len([n for n in names if n.endswith(".html")]) == 4
    assert len([n for n in names if n.endswith(".jsx")]) == 4
    assert len([n for n in names if n.endswith(".vue")]) == 4
    for f in out["files"]:
        p = dest / f["name"]
        assert p.is_file(), f"{f['name']} written"
        assert p.stat().st_size == f["bytes"], f"{f['name']} size matches"
    manifest = json.loads((dest / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["versionId"] == State.version_id
    assert len(manifest["screens"]) == 4


def test_import_dir() -> None:
    tmp, store = _setup()
    src = tmp / "proto"
    src.mkdir(parents=True, exist_ok=True)
    (src / "login.html").write_text("<!doctype html><html><body>登录</body></html>", encoding="utf-8")
    (src / "home.html").write_text("<!doctype html><html><body>首页</body></html>", encoding="utf-8")
    (src / "readme.txt").write_text("not html", encoding="utf-8")
    out = run_sidecar("import_dir", {"dir": str(src)}, store)
    assert out["ok"] is True, out
    assert out["imported"] == 2
    assert sorted(s["name"] for s in out["screens"]) == ["home", "login"]
    got = run_sidecar("get_version", {"versionId": out["versionId"]}, store)
    assert got["ok"] is True
    assert len(got["version"]["screens"]) == 2
    assert "<html>" in got["version"]["screens"][0]["html"]
    empty = run_sidecar("import_dir", {"dir": str(tmp / "no-such-dir")}, store)
    assert empty["ok"] is False


def test_cli_json_arg_form() -> None:
    """argv[2] JSON input works too (not only stdin)."""
    _, store = _setup()
    env = dict(os.environ)
    env["UIGEN_STORE_DIR"] = str(store)
    env["UIGEN_FORCE_DEMO"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.run(
        [sys.executable, str(SIDECAR), "generate", json.dumps({"prompt": "argv 形式", "screenCount": 1})],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
        cwd=str(ROOT),
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout)
    assert out["ok"] is True and out["screenCount"] == 1


TESTS = [
    test_generate_demo_mode,
    test_generate_requires_prompt,
    test_list_versions,
    test_get_version,
    test_export,
    test_import_dir,
    test_cli_json_arg_form,
]


def main() -> int:
    failures = 0
    for fn in TESTS:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"{len(TESTS) - failures}/{len(TESTS)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
