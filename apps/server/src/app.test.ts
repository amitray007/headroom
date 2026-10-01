import { expect, test } from "bun:test";
import { z } from "zod";

import { connectionStateSchema } from "@headroom/core";

import { createApp } from "./app.ts";

const healthSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  connectionStates: z.array(connectionStateSchema),
});

test("healthz reports ok and the canonical connection states", async () => {
  const response = await createApp().request("/healthz");
  expect(response.status).toBe(200);
  const body = healthSchema.parse(await response.json());
  expect(body.connectionStates).toEqual(["ready", "partial", "reconnect_required", "paused"]);
});
