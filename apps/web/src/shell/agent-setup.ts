/** The AI clients Headroom explains how to connect. */
export type AgentClient = "claude" | "codex" | "cursor" | "other";

/** Display names, also the names given to tokens made for them. */
export const agentLabels: Readonly<Record<AgentClient, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  other: "Other",
};

/** What the snippet shows where the token goes before one exists. */
export const tokenPlaceholder = "<token>";

/** Where the setup goes and the text to put there. The token is the real one, or the placeholder when null. */
export function setupFor(
  client: Exclude<AgentClient, "other">,
  mcpUrl: string,
  token: string | null,
): { readonly where: string; readonly code: string } {
  const key = token ?? tokenPlaceholder;
  switch (client) {
    case "claude":
      return {
        where: "Terminal",
        code: [
          "claude mcp add --transport http --scope user headroom \\",
          `  ${mcpUrl} \\`,
          `  --header "Authorization: Bearer ${key}"`,
        ].join("\n"),
      };
    case "codex":
      return {
        where: "~/.codex/config.toml",
        code: [
          "[mcp_servers.headroom]",
          `url = "${mcpUrl}"`,
          "",
          "[mcp_servers.headroom.http_headers]",
          `Authorization = "Bearer ${key}"`,
        ].join("\n"),
      };
    case "cursor":
      return {
        where: "~/.cursor/mcp.json",
        code: [
          "{",
          '  "mcpServers": {',
          '    "headroom": {',
          `      "url": "${mcpUrl}",`,
          '      "headers": {',
          `        "Authorization": "Bearer ${key}"`,
          "      }",
          "    }",
          "  }",
          "}",
        ].join("\n"),
      };
  }
}

/** The header an unlisted client sends with every request. */
export function headerFor(token: string | null): string {
  return `Authorization: Bearer ${token ?? tokenPlaceholder}`;
}
