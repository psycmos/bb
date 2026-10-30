import { describe, expect, it } from "vitest";
import { BB_DOCS_URL, bbHelpLinks, docsLinks } from "../src/docs-links.js";

const DOCS_NAV_SLUGS: ReadonlySet<string> = new Set([
  "",
  "install",
  "connect-your-agents",
  "quickstart-delegate-work",
  "switch-from-another-tool",
  "projects-threads-and-environments",
  "machines-servers-and-the-host-daemon",
  "child-threads-subagents-and-workflows",
  "agent-context",
  "security-privacy-and-teams",
  "send-steer-and-queue-messages",
  "fork-hand-off-or-switch-models",
  "choose-a-permission-mode",
  "view-diffs-and-pull-requests",
  "open-files-previews-and-links",
  "let-agents-use-a-browser",
  "get-notified",
  "organize-and-archive-threads",
  "dictate-messages-with-voice",
  "start-child-threads",
  "follow-child-threads-from-the-parent",
  "run-an-orchestrator-thread",
  "schedule-an-automation",
  "run-a-workflow",
  "plan-and-track-work-with-tasks",
  "claude-code",
  "codex",
  "pi",
  "add-acp-agents",
  "choose-a-model-reasoning-and-context-size",
  "use-several-accounts",
  "track-usage-limits-and-cost",
  "connect-mcp-servers",
  "add-and-share-skills",
  "use-skills-in-a-thread",
  "set-up-a-project",
  "choose-where-a-thread-runs",
  "run-threads-in-sandboxes",
  "add-a-machine",
  "run-bb-on-an-always-on-machine",
  "run-several-servers",
  "move-your-server-to-another-machine",
  "use-bb-on-your-phone",
  "set-up-remote-access",
  "find-and-install-plugins",
  "quickstart-build-a-plugin",
  "publish-to-the-marketplace",
  "change-the-theme-and-layout",
  "change-keyboard-shortcuts",
  "name-threads-and-branches",
  "cli",
  "keyboard-shortcuts",
  "settings",
  "configuration-files-and-environment-variables",
  "platform-support",
  "agent-feature-support",
  "plugin-sdk",
  "glossary",
  "find-your-problem",
  "bb-is-slow-or-uses-a-lot-of-memory",
  "bb-wont-install-update-or-start",
  "an-agent-wont-sign-in-or-cant-be-found",
  "a-model-is-missing-from-the-model-picker",
  "a-skill-is-missing-from-the-menu",
  "a-plugin-wont-install-or-load",
  "a-thread-environment-or-automation-is-stuck",
  "bb-connect-drops-or-wont-connect",
]);

function docsSlugOf(url: string): string {
  const parsed = new URL(url);
  expect(`${parsed.origin}/docs`).toBe(BB_DOCS_URL);
  expect(parsed.search).toBe("");
  expect(parsed.hash).toBe("");
  return parsed.pathname.replace(/^\/docs\/?/u, "");
}

describe("docsLinks", () => {
  it.each(Object.entries(docsLinks))(
    "%s points at a page in the docs nav",
    (_name, url) => {
      expect(DOCS_NAV_SLUGS.has(docsSlugOf(url))).toBe(true);
    },
  );

  it("links each in-app spot to its own page", () => {
    const urls = Object.values(docsLinks);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("bbHelpLinks", () => {
  it.each(Object.entries(bbHelpLinks))("%s is an https URL", (_name, url) => {
    expect(new URL(url).protocol).toBe("https:");
  });
});
