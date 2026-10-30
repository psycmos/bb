export const BB_DOCS_URL = "https://getbb.app/docs";

function docsPage(slug: string): string {
  return `${BB_DOCS_URL}/${slug}`;
}

export const docsLinks = {
  home: BB_DOCS_URL,
  keyboardShortcuts: docsPage("keyboard-shortcuts"),
  changeKeyboardShortcuts: docsPage("change-keyboard-shortcuts"),
  agentSignIn: docsPage("an-agent-wont-sign-in-or-cant-be-found"),
  memoryUse: docsPage("bb-is-slow-or-uses-a-lot-of-memory"),
  addMachine: docsPage("add-a-machine"),
  acpAgents: docsPage("add-acp-agents"),
  sandboxes: docsPage("run-threads-in-sandboxes"),
  installPlugins: docsPage("find-and-install-plugins"),
  mobile: docsPage("use-bb-on-your-phone"),
  usageLimits: docsPage("track-usage-limits-and-cost"),
  skills: docsPage("add-and-share-skills"),
  remoteAccess: docsPage("set-up-remote-access"),
} as const;

export const bbHelpLinks = {
  releaseNotes: "https://getbb.app/changelog",
  discord: "https://discord.gg/kvBU6tJhcJ",
  reportBug: "https://github.com/get-bb/bb/issues/new",
} as const;
