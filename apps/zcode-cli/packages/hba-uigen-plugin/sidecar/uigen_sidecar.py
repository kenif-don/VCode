#!/usr/bin/env python3
"""uigen_sidecar.py — Python stdio adapter for the hba-uigen plugin (FR-2).

Zero third-party dependencies (Python standard library only). JSON in, JSON
out.

Usage:
    python uigen_sidecar.py <subcommand> ['<json-args>']
    echo '<json-args>' | python uigen_sidecar.py <subcommand>

Subcommands (0.3.0 — 磁盘即真源,无版本概念):
    generate       {prompt, format?, screenCount?} -> multi-screen prototype,
                   written straight to screens/ + index.json
    list_screens   {limit?}                        -> screen manifest
    get_screen     {id}                            -> one screen + artifacts
    save_screen    {id?, name, html?, jsx?, vue?, hotspots?, order?}
                                                    -> create/update on disk
    delete_screen  {id}                            -> delete files + entry
    export         {targetDir?}                    -> copy screens out (FR-2-8)
    import_dir     {dir}                           -> import *.html (FR-2-6)

HBA reuse (best effort):
    If HBA_ROOT points at the HBA repository its ui_gen prompt modules are
    imported and reused for generation metadata. Any failure degrades to the
    built-in demo generator, identical to the one in server.mjs.

Store layout (shared with server.mjs):
    <storeDir>/screens/<screenId>.html   main artifact (same-name .jsx/.vue)
    <storeDir>/index.json                { version: 1, updatedAt, screens: [...] }
    <storeDir>/canvas-layout.json        canvas layout (owned by server.mjs)
    storeDir = $UIGEN_STORE_DIR or <cwd>/.hba/uigen
    Legacy versions.json / <versionId>/ dirs are no longer read.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# store — shared layout with plugins/hba-uigen/server.mjs
# ---------------------------------------------------------------------------


def store_dir() -> Path:
    env = (os.environ.get("UIGEN_STORE_DIR") or "").strip()
    return Path(env).resolve() if env else (Path.cwd() / ".hba" / "uigen").resolve()


def screens_dir() -> Path:
    d = store_dir() / "screens"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _write_text(target: Path, text: str) -> None:
    """Write UTF-8 text with LF newlines (no Windows CRLF translation), so the
    byte counts we report match the files and match server.mjs output."""
    with open(target, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _read_index() -> dict:
    try:
        idx = json.loads((store_dir() / "index.json").read_text(encoding="utf-8"))
        if isinstance(idx, dict) and isinstance(idx.get("screens"), list):
            return idx
    except (OSError, ValueError):
        pass
    return {"version": 1, "updatedAt": "", "screens": []}


def _write_index(idx: dict) -> None:
    store_dir().mkdir(parents=True, exist_ok=True)
    idx["updatedAt"] = _now_iso()
    _write_text(
        store_dir() / "index.json",
        json.dumps(idx, ensure_ascii=False, indent=2),
    )


def _sanitize_id(raw: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", str(raw))[:64]


def _write_screen_files(screen: dict) -> dict:
    """Write html (always) + jsx/vue (non-empty); return the files mapping."""
    sdir = screens_dir()
    files = {"html": f"{screen['id']}.html"}
    _write_text(sdir / files["html"], screen.get("html") or "")
    for ext in ("jsx", "vue"):
        body = screen.get(ext) or ""
        if body.strip():
            _write_text(sdir / f"{screen['id']}.{ext}", body)
            files[ext] = f"{screen['id']}.{ext}"
    return files


def _remove_screen_files(screen_id: str) -> None:
    for ext in ("html", "jsx", "vue"):
        try:
            (screens_dir() / f"{screen_id}.{ext}").unlink()
        except OSError:
            pass


def _read_screen_file(fname: str | None) -> str:
    if not fname:
        return ""
    try:
        return (screens_dir() / fname).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _public_entry(entry: dict) -> dict:
    return {
        "id": entry.get("id"),
        "name": entry.get("name"),
        "files": entry.get("files") or {},
        "hotspots": entry.get("hotspots") or [],
        "order": entry.get("order"),
        "updatedAt": entry.get("updatedAt") or "",
    }


def persist_generated(screens: list[dict]) -> list[dict]:
    """Generation writes straight to disk: replace the whole manifest, drop
    files of screens that were not regenerated."""
    idx = _read_index()
    keep = {s["id"] for s in screens}
    for e in idx.get("screens", []):
        if e.get("id") not in keep:
            _remove_screen_files(e.get("id") or "")
    entries = []
    for i, s in enumerate(screens):
        entries.append(
            {
                "id": s["id"],
                "name": s.get("name") or s["id"],
                "files": _write_screen_files(s),
                "hotspots": s.get("hotspots") or [],
                "order": i,
                "updatedAt": _now_iso(),
            }
        )
    _write_index({"version": 1, "updatedAt": "", "screens": entries})
    return entries


def list_screens(limit: int = 100) -> list[dict]:
    idx = _read_index()
    try:
        limit = max(1, int(limit or 100))
    except (TypeError, ValueError):
        limit = 100
    screens = sorted(idx.get("screens", []), key=lambda e: e.get("order") or 0)
    return [_public_entry(e) for e in screens[:limit]]


def get_screen(screen_id: str) -> dict | None:
    idx = _read_index()
    entry = next((e for e in idx.get("screens", []) if e.get("id") == screen_id), None)
    if not entry:
        return None
    files = entry.get("files") or {}
    return {
        "id": entry.get("id"),
        "name": entry.get("name"),
        "order": entry.get("order"),
        "hotspots": entry.get("hotspots") or [],
        "files": files,
        "updatedAt": entry.get("updatedAt") or "",
        "html": _read_screen_file(files.get("html")),
        "jsx": _read_screen_file(files.get("jsx")),
        "vue": _read_screen_file(files.get("vue")),
    }

# ---------------------------------------------------------------------------
# HBA reuse — best effort, never fatal
# ---------------------------------------------------------------------------


def try_hba() -> dict | None:
    """Try to import HBA ui_gen prompt modules. Returns a dict of prompt texts
    or None on any failure (missing HBA_ROOT, missing deps, import errors)."""
    if (os.environ.get("UIGEN_FORCE_DEMO") or "").strip():
        return None
    root = (os.environ.get("HBA_ROOT") or "").strip()
    if not root or not Path(root).is_dir():
        return None
    try:
        if root not in sys.path:
            sys.path.insert(0, root)
        from app.ui_gen.prompts import html_css, react_tailwind, vue_tailwind  # type: ignore

        base = None
        try:
            from app.ui_gen.prompts import base as _base  # type: ignore

            base = _base
        except Exception:  # noqa: BLE001 — optional constant
            base = None
        return {
            "html": getattr(html_css, "SYSTEM_PROMPT", ""),
            "jsx": getattr(react_tailwind, "SYSTEM_PROMPT", ""),
            "vue": getattr(vue_tailwind, "SYSTEM_PROMPT", ""),
            "mobile_width": getattr(base, "MOBILE_WIDTH", 390) if base else 390,
        }
    except Exception:  # noqa: BLE001 — any failure degrades to demo
        return None


# ---------------------------------------------------------------------------
# built-in demo generator — behaviour mirrored by server.mjs demoGenerate()
# ---------------------------------------------------------------------------

SCREEN_NAMES = [
    "首页",
    "列表页",
    "详情页",
    "个人中心",
    "设置页",
    "搜索页",
    "消息页",
    "订单页",
    "登录页",
    "结果页",
]


def _demo_cards(i: int) -> list[dict]:
    scene = ["浏览", "管理", "设置", "发现"][i % 4]
    return [
        {"t": "快速上手", "d": "三步完成配置，立即体验核心流程。"},
        {"t": "核心功能", "d": f"围绕「{scene}」场景设计的关键能力。"},
        {"t": "帮助与支持", "d": "常见问题与在线客服入口。"},
    ]


def _demo_html(i: int, title: str, prompt: str, hotspots: list[dict]) -> str:
    name = SCREEN_NAMES[i % len(SCREEN_NAMES)]
    cards = "\n".join(
        f'      <div class="card"><h2>{c["t"]}</h2><p>{c["d"]}</p></div>'
        for c in _demo_cards(i)
    )
    tabs = "\n".join(
        '      <a class="tab{on}" data-uigen-goto="{to}">{label}</a>'.format(
            on=" on" if h["to"] == f"s{i + 1}" else "",
            to=h["to"],
            label=h["label"],
        )
        for h in hotspots
    )
    hotspots_json = json.dumps(hotspots, ensure_ascii=False)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=390, initial-scale=1">
  <title>{name} · {title}</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; }}
    body {{ width: 390px; min-height: 844px; font-family: system-ui, sans-serif; background: #f5f6f8; color: #1f2329; }}
    .app-bar {{ height: 56px; display: flex; align-items: center; padding: 0 16px; background: #2b6cb0; color: #fff; font-size: 17px; font-weight: 600; }}
    main {{ padding: 16px; padding-bottom: 96px; }}
    h1 {{ font-size: 22px; margin-bottom: 6px; }}
    .sub {{ font-size: 12px; color: #6b7280; margin-bottom: 16px; }}
    .card {{ background: #fff; border-radius: 10px; padding: 14px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }}
    .card h2 {{ font-size: 15px; margin-bottom: 6px; }}
    .card p {{ font-size: 13px; color: #4b5563; line-height: 1.6; }}
    .tab-bar {{ position: fixed; left: 0; bottom: 0; width: 390px; height: 70px; display: flex; background: #fff; border-top: 1px solid #e5e7eb; }}
    .tab {{ flex: 1; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #6b7280; text-decoration: none; }}
    .tab.on {{ color: #2b6cb0; font-weight: 600; }}
  </style>
</head>
<body>
  <header class="app-bar">{title}</header>
  <main>
    <h1>{name}</h1>
    <p class="sub">uigen 演示生成 · 需求：{prompt or "(空)"}</p>
{cards}
  </main>
  <nav class="tab-bar">
{tabs}
  </nav>
  <script type="application/json" id="uigen-hotspots">{hotspots_json}</script>
</body>
</html>
"""


