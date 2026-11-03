"""Build fr19 patch: snapshot(before) vs tree(after) for touched files.

Reconstructs pre-edit content for 3 test files by reversing the exact
string replacements fr19 applied, then emits a git-style unified diff.
"""
import os, shutil, subprocess

ROOT = r"D:\ai_workspace\AI IDE\hba-zcode-fork"
BASE = r"D:\ai_workspace\AI IDE\hba-on-zcode\scratch"
SNAP = os.path.join(BASE, "fr19-snapshot")
BEFORE = os.path.join(BASE, "fr19-before")
AFTER = os.path.join(BASE, "fr19-after")
OUT = r"D:\ai_workspace\AI IDE\hba-on-zcode\fork\patches\fr19-01-plugin-ui-session-anchor-fallback-rebind.patch"

# (new_text, old_text) pairs: before-content = after-content with new->old reversed
REVERSE = {
    "packages/ui/src/plugin-ui/contract.test.ts": [(
        """    // HBA fr8/fr19：面板（surface）跟随项目，key 不随会话变化（换锚重绑保持连续）；
    // 工具卡片（toolCall）仍按会话隔离。
    expect(buildPluginUiSurfaceKey({ ...scope, sessionId: "s2" }, surface)).toBe(
      buildPluginUiSurfaceKey(scope, surface),
    );
    const toolCall = { kind: "toolCall" as const, toolCallId: "c1" };
    expect(buildPluginUiSurfaceKey(scope, toolCall)).not.toBe(
      buildPluginUiSurfaceKey({ ...scope, sessionId: "s2" }, toolCall),
    );
""", "")],
    "packages/ui/src/plugin-ui/domain/pluginUiLogicalScope.test.ts": [
        ('  it("isolates same-named surfaces by server, resource and workspace; session is shared (HBA fr8/fr19)", () => {',
         '  it("isolates same-named surfaces by server, resource, workspace and session", () => {'),
        ("""      { workspaceIdentity: "other" },
    ])
      expect(buildPluginUiSurfaceKey({ ...base, ...changed }, scope)).not.toBe(key);
    // 面板跟随项目、跨会话共用：会话位不参与 key（换锚重绑保持 widgetState 连续）。
    expect(buildPluginUiSurfaceKey({ ...base, sessionId: "other" }, scope)).toBe(key);
  });""",
         """      { workspaceIdentity: "other" },
      { sessionId: "other" },
    ])
      expect(buildPluginUiSurfaceKey({ ...base, ...changed }, scope)).not.toBe(key);
  });"""),
    ],
    "packages/ui/test/pluginUiBackground.test.ts": [(
        """  it("同插件不同会话共享同一面板（HBA fr8/fr19：surface 跟随项目）", async () => {
    const host = setup();
    host.send();
    host.send({ ...result, sessionId: "other" });
    await vi.waitFor(() => expect(createPage).toHaveBeenCalledTimes(1));
    const page = vi.mocked(createPage).mock.results[0]!.value;
    // 两次结果都投喂同一个 guest，不再按会话拆页。
    await vi.waitFor(() => expect(page.updateToolFeed).toHaveBeenCalledTimes(2));
    host.off();
  });""",
        """  it("同插件不同会话隔离", async () => {
    const host = setup();
    host.send();
    host.send({ ...result, sessionId: "other" });
    await vi.waitFor(() => expect(createPage).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createPage).mock.calls[0]![0]).not.toBe(
      vi.mocked(createPage).mock.calls[1]![0],
    );
    host.off();
  });""")],
}

# new files introduced by fr19
NEW_FILES = [
    "apps/zcode-cli/packages/bootstrap/tests/mcp-ui-session-fallback.test.ts",
]

for d in (BEFORE, AFTER):
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)

pairs = []  # (rel, before_path_or_None, after_path)

# snapshotted source files
for root, _, files in os.walk(SNAP):
    for f in files:
        p = os.path.join(root, f)
        rel = os.path.relpath(p, SNAP).replace(os.sep, "/")
        pairs.append((rel, p, os.path.join(ROOT, rel)))

# reconstructed test files
for rel, swaps in REVERSE.items():
    after_path = os.path.join(ROOT, rel)
    with open(after_path, "rb") as fh:
        raw = fh.read()
    crlf = b"\r\n" in raw
    content = raw.decode("utf-8").replace("\r\n", "\n")
    for new, old in swaps:
        if new not in content:
            raise SystemExit(f"reverse anchor not found in {rel}: {new[:60]!r}")
        content = content.replace(new, old, 1)
    if crlf:
        content = content.replace("\n", "\r\n")
    before_path = os.path.join(BEFORE, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(before_path), exist_ok=True)
    with open(before_path, "wb") as fh:
        fh.write(content.encode("utf-8"))
    pairs.append((rel, before_path, after_path))

# new files
for rel in NEW_FILES:
    pairs.append((rel, None, os.path.join(ROOT, rel)))

pairs.sort()
chunks = []
for rel, before_path, after_path in pairs:
    before_out = os.path.join(BEFORE, rel.replace("/", os.sep))
    after_out = os.path.join(AFTER, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(before_out), exist_ok=True)
    os.makedirs(os.path.dirname(after_out), exist_ok=True)
    if before_path is None:
        open(before_out, "w").close()  # empty placeholder for /dev/null-style diff
    elif os.path.abspath(before_path) != os.path.abspath(before_out):
        shutil.copyfile(before_path, before_out)
    shutil.copyfile(after_path, after_out)

result = subprocess.run(
    ["git", "diff", "--no-index", "--src-prefix=a/", "--dst-prefix=b/", "fr19-before", "fr19-after"],
    capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=BASE,
)
diff = result.stdout
# normalize paths: strip the staging dirs so paths are repo-relative
diff = diff.replace("a/fr19-before/", "a/").replace("b/fr19-after/", "b/")

# rewrite the placeholder-empty -> real-new-file diff headers
newset = {rel for rel, b, _ in pairs if b is None}
if newset:
    lines = diff.splitlines(keepends=True)
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("diff --git "):
            m = line.split(" b/")[-1].strip()
            block = [line]
            i += 1
            while i < len(lines) and not lines[i].startswith("diff --git "):
                block.append(lines[i])
                i += 1
            if m in newset:
                block.insert(1, "new file mode 100644\n")
                block = [l for l in block if not l.startswith("index 0000000..")
                         or True]
                # drop the empty-file index line duplication: keep as-is (git tolerates)
            out.extend(block)
        else:
            out.append(line)
            i += 1
    diff = "".join(out)

with open(OUT, "w", encoding="utf-8", newline="") as fh:
    fh.write(diff)
print("wrote", OUT, len(diff), "bytes")
