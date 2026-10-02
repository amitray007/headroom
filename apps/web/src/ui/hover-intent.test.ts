import { beforeEach, describe, expect, test } from "bun:test";

import {
  createHoverIntent,
  hoverCloseDelay,
  hoverOpenDelay,
  type HoverIntent,
  type HoverTimers,
} from "./hover-intent.ts";

interface Task {
  readonly run: () => void;
  readonly at: number;
}

let now = 0;
let tasks: Task[] = [];
let open = false;
let intent: HoverIntent;

const timers: HoverTimers = {
  after: (run, ms) => {
    const task = { run, at: now + ms };
    tasks.push(task);
    return task;
  },
  cancel: (handle) => {
    tasks = tasks.filter((task) => task !== handle);
  },
};

function advance(ms: number): void {
  now += ms;
  const due = tasks.filter((task) => task.at <= now);
  tasks = tasks.filter((task) => task.at > now);
  for (const task of due) task.run();
}

beforeEach(() => {
  now = 0;
  tasks = [];
  open = false;
  intent = createHoverIntent({
    open: () => {
      open = true;
    },
    close: () => {
      open = false;
    },
    isOpen: () => open,
    timers,
  });
});

describe("hover intent", () => {
  test("opens only after the pointer rests", () => {
    intent.enter();
    advance(hoverOpenDelay - 1);
    expect(open).toBe(false);
    advance(1);
    expect(open).toBe(true);
  });

  test("a pointer that passes over opens nothing", () => {
    intent.enter();
    advance(40);
    intent.leave();
    advance(1000);
    expect(open).toBe(false);
  });

  test("closes after the grace delay, and moving into the panel cancels it", () => {
    intent.enter();
    advance(hoverOpenDelay);
    intent.leave();
    advance(hoverCloseDelay - 1);
    expect(open).toBe(true);
    intent.enter();
    advance(1000);
    expect(open).toBe(true);
    intent.leave();
    advance(hoverCloseDelay);
    expect(open).toBe(false);
  });

  test("a pinned layer stays open after the pointer leaves", () => {
    intent.enter();
    advance(hoverOpenDelay);
    intent.pin();
    intent.leave();
    advance(1000);
    expect(open).toBe(true);
    expect(intent.pinned()).toBe(true);
  });

  test("a click before the intent delay cancels the pending open", () => {
    intent.enter();
    intent.pin();
    advance(1000);
    expect(open).toBe(false);
  });

  test("reset forgets the pin", () => {
    intent.pin();
    intent.reset();
    expect(intent.pinned()).toBe(false);
  });
});