def _demo_jsx(i: int, title: str, prompt: str) -> str:
    name = SCREEN_NAMES[i % len(SCREEN_NAMES)]
    cards = "\n".join(
        f'        <div className="card"><h2>{c["t"]}</h2><p>{c["d"]}</p></div>'
        for c in _demo_cards(i)
    )
    return f"""// uigen demo artifact — screen {i + 1}: {name}
export default function Screen{i + 1}() {{
  return (
    <div className="phone" style={{{{ width: 390, minHeight: 844 }}}}>
      <header className="app-bar">{title}</header>
      <main>
        <h1>{name}</h1>
        <p className="sub">uigen 演示生成 · 需求：{prompt or "(空)"}</p>
{cards}
      </main>
      <nav className="tab-bar">{{/* hotspots: see ui state */}}</nav>
    </div>
  );
}}
"""


def _demo_vue(i: int, title: str, prompt: str) -> str:
    name = SCREEN_NAMES[i % len(SCREEN_NAMES)]
    cards = "\n".join(
        f'      <div class="card"><h2>{c["t"]}</h2><p>{c["d"]}</p></div>'
        for c in _demo_cards(i)
    )
    return f"""<template>
  <div class="phone">
    <header class="app-bar">{title}</header>
    <main>
      <h1>{name}</h1>
      <p class="sub">uigen 演示生成 · 需求：{prompt or "(空)"}</p>
{cards}
    </main>
    <nav class="tab-bar"><!-- hotspots: see ui state --></nav>
  </div>
</template>

<script>
// uigen demo artifact — screen {i + 1}: {name}
export default {{
  name: "Screen{i + 1}"
}};
</script>

<style scoped>
.phone {{ width: 390px; min-height: 844px; font-family: system-ui, sans-serif; }}
</style>
"""


