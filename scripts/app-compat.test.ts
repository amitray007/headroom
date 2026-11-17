import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { compatibilityProblems } from "./app-compat.ts";
import { serverSchemas } from "./app-contract.ts";

const feed = (schema: Record<string, unknown>) => ({
  paths: {
    "/api/app/v1/feed": {
      get: {
        responses: {
          "200": {
            content: { "application/json": { schema: { $ref: "#/components/schemas/Feed" } } },
          },
        },
      },
    },
  },
  components: { schemas: { Feed: schema } },
});

const app = feed({
  type: "object",
  required: ["apiVersion", "provider"],
  properties: {
    apiVersion: { type: "integer" },
    provider: { type: "string", enum: ["claude", "codex"] },
    note: { type: ["string", "null"] },
  },
});

describe("Mac compatibility check", () => {
  test("the server satisfies the app built from the committed contract", async () => {
    const contract = JSON.parse(
      await readFile(new URL("../apps/macos/Contract/openapi.json", import.meta.url), "utf8"),
    );
    const server = { paths: contract.paths, components: { schemas: serverSchemas() } };
    expect(compatibilityProblems(contract, server)).toEqual([]);
  });

  test("an added optional field keeps every app working", () => {
    const server = feed({
      type: "object",
      required: ["apiVersion", "provider"],
      properties: {
        apiVersion: { type: "integer" },
        provider: { type: "string", enum: ["claude", "codex"] },
        note: { type: "string" },
        added: { type: "string" },
      },
    });
    expect(compatibilityProblems(app, server)).toEqual([]);
  });

  test("a dropped required field, a new value and a new type break an app", () => {
    const server = feed({
      type: "object",
      required: ["provider"],
      properties: {
        apiVersion: { type: ["integer", "null"] },
        provider: { type: "string", enum: ["claude", "codex", "grok"] },
      },
    });
    expect(compatibilityProblems(app, server)).toEqual([
      "GET /api/app/v1/feed.apiVersion: required by the app, not always sent",
      "GET /api/app/v1/feed.apiVersion: sends null, which the app cannot read",
      'GET /api/app/v1/feed.provider: sends "grok", which the app does not know',
    ]);
  });

  test("an app that reads any string accepts a new value", () => {
    const open = feed({
      type: "object",
      required: ["provider"],
      properties: { provider: { type: "string" } },
    });
    const server = feed({
      type: "object",
      required: ["provider"],
      properties: { provider: { type: "string", enum: ["anything"] } },
    });
    expect(compatibilityProblems(open, server)).toEqual([]);
  });

  test("a removed endpoint and a newly required request field break an app", () => {
    const writer = {
      paths: {
        "/api/app/v1/read": {
          put: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { ids: { type: "array" } } },
                },
              },
            },
          },
        },
        "/api/app/v1/old": { get: {} },
      },
    };
    const server = {
      paths: {
        "/api/app/v1/read": {
          put: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ids", "read"],
                    properties: { ids: { type: "array" }, read: { type: "boolean" } },
                  },
                },
              },
            },
          },
        },
      },
    };
    expect(compatibilityProblems(writer, server)).toEqual([
      "PUT /api/app/v1/read body.read: now required, the app never sends it",
      "GET /api/app/v1/old: removed",
    ]);
  });
});
