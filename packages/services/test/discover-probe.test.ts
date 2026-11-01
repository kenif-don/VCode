import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { createGitService } from "../src/git/gitService.js";
import { scanNestedGitRepositories } from "../src/git/repo/gitRepoDiscovery.js";

const BS = String.fromCharCode(92);
const WIN = "D:" + BS + "ai_workspace" + BS + "AI IDE";

describe("clean backslash probe", () => {
  it("no escaping contamination", async () => {
    const lines: string[] = [];
    lines.push(`WIN repr: ${JSON.stringify(WIN)}`);
    try {
      const entries = await readdir(WIN, { withFileTypes: true });
      lines.push(`readdir OK: ${entries.length} entries`);
      const st = await lstat(join(WIN, "HBA", ".git"));
      lines.push(`lstat HBA/.git OK dir=${st.isDirectory()}`);
    } catch (e) {
      lines.push(`fs FAILED: ${(e as Error).message}`);
    }
    const scan = await scanNestedGitRepositories(WIN, {});
    lines.push(`scan WIN: ${scan.repositories.length}`);
    const svc = createGitService();
    const d = await svc.discoverRepositories({ workspacePath: WIN });
    lines.push(`discover WIN: ${d.repositories.length}`);
    const r = await svc.refresh({ workspacePath: WIN + BS + "HBA" });
    lines.push(`refresh HBA WIN: isRepo=${r.summary.isRepository} branch=${r.summary.branchName}`);
    writeFileSync("D:/ai_workspace/AI IDE/hba-zcode-fork/discover-probe.out.txt", lines.join("\n"));
    expect(lines.length).toBeGreaterThan(0);
  }, 30000);
});