def demo_generate(prompt: str, fmt: str, screen_count: int, on_screen=None) -> dict:
    count = min(10, max(1, int(screen_count or 3)))
    fmt = fmt if fmt in ("html", "jsx", "vue") else "html"
    title = (prompt or "").strip()[:12] or "UI 原型"
    short_prompt = (prompt or "").strip()[:40]
    screens: list[dict] = []
    tabs = min(count, 5)
    for i in range(count):
        hotspots = [
            {
                "to": f"s{j + 1}",
                "label": SCREEN_NAMES[j % len(SCREEN_NAMES)],
                "x": round((j * 390) / tabs),
                "y": 774,
                "w": 390 // tabs,
                "h": 70,
            }
            for j in range(tabs)
        ]
        screens.append(
            {
                "id": f"s{i + 1}",
                "name": SCREEN_NAMES[i % len(SCREEN_NAMES)],
                "html": _demo_html(i, title, short_prompt, hotspots),
                "jsx": _demo_jsx(i, title, short_prompt),
                "vue": _demo_vue(i, title, short_prompt),
                "hotspots": hotspots,
            }
        )
        if on_screen:
            on_screen(i + 1, count)
    return {
        "prompt": prompt or "",
        "format": fmt,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "screens": screens,
        "source": "demo",
    }



# ---------------------------------------------------------------------------
# import / export
# ---------------------------------------------------------------------------


