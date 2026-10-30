import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  runCommand,
} from "../helpers/command-output-harness.js";
import { registerGuideCommand } from "../../commands/guide.js";

describe("bb guide command output", () => {
  setupCommandOutputTestEnvironment();

  it("bb guide unknown chapter lists available chapters", async () => {
    await expect(
      runCommand(["guide", "missing"], registerGuideCommand),
    ).rejects.toThrow("process.exit:1");

    const errorOutput = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(errorOutput).toContain("Unknown guide chapter 'missing'");
    expect(errorOutput).toContain(
      "Available: threads, thread-inspection, thread-messaging, thread-lifecycle, environments, agent-configuration, providers, projects, machines, terminals, browser, customization, plugins, json.",
    );
  });

  it("bb guide accepts the singular and synonym names agents guess", async () => {
    await runCommand(["guide", "thread", "--json"], registerGuideCommand);
    await runCommand(["guide", "host", "--json"], registerGuideCommand);

    const chapters = collectLogLines(vi.mocked(console.log)).map(
      (line) => JSON.parse(line).chapter,
    );
    expect(chapters).toEqual(["threads", "machines"]);
  });

  it("bb guide commands <group> lists each command once with its options and aliases", async () => {
    await runCommand(["guide", "commands", "terminal"], registerGuideCommand);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain(
      "bb terminal output|read <terminalId>  [--since-seq <n>] [--tail-bytes <n>] [--limit-chunks <n>] [--json]\n    Print terminal output",
    );
    expect(output).not.toContain("bb thread ");
  }, 30_000);

  it("bb guide commands without a group leaves options out and says how to get them", async () => {
    await runCommand(["guide", "commands"], registerGuideCommand);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("bb thread tell|message|send <id> [message]\n");
    expect(output).toContain("bb guide commands <group>");
  }, 30_000);

  it("bb guide commands guide lists the guide itself and its search subcommand", async () => {
    await runCommand(["guide", "commands", "guide"], registerGuideCommand);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("bb guide [chapter] [group]  [--json]\n");
    expect(output).toContain(
      "bb guide search <question>  [--limit <n>] [--json]\n",
    );
  }, 30_000);

  it("bb guide commands rejects a group that does not exist", async () => {
    await expect(
      runCommand(["guide", "commands", "nope"], registerGuideCommand),
    ).rejects.toThrow("process.exit:1");

    const errorOutput = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(errorOutput).toContain("Unknown command group 'nope'.");
    expect(errorOutput).toContain("Command groups: browser, status");
  }, 30_000);

  it("bb guide terminals renders the terminals chapter", async () => {
    await runCommand(["guide", "terminals"], registerGuideCommand);

    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "bb terminal list --thread <thread-id>",
    );
  });

  describe("bb guide search", () => {
    let home: string;
    const registerLikeCli = (program: Command) => {
      program.enablePositionalOptions();
      registerGuideCommand(program);
    };

    beforeEach(() => {
      home = mkdtempSync(path.join(tmpdir(), "bb-guide-search-cli-"));
      vi.stubEnv("HOME", home);
      vi.stubEnv("BB_DATA_DIR", path.join(home, ".bb"));
      vi.stubEnv("BB_DOCS_URL", "http://127.0.0.1:1/docs");
    });

    afterEach(() => {
      rmSync(home, { recursive: true, force: true });
    });

    it("prints the documented JSON shape and reports unreachable docs", async () => {
      await runCommand(
        ["guide", "search", "terminal output", "--limit", "2", "--json"],
        registerLikeCli,
      );

      const payload = JSON.parse(
        collectLogLines(vi.mocked(console.log)).join("\n"),
      );
      expect(Object.keys(payload)).toEqual(["query", "results", "docs"]);
      expect(payload.docs).toEqual({
        url: "http://127.0.0.1:1/docs/search.json",
        ok: false,
        error: expect.stringContaining("ECONNREFUSED"),
      });
      expect(payload.results).toHaveLength(2);
      expect(Object.keys(payload.results[0])).toEqual([
        "source",
        "title",
        "section",
        "location",
        "snippet",
      ]);
      expect(payload.results[0]).toMatchObject({
        source: "guide",
        location: "bb guide terminals",
      });
    });

    it("prints a ranked list and says the online docs were skipped", async () => {
      await runCommand(
        ["guide", "search", "enroll a machine"],
        registerLikeCli,
      );

      const output = collectLogLines(vi.mocked(console.log)).join("\n");
      expect(output).toMatch(/^1\. \[guide\] Machines/mu);
      expect(output).toContain("   bb guide machines");
      expect(output).toMatch(
        /\n\nOnline docs not searched \(http:\/\/127\.0\.0\.1:1\/docs\/search\.json: connect ECONNREFUSED [^)]+\); results are from this machine only\.$/u,
      );
    });

    it("still renders chapters and the command index", async () => {
      await runCommand(["guide", "terminals", "--json"], registerLikeCli);

      expect(
        JSON.parse(collectLogLines(vi.mocked(console.log)).join("\n")).chapter,
      ).toBe("terminals");
    });

    it.each([
      [["--limit", "ten"], "Invalid --limit 'ten'."],
      [["--limit", "0"], "Search limit must be an integer from 1 to 50."],
      [[], "has no searchable words"],
    ])("rejects invalid input %j", async (extra, message) => {
      const question = extra.length === 0 ? "how do I" : "machines";
      await expect(
        runCommand(["guide", "search", question, ...extra], registerLikeCli),
      ).rejects.toThrow("process.exit:1");

      expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
        message,
      );
    });
  });
});
