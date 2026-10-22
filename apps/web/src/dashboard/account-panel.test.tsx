import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import type { ComponentProps } from "react";
import { renderToString } from "react-dom/server";

import { connection, credit } from "@headroom/view-model/test-fixtures";
import { ApiError, api } from "../api.ts";
import * as holdButton from "../ui/hold-button.tsx";
import * as motion from "../ui/motion.ts";
import { AccountPanel } from "./account-panel.tsx";

const account = connection("codex", {
  resetCredits: [credit("credit-1")],
  actions: { enabled: true, supported: ["consume_reset_credit"] },
});

let consume: Mock<typeof api.consumeResetCredit>;
let button: Mock<typeof holdButton.HoldButton>;
let reducedMotion: Mock<typeof motion.prefersReducedMotion>;

beforeEach(() => {
  consume = spyOn(api, "consumeResetCredit");
  button = spyOn(holdButton, "HoldButton");
  reducedMotion = spyOn(motion, "prefersReducedMotion").mockReturnValue(true);
});

afterEach(() => {
  consume.mockRestore();
  button.mockRestore();
  reducedMotion.mockRestore();
});

function confirm(onChanged: () => Promise<void>) {
  let onConfirm: ComponentProps<typeof holdButton.HoldButton>["onConfirm"] | undefined;
  button.mockImplementation((props) => {
    onConfirm = props.onConfirm;
    return <button>{props.label}</button>;
  });
  renderToString(
    <AccountPanel
      connection={account}
      closed={false}
      onChanged={onChanged}
      onDisconnected={() => undefined}
    />,
  );
  if (!onConfirm) throw new Error("reset button was not rendered");
  return onConfirm();
}

function outcome(state: "succeeded" | "failed" | "uncertain") {
  return {
    action: {
      id: "action-1",
      action: "consume_reset_credit" as const,
      state,
      requestedAt: 1000,
      completedAt: 2000,
      providerReference: null,
      sanitizedError: null,
    },
  };
}

describe("account reset refresh", () => {
  test("refreshes when the reset resolves without waiting for the dashboard read", async () => {
    const reset = Promise.withResolvers<Awaited<ReturnType<typeof api.consumeResetCredit>>>();
    const reload = Promise.withResolvers<void>();
    let reloads = 0;
    consume.mockReturnValue(reset.promise);
    const result = confirm(() => {
      reloads += 1;
      return reload.promise;
    });
    expect(reloads).toBe(0);
    reset.resolve(outcome("succeeded"));
    expect(await result).toBe("ok");
    expect(reloads).toBe(1);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith(account.id, "credit-1");
    reload.resolve();
  });

  test.each([
    ["succeeded", "ok"],
    ["failed", "failed"],
    ["uncertain", "unknown"],
  ] as const)("keeps %s feedback when the dashboard read fails", async (state, expected) => {
    consume.mockResolvedValue(outcome(state));
    let reloads = 0;
    expect(
      await confirm(() => {
        reloads += 1;
        return Promise.reject(new Error("overview unavailable"));
      }),
    ).toBe(expected);
    expect(reloads).toBe(1);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  test.each([
    [403, "failed"],
    [500, "unknown"],
  ] as const)("preserves the reset error outcome for HTTP %s", async (status, expected) => {
    consume.mockRejectedValue(new ApiError(status, "reset unavailable"));
    let reloads = 0;
    expect(
      await confirm(() => {
        reloads += 1;
        return Promise.resolve();
      }),
    ).toBe(expected);
    expect(reloads).toBe(0);
    expect(consume).toHaveBeenCalledTimes(1);
  });
});