def _imported_wrapper(kind: str, stem: str, html: str) -> str:
    banner = f"/* imported from {stem}.html — original markup embedded below */\n"
    safe_html = html.replace("*/", "* /")[:20000]
    ident = re.sub(r"[^A-Za-z0-9_$]", "", stem) or "ImportedScreen"
    if ident[0].isdigit():
        ident = f"Screen{ident}"
    if kind == "jsx":
        return (
            f"{banner}export default function {ident}() {{\n"
            "  // Original HTML kept for reference; port to JSX as needed.\n"
            f"  /*\n{safe_html}\n  */\n"
            f'  return <div data-imported="{stem}" />;\n}}\n'
        )
    return (
        f'<template>\n  <!-- imported from {stem}.html -->\n  <div data-imported="{stem}" />\n</template>\n\n'
        f"<script>\n{banner}export default {{\n  name: \"{ident}\"\n}};\n</script>\n"
    )


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------


def cmd_generate(args: dict) -> dict:
    prompt = str(args.get("prompt") or "")
    if not prompt.strip():
        return {"ok": False, "error": "prompt is required"}
    fmt = args.get("format") if args.get("format") in ("html", "jsx", "vue") else "html"
    try:
        screen_count = int(args.get("screenCount") or 3)
    except (TypeError, ValueError):
        screen_count = 3

    hba = try_hba()
    engine = "demo+hba-prompts" if hba else "demo"
    record = demo_generate(prompt, fmt, screen_count)
    if hba:
        record["hba"] = {
            "mobileWidth": hba.get("mobile_width", 390),
            "promptChars": {
                k: len(hba.get(k) or "") for k in ("html", "jsx", "vue")
            },
        }
    persist_generated(record["screens"])
    return {
        "ok": True,
        "engine": engine,
        "prompt": record["prompt"],
        "format": record["format"],
        "screenCount": len(record["screens"]),
        "screens": [
            {
                "id": s["id"],
                "name": s["name"],
                "html": s["html"],
                "jsx": s["jsx"],
                "vue": s["vue"],
                "hotspots": s.get("hotspots") or [],
            }
            for s in record["screens"]
        ],
    }


def cmd_list_screens(args: dict) -> dict:
    return {"ok": True, "screens": list_screens(args.get("limit") or 100)}


def cmd_get_screen(args: dict) -> dict:
    rec = get_screen(str(args.get("id") or ""))
    if not rec:
        return {"ok": False, "error": f"screen not found: {args.get('id')}"}
    return {"ok": True, "screen": rec}


def cmd_save_screen(args: dict) -> dict:
    name = str(args.get("name") or "").strip()
    if not name:
        return {"ok": False, "error": "name is required"}
    idx = _read_index()
    raw_id = str(args.get("id") or "").strip()
    sid = _sanitize_id(raw_id) if raw_id else ""
    entry = next((e for e in idx["screens"] if e.get("id") == sid), None) if sid else None
    if sid and not entry:
        entry = {"id": sid, "name": name, "files": {}, "hotspots": [], "order": len(idx["screens"]), "updatedAt": ""}
        idx["screens"].append(entry)
    elif not sid:
        used = {e.get("id") for e in idx["screens"]}
        n = len(idx["screens"]) + 1
        sid = f"s{n}"
        while sid in used:
            n += 1
            sid = f"s{n}"
        entry = {"id": sid, "name": name, "files": {}, "hotspots": [], "order": len(idx["screens"]), "updatedAt": ""}
        idx["screens"].append(entry)
    entry["name"] = name
    merged = {
        "id": sid,
        "html": args.get("html") if isinstance(args.get("html"), str) else _read_screen_file((entry.get("files") or {}).get("html")),
        "jsx": args.get("jsx") if isinstance(args.get("jsx"), str) else _read_screen_file((entry.get("files") or {}).get("jsx")),
        "vue": args.get("vue") if isinstance(args.get("vue"), str) else _read_screen_file((entry.get("files") or {}).get("vue")),
    }
    entry["files"] = _write_screen_files(merged)
    if isinstance(args.get("hotspots"), list):
        entry["hotspots"] = args["hotspots"]
    order = args.get("order")
    if isinstance(order, (int, float)) and not isinstance(order, bool):
        entry["order"] = int(order)
    entry["updatedAt"] = _now_iso()
    _write_index(idx)
    return {"ok": True, "screen": _public_entry(entry)}


