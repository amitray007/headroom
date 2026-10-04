import type { useOverview } from "../dashboard/use-overview.ts";

/** What every dashboard view receives: the one overview store the shell polls. */
export interface ViewProps {
  readonly overview: ReturnType<typeof useOverview>;
}
