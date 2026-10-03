/**
 * The motion of the donut chart's ring, written straight to the DOM so no animation frame re-renders React.
 * Each part has a pose (start, end and lift). New targets move every pose from where it is on screen, so a
 * change in the middle of a change never snaps. The first call sweeps the ring open from the top.
 */

export interface Range {
  readonly start: number;
  readonly end: number;
}

export interface Pose {
  start: number;
  end: number;
  /** 0 to 1: how far the part has lifted out of the ring. */
  lift: number;
}

interface Step {
  readonly pose: Pose;
  readonly from: Range;
  readonly to: Range;
  /** Wait before the trailing edge moves, so the parts open one after another. */
  readonly delay: number;
}

const sweepMs = 720;
const changeMs = 500;
const itemDelayMs = 35;
const liftSettleMs = 70;

const easeOut = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4);

export interface RingMotion {
  /**
   * Move toward `targets`. `order` lists the keys that have a place on the ring (for the first sweep's
   * stagger). A key not seen before starts as a point at its own start edge.
   */
  readonly retarget: (
    targets: ReadonlyMap<string, Range>,
    order: readonly string[],
    instant: boolean,
  ) => void;
  /** Lift one part (or none) out of the ring. */
  readonly setLift: (key: string | null, instant: boolean) => void;
  /** Paint the current poses once. */
  readonly paint: () => void;
  readonly stop: () => void;
}

export function createRingMotion(paint: (poses: ReadonlyMap<string, Pose>) => void): RingMotion {
  const poses = new Map<string, Pose>();
  let steps: readonly Step[] = [];
  let begin = 0;
  let duration = changeMs;
  let span = changeMs;
  let lifted: string | null = null;
  let frame = 0;
  let last = 0;
  let swept = false;

  const loop = (now: number): void => {
    frame = 0;
    const dt = last === 0 ? 16 : Math.min(now - last, 50);
    last = now;
    let busy = false;
    if (steps.length > 0) {
      for (const step of steps) {
        const lead = easeOut((now - begin) / duration);
        const trail = easeOut((now - begin - step.delay) / duration);
        step.pose.start = step.from.start + (step.to.start - step.from.start) * lead;
        step.pose.end = step.from.end + (step.to.end - step.from.end) * trail;
      }
      if (now - begin >= span) {
        for (const step of steps) {
          step.pose.start = step.to.start;
          step.pose.end = step.to.end;
        }
        steps = [];
      } else {
        busy = true;
      }
    }
    const k = 1 - Math.exp(-dt / liftSettleMs);
    for (const [key, pose] of poses) {
      const goal = key === lifted ? 1 : 0;
      const gap = goal - pose.lift;
      if (Math.abs(gap) < 0.004) {
        pose.lift = goal;
      } else {
        pose.lift += gap * k;
        busy = true;
      }
    }
    paint(poses);
    if (busy) frame = requestAnimationFrame(loop);
    else last = 0;
  };
  const run = (): void => {
    if (frame === 0) frame = requestAnimationFrame(loop);
  };
  const stop = (): void => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  };

  return {
    retarget(targets, order, instant) {
      const first = !swept;
      swept = true;
      const next: Step[] = [];
      for (const [key, to] of targets) {
        let pose = poses.get(key);
        if (pose === undefined) {
          pose = { start: 0, end: 0, lift: 0 };
          if (!first) {
            pose.start = to.start;
            pose.end = to.start;
          }
          poses.set(key, pose);
        }
        const index = order.indexOf(key);
        next.push({
          pose,
          from: { start: pose.start, end: pose.end },
          to,
          delay: first && index >= 0 ? 40 + index * itemDelayMs : 0,
        });
      }
      if (instant) {
        steps = [];
        for (const step of next) {
          step.pose.start = step.to.start;
          step.pose.end = step.to.end;
        }
        paint(poses);
        return;
      }
      steps = next;
      begin = performance.now();
      duration = first ? sweepMs : changeMs;
      span = duration + next.reduce((most, step) => Math.max(most, step.delay), 0);
      run();
    },
    setLift(key, instant) {
      lifted = key;
      if (instant) {
        for (const [name, pose] of poses) pose.lift = name === key ? 1 : 0;
        paint(poses);
        return;
      }
      run();
    },
    paint: () => paint(poses),
    stop,
  };
}
