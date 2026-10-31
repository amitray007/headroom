import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "oxfmt";
import { z } from "zod";

import {
  appFeedSchema,
  appRefreshSchema,
  appWhoamiSchema,
} from "../packages/view-model/src/app-feed.ts";

const contractPath = fileURLToPath(new URL("../apps/macos/Contract/openapi.json", import.meta.url));
const errorSchema = z.strictObject({ error: z.string() });

function json(schema: z.ZodType) {
  const { $schema: _dialect, ...body } = z.toJSONSchema(schema, { target: "draft-2020-12" });
  return nullableTypes(body);
}

/** Apple's generator needs type unions rather than anyOf for nullable fields. */
function nullableTypes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(nullableTypes);
  if (value === null || typeof value !== "object") return value;
  const node = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, nullableTypes(item)]),
  );
  const variants = node["anyOf"];
  if (Array.isArray(variants) && variants.length === 2) {
    const nonNull = variants.find((item: Record<string, unknown>) => item["type"] !== "null");
    const hasNull = variants.some((item: Record<string, unknown>) => item["type"] === "null");
    if (hasNull && nonNull && typeof nonNull["type"] === "string") {
      const { anyOf: _variants, ...rest } = node;
      return {
        ...rest,
        ...nonNull,
        type: [nonNull["type"], "null"],
        ...(Array.isArray(nonNull["enum"]) ? { enum: [...nonNull["enum"], null] } : {}),
      };
    }
  }
  return node;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sorted(item)]),
    );
  return value;
}

function error(description: string) {
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function operation(operationId: string, schema: string) {
  return {
    operationId,
    security: [{ appToken: [] }],
    responses: {
      "200": {
        description: "Current source data. Cache-Control: no-store.",
        ...(operationId === "getAppFeed"
          ? {
              headers: {
                ETag: { schema: { type: "string" }, description: "Strong SHA-256 body validator." },
              },
            }
          : {}),
        content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } },
      },
      ...(operationId === "getAppFeed"
        ? {
            "304": {
              description: "The feed is unchanged. No response body.",
              headers: { ETag: { schema: { type: "string" } } },
            },
          }
        : {}),
      "400": error("Invalid query: invalid_tz."),
      "401": error("Missing, expired, revoked or invalid token: invalid_token."),
      "405": {
        ...error("Only GET and HEAD are allowed: method_not_allowed."),
        headers: { Allow: { schema: { type: "string", const: "GET, HEAD" } } },
      },
      "429": {
        ...error("Too many authentication attempts: rate_limited."),
        headers: { "Retry-After": { schema: { type: "string" } } },
      },
    },
  };
}

/** The one write: Refresh Every, for a token created with the `refresh` scope. */
const putRefresh = {
  operationId: "putAppRefresh",
  security: [{ appToken: [] }],
  requestBody: {
    required: true,
    content: { "application/json": { schema: { $ref: "#/components/schemas/AppRefresh" } } },
  },
  responses: {
    "200": {
      description:
        "The saved interval. The server collects on the new interval from its next tick.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/AppRefresh" } } },
    },
    "400": error("The body is not one of the allowed intervals: invalid_body."),
    "401": error("Missing, expired, revoked or invalid token: invalid_token."),
    "403": error("The token was created without the refresh scope: missing_permission."),
    "405": {
      ...error("Only PUT is allowed: method_not_allowed."),
      headers: { Allow: { schema: { type: "string", const: "PUT" } } },
    },
    "429": {
      ...error("Too many authentication attempts: rate_limited."),
      headers: { "Retry-After": { schema: { type: "string" } } },
    },
  },
};

export async function appContract(): Promise<string> {
  const document = {
    openapi: "3.1.0",
    info: { title: "Headroom App API", version: "1" },
    paths: {
      "/api/app/v1/feed": {
        get: {
          ...operation("getAppFeed", "AppFeed"),
          parameters: [
            {
              name: "tz",
              in: "query",
              required: false,
              description: "Whole minutes east of UTC. Plain integer; defaults to 0.",
              schema: { type: "integer", minimum: -720, maximum: 840, default: 0 },
            },
            { name: "If-None-Match", in: "header", required: false, schema: { type: "string" } },
          ],
        },
      },
      "/api/app/v1/whoami": { get: operation("getAppWhoami", "AppWhoami") },
      "/api/app/v1/settings/refresh": { put: putRefresh },
    },
    components: {
      securitySchemes: {
        appToken: { type: "http", scheme: "bearer", bearerFormat: "Headroom app token" },
      },
      schemas: {
        AppFeed: json(appFeedSchema),
        AppRefresh: json(appRefreshSchema),
        AppWhoami: json(appWhoamiSchema),
        Error: json(errorSchema),
      },
    },
  };
  return (
    await format("openapi.json", `${JSON.stringify(sorted(document), null, 2)}\n`, {
      printWidth: 100,
    })
  ).code;
}

/** A check never writes. A missing file is stale too. */
export async function syncAppContract(check: boolean, path = contractPath): Promise<boolean> {
  const expected = await appContract();
  if (check) return (await readFile(path, "utf8").catch(() => null)) === expected;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, expected);
  return true;
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  if (!(await syncAppContract(check))) {
    console.error(
      "App contract is stale. Run mise run mac:contract and commit apps/macos/Contract/openapi.json.",
    );
    process.exitCode = 1;
  }
}
