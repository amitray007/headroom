import type { Fetch } from "./notify/http.ts";
import { compareVersions, latestRelease, type LatestRelease } from "./update.ts";

const day = 24 * 60 * 60_000;

/** What `GET /api/version` returns: the running version and a newer release, when there is one. */
export interface VersionView {
  readonly version: string;
  readonly update: LatestRelease | null;
}

export interface ReleaseNoticeOptions {
  readonly version: string;
  readonly fetch: Fetch;
  readonly now: () => Date;
}

/**
 * The newest release on GitHub, asked at most once a day, so the dashboard can offer the update.
 * It sends nothing about the install. A failed read keeps the last answer.
 */
export class ReleaseNotice {
  private latest: LatestRelease | null = null;
  private checkedAt: number | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly deps: ReleaseNoticeOptions) {}

  /** The newest release from the last check, without asking GitHub. */
  known(): string | null {
    return this.latest?.version ?? null;
  }

  async view(): Promise<VersionView> {
    const at = this.deps.now().getTime();
    if (this.checkedAt === null || at - this.checkedAt >= day) {
      this.checkedAt = at;
      this.inFlight ??= this.check().finally(() => (this.inFlight = null));
    }
    if (this.inFlight) await this.inFlight;
    const newer = this.latest && compareVersions(this.latest.version, this.deps.version) > 0;
    return { version: this.deps.version, update: newer ? this.latest : null };
  }

  private async check(): Promise<void> {
    const release = await latestRelease(this.deps.fetch);
    if (typeof release !== "string") this.latest = release;
  }
}
