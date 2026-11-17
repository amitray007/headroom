import { describe, expect, test } from "bun:test";

import { headerFor, setupFor } from "./agent-setup.ts";

const url = "https://headroom.example.com/api/mcp";

describe("setupFor", () => {
  test("Claude Code adds the server from a terminal", () => {
    expect(setupFor("claude", url, "hr_abc")).toEqual({
      where: "Terminal",
      code:
        "claude mcp add --transport http --scope user headroom \\\n" +
        "  https://headroom.example.com/api/mcp \\\n" +
        '  --header "Authorization: Bearer hr_abc"',
    });
  });

  test("Codex writes TOML with a headers table", () => {
    expect(setupFor("codex", url, "hr_abc")).toEqual({
      where: "~/.codex/config.toml",
      code:
        "[mcp_servers.headroom]\n" +
        'url = "https://headroom.example.com/api/mcp"\n' +
        "\n" +
        "[mcp_servers.headroom.http_headers]\n" +
        'Authorization = "Bearer hr_abc"',
    });
  });

  test("Cursor writes JSON", () => {
    const { where, code } = setupFor("cursor", url, "hr_abc");
    expect(where).toBe("~/.cursor/mcp.json");
    expect(code).toBe(`{
  "mcpServers": {
    "headroom": {
      "url": "https://headroom.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer hr_abc"
      }
    }
  }
}`);
    expect(JSON.parse(code)).toEqual({
      mcpServers: {
        headroom: { url, headers: { Authorization: "Bearer hr_abc" } },
      },
    });
  });

  test("a missing token leaves the placeholder", () => {
    expect(setupFor("claude", url, null).code).toEndWith('Bearer <token>"');
    expect(setupFor("codex", url, null).code).toEndWith('Authorization = "Bearer <token>"');
    expect(setupFor("cursor", url, null).code).toContain('"Authorization": "Bearer <token>"');
  });
});

describe("headerFor", () => {
  test("names the bearer header", () => {
    expect(headerFor("hr_abc")).toBe("Authorization: Bearer hr_abc");
    expect(headerFor(null)).toBe("Authorization: Bearer <token>");
  });
});
