import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGuideArea } from "../src/areas/guide.js";
import {
  docsIndexDocuments,
  loadSkillDocuments,
  parseGuideSearchQuery,
  rankGuideSearchDocuments,
  type GuideSearchDocument,
} from "../src/areas/guide-search.js";

const DOCS_BASE_URL = "https://docs.example/docs";

function docsIndex() {
  return {
    type: "advanced",
    docs: {
      count: 7,
      docs: {
        "1": {
          id: "/docs/machines",
          page_id: "/docs/machines",
          type: "page",
          content: "Add a machine",
          url: "/docs/machines",
        },
        "2": {
          id: "/docs/machines-0",
          page_id: "/docs/machines",
          type: "text",
          content: "Run bb on another computer and send threads to it.",
          url: "/docs/machines",
        },
        "3": {
          id: "/docs/machines-1",
          page_id: "/docs/machines",
          type: "heading",
          content: "Enroll over SSH",
          url: "/docs/machines#enroll-over-ssh",
        },
        "4": {
          id: "/docs/machines-2",
          page_id: "/docs/machines",
          type: "text",
          content: "Enrolling a machine over SSH installs the bb daemon.",
          url: "/docs/machines#enroll-over-ssh",
        },
        "5": {
          id: "/docs/phone",
          page_id: "/docs/phone",
          type: "page",
          content: "Use bb on your phone",
          url: "/docs/phone",
        },
        "6": {
          id: "/docs/phone-0",
          page_id: "/docs/phone",
          type: "text",
          content: "Pair your phone by scanning a QR code.",
          url: "/docs/phone",
        },
        "7": {
          id: "/docs/orphan-0",
          page_id: "/docs/orphan",
          type: "text",
          content: "Text from a page that has no title entry.",
          url: "/docs/orphan",
        },
      },
    },
  };
}

const temporaryDirectories: string[] = [];