def cmd_delete_screen(args: dict) -> dict:
    sid = _sanitize_id(str(args.get("id") or ""))
    if not sid:
        return {"ok": False, "error": "id is required"}
    idx = _read_index()
    at = next((i for i, e in enumerate(idx["screens"]) if e.get("id") == sid), None)
    if at is None:
        return {"ok": False, "error": f"screen not found: {sid}"}
    _remove_screen_files(sid)
    idx["screens"].pop(at)
    _write_index(idx)
    return {"ok": True, "deleted": sid}


def cmd_export(args: dict) -> dict:
    idx = _read_index()
    if not idx["screens"]:
        return {"ok": False, "error": "no screens to export"}
    dest = Path(str(args.get("targetDir") or "")) if args.get("targetDir") else (store_dir() / "export")
    dest = dest.resolve()
    dest.mkdir(parents=True, exist_ok=True)
    files = []
    for e in idx["screens"]:
        for ext, fname in (e.get("files") or {}).items():
            src = screens_dir() / fname
            if not src.is_file():
                continue
            body = src.read_text(encoding="utf-8", errors="replace")
            name = f"{e['id']}-{re.sub(r'[\\/:*?\"<>|\s]+', '_', str(e.get('name') or e['id']))[:40]}.{ext}"
            _write_text(dest / name, body)
            files.append({"name": name, "bytes": len(body.encode("utf-8"))})
    manifest = {
        "exportedAt": _now_iso(),
        "screens": [_public_entry(e) for e in idx["screens"]],
        "files": [f["name"] for f in files],
    }
    manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2)
    _write_text(dest / "manifest.json", manifest_text)
    files.append({"name": "manifest.json", "bytes": len(manifest_text.encode("utf-8"))})
    return {"ok": True, "targetDir": str(dest), "screens": len(idx["screens"]), "files": files}


def cmd_import_dir(args: dict) -> dict:
    src = Path(str(args.get("dir") or "")).resolve()
    if not src.is_dir():
        return {"ok": False, "error": f"cannot read dir {src}"}
    html_files = sorted(p.name for p in src.iterdir() if p.is_file() and p.name.lower().endswith(".html"))
    if not html_files:
        return {"ok": False, "error": f"no *.html files in {src}"}
    idx = _read_index()
    made = []
    for i, name in enumerate(html_files):
        html = (src / name).read_text(encoding="utf-8", errors="replace")
        stem = re.sub(r"\.html?$", "", name, flags=re.IGNORECASE)
        base = _sanitize_id(stem) or f"import-{i + 1}"
        sid = base
        n = 2
        while any(e.get("id") == sid for e in idx["screens"]):
            sid = f"{base}-{n}"
            n += 1
        files = _write_screen_files(
            {"id": sid, "html": html, "jsx": _imported_wrapper("jsx", stem, html), "vue": _imported_wrapper("vue", stem, html)}
        )
        entry = {"id": sid, "name": stem[:20], "files": files, "hotspots": [], "order": len(idx["screens"]) + i, "updatedAt": _now_iso()}
        idx["screens"].append(entry)
        made.append({"id": sid, "name": entry["name"]})
    _write_index(idx)
    return {"ok": True, "imported": len(made), "dir": str(src), "screens": made}


COMMANDS = {
    "generate": cmd_generate,
    "list_screens": cmd_list_screens,
    "get_screen": cmd_get_screen,
    "save_screen": cmd_save_screen,
    "delete_screen": cmd_delete_screen,
    "export": cmd_export,
    "import_dir": cmd_import_dir,
}


def main(argv: list[str]) -> int:
    # Windows consoles default to a legacy codepage; force UTF-8 stdio so the
    # JSON protocol survives Chinese prompts/artifacts.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 — non-tty or frozen runtime
            pass
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        sys.stderr.write(__doc__)
        return 2
    sub = argv[1]
    if sub not in COMMANDS:
        print(json.dumps({"ok": False, "error": f"unknown subcommand: {sub}"}))
        return 2
    raw = ""
    if len(argv) >= 3:
        arg = argv[2]
        if arg.startswith("@"):
            raw = Path(arg[1:]).read_text(encoding="utf-8")
        else:
            raw = arg
    elif not sys.stdin.isatty():
        raw = sys.stdin.read()
    try:
        args = json.loads(raw) if raw.strip() else {}
        if not isinstance(args, dict):
            raise ValueError("input must be a JSON object")
    except ValueError as e:
        print(json.dumps({"ok": False, "error": f"bad JSON input: {e}"}))
        return 2
    try:
        out = COMMANDS[sub](args)
    except Exception as e:  # noqa: BLE001 — surface as JSON error
        out = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