async function skillRoot(skills: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bb-guide-search-"));
  temporaryDirectories.push(root);
  for (const [name, content] of Object.entries(skills)) {
    await mkdir(path.join(root, name), { recursive: true });
    await writeFile(path.join(root, name, "SKILL.md"), content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("docs search index", () => {
  it("turns each page section into one document with an absolute URL", () => {
    const documents = docsIndexDocuments(docsIndex(), DOCS_BASE_URL);

    expect(documents).toEqual([
      {
        source: "docs",
        title: "Add a machine",
        section: null,
        location: "https://docs.example/docs/machines",
        text: "Run bb on another computer and send threads to it.",
      },
      {
        source: "docs",
        title: "Add a machine",
        section: "Enroll over SSH",
        location: "https://docs.example/docs/machines#enroll-over-ssh",
        text: "Enrolling a machine over SSH installs the bb daemon.",
      },
      {
        source: "docs",
        title: "Use bb on your phone",
        section: null,
        location: "https://docs.example/docs/phone",
        text: "Pair your phone by scanning a QR code.",
      },
    ]);
  });

  it("rejects an index that is not a docs search export", () => {
    expect(() => docsIndexDocuments({ pages: [] }, DOCS_BASE_URL)).toThrow();
  });
});

describe("ranking", () => {
  const documents: GuideSearchDocument[] = [
    {
      source: "skill",
      title: "deploy",
      section: "Steps",
      location: "/skills/deploy/SKILL.md",
      text: "Deploy the site after the machine is ready.",
    },
    {
      source: "guide",
      title: "Machines",
      section: "Machine commands",
      location: "bb guide machines",
      text: "bb machine enroll --bootstrap-file <path> adds a machine.",
    },
    {
      source: "docs",
      title: "Add a machine",
      section: "Enroll over SSH",
      location: "https://docs.example/docs/machines#enroll-over-ssh",
      text: "Enrolling a machine over SSH installs the bb daemon.",
    },
    {
      source: "docs",
      title: "Use bb on your phone",
      section: null,
      location: "https://docs.example/docs/phone",
      text: "Pair your phone by scanning a QR code.",
    },
  ];

  it("merges every source into one list ordered by relevance", () => {
    const results = rankGuideSearchDocuments(
      "how do I add a machine",
      documents,
      10,
    );

    expect(results.map((result) => result.location)).toEqual([
      "https://docs.example/docs/machines#enroll-over-ssh",
      "bb guide machines",
      "/skills/deploy/SKILL.md",
    ]);
  });

  it("puts a document matching every word above one matching a repeated single word", () => {
    const results = rankGuideSearchDocuments(
      "pair phone",
      [
        {
          source: "guide",
          title: "Phones",
          section: null,
          location: "bb guide phones",
          text: "phone phone phone phone phone",
        },
        ...documents,
      ],
      10,
    );

    expect(results[0]?.location).toBe("https://docs.example/docs/phone");
  });

  it("applies the limit", () => {
    expect(rankGuideSearchDocuments("machine", documents, 2)).toHaveLength(2);
  });

  it("returns the best matching line as the snippet", () => {
    const [result] = rankGuideSearchDocuments(
      "enroll machine",
      [
        {
          source: "guide",
          title: "Machines",
          section: null,
          location: "bb guide machines",
          text: "Unrelated opening line.\nbb machine enroll   --bootstrap-file <path>",
        },
      ],
      1,
    );

    expect(result?.snippet).toBe("bb machine enroll --bootstrap-file <path>");
  });

  it("returns nothing when no document shares a word with the query", () => {
    expect(rankGuideSearchDocuments("kubernetes", documents, 10)).toEqual([]);
  });
});

describe("query validation", () => {
  it("normalizes whitespace and applies the default limit", () => {
    expect(parseGuideSearchQuery({ query: "  add   a machine " })).toEqual({
      query: "add a machine",
      limit: 10,
    });
  });

  it.each([
    [{ query: "   " }, "must not be empty"],
    [{ query: "how do I" }, "no searchable words"],
    [{ query: "x".repeat(501) }, "at most 500"],
    [{ query: "machines", limit: 0 }, "from 1 to 50"],
    [{ query: "machines", limit: 51 }, "from 1 to 50"],
    [{ query: "machines", limit: 2.5 }, "from 1 to 50"],
  ])("rejects %j", (input, message) => {
    expect(() => parseGuideSearchQuery(input)).toThrow(message);
  });
});

describe("local skills", () => {
  it("reads name, description, and sections, and keeps the first skill of a name", async () => {
    const workspace = await skillRoot({
      deploy:
        '---\nname: deploy\ndescription: "Ship the site"\n---\n# Deploy\n\nRun the deploy.\n\n## Rollback\n\nRevert it.\n',
    });
    const user = await skillRoot({
      deploy: "---\nname: deploy\ndescription: Shadowed\n---\nIgnored.\n",
      notes: "No frontmatter here.\n",
    });

    const documents = await loadSkillDocuments([
      path.join(workspace, "missing"),
      workspace,
      user,
    ]);

    expect(
      documents.map(({ title, section, text }) => ({ title, section, text })),
    ).toEqual([
      { title: "deploy", section: null, text: "Ship the site" },
      { title: "deploy", section: "Deploy", text: "Run the deploy." },
      { title: "deploy", section: "Rollback", text: "Revert it." },
      { title: "notes", section: null, text: "No frontmatter here." },
    ]);
  });
});

type DocsServerHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

const servers: Server[] = [];

async function docsServer(handler: DocsServerHandler): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("docs server has no port");
  }
  return `http://127.0.0.1:${address.port}/docs`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("guide.search", () => {
  it("merges docs, guide chapters, and skills into one ranked list", async () => {
    const root = await skillRoot({
      "machine-setup":
        "---\nname: machine-setup\ndescription: Enroll a new machine for this team\n---\nSteps.\n",
    });
    const requested: string[] = [];
    const docsBaseUrl = await docsServer((request, response) => {
      requested.push(request.url ?? "");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(docsIndex()));
    });
    const guide = createGuideArea({ docsBaseUrl, skillRoots: [root] });

    const response = await guide.search({ query: "enroll machine", limit: 20 });

    expect(requested).toEqual(["/docs/search.json"]);
    expect(response.query).toBe("enroll machine");
    expect(response.docs).toEqual({
      url: `${docsBaseUrl}/search.json`,
      ok: true,
      error: null,
    });
    expect(response.results[0]).toEqual({
      source: "docs",
      title: "Add a machine",
      section: "Enroll over SSH",
      location: `${docsBaseUrl}/machines#enroll-over-ssh`,
      snippet: "Enrolling a machine over SSH installs the bb daemon.",
    });
    const sources = new Set(response.results.map((result) => result.source));
    expect(sources).toEqual(new Set(["docs", "guide", "skill"]));
    expect(response.results).toContainEqual(
      expect.objectContaining({
        source: "guide",
        title: "Machines",
        location: "bb guide machines",
      }),
    );
  });

  it.each<[string, DocsServerHandler, string]>([
    [
      "an HTTP error",
      (_request, response) => {
        response.statusCode = 503;
        response.end("unavailable");
      },
      "HTTP 503",
    ],
    [
      "not JSON",
      (_request, response) => response.end("<html></html>"),
      "search index is not JSON",
    ],
    [
      "an unrecognized index",
      (_request, response) => response.end(JSON.stringify({ hello: "world" })),
      "unrecognized search index format",
    ],
  ])(
    "falls back to local results when the docs return %s",
    async (_label, handler, error) => {
      const docsBaseUrl = await docsServer(handler);
      const guide = createGuideArea({ docsBaseUrl, skillRoots: [] });

      const response = await guide.search({ query: "enroll machine" });

      expect(response.docs).toEqual({
        url: `${docsBaseUrl}/search.json`,
        ok: false,
        error,
      });
      expect(response.results.length).toBeGreaterThan(0);
      expect(
        response.results.every((result) => result.source === "guide"),
      ).toBe(true);
    },
  );

  it("falls back to local results when nothing listens at the docs URL", async () => {
    const guide = createGuideArea({
      docsBaseUrl: "http://127.0.0.1:1/docs",
      skillRoots: [],
    });

    const response = await guide.search({ query: "terminal output" });

    expect(response.docs.ok).toBe(false);
    expect(response.docs.error).toContain("ECONNREFUSED");
    expect(response.results[0]?.location).toBe("bb guide terminals");
  });

  it("gives up on docs that do not answer within the timeout", async () => {
    const docsBaseUrl = await docsServer(() => {});
    const guide = createGuideArea({
      docsBaseUrl,
      skillRoots: [],
      docsTimeoutMs: 50,
    });

    const response = await guide.search({ query: "terminal output" });

    expect(response.docs.error).toBe("timed out after 50 ms");
    expect(response.results[0]?.location).toBe("bb guide terminals");
  });

  it("rejects an invalid query before reading any source", async () => {
    const guide = createGuideArea({
      docsBaseUrl: DOCS_BASE_URL,
      skillRoots: [],
      fetchIndex: async () => {
        throw new Error("must not fetch");
      },
    });

    await expect(guide.search({ query: " " })).rejects.toThrow(
      "must not be empty",
    );
  });
});
