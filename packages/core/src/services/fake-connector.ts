import type {
  BeginConnectOptions,
  Capability,
  ClassifiedError,
  CollectResult,
  ConnectProgress,
  Connector,
  DisconnectResult,
  Identity,
  RefreshResult,
  SubmitInput,
} from "../connector.ts";
import { classifyUnknown, ConnectorError } from "../connector.ts";
import type { StoredCredential } from "../credentials.ts";
import type { Provider } from "../enums.ts";

/**
 * Scriptable connector for service tests. Each method consumes the next queued
 * behaviour or falls back to a sensible default. Test-only; not exported from the package.
 */
export class FakeConnector implements Connector {
  readonly provider: Provider;
  readonly version = "fake-1";
  readonly interface = "private" as const;
  readonly supportedMethods = ["device_code", "api_key", "import"];

  readonly calls: string[] = [];
  beginQueue: ConnectProgress[] = [];
  pollQueue: ConnectProgress[] = [];
  submitQueue: ConnectProgress[] = [];
  identityResult: Identity | Error = {
    providerAccountId: "acct-1",
    workspaceId: null,
    label: "Fake",
    assurance: "strong",
  };
  capabilityResult: Capability[] = [
    {
      metricOrAction: "weekly",
      availability: "available",
      interface: "private",
      evidenceLevel: "validated",
    },
  ];
  collectQueue: (CollectResult | Error)[] = [];
  refreshQueue: (RefreshResult | Error)[] = [];
  disconnectResult: DisconnectResult = "local_only";

  constructor(provider: Provider = "codex") {
    this.provider = provider;
  }

  beginConnect(options: BeginConnectOptions): Promise<ConnectProgress> {
    this.calls.push(`begin:${options.method}`);
    return Promise.resolve(
      this.beginQueue.shift() ?? {
        status: "next_step",
        nextStep: {
          kind: "device_code",
          verificationUrl: "https://example.com/d",
          userCode: "ABCD",
          expiresAt: options.expiresAt,
        },
        privateState: { deviceId: "dev-1" },
      },
    );
  }

  submitInput(_privateState: unknown, input: SubmitInput): Promise<ConnectProgress> {
    this.calls.push(`submit:${input.kind}`);
    return Promise.resolve(
      this.submitQueue.shift() ?? { status: "credentials", credential: credentialFixture() },
    );
  }

  pollConnect(): Promise<ConnectProgress> {
    this.calls.push("poll");
    return Promise.resolve(
      this.pollQueue.shift() ?? {
        status: "waiting",
        privateState: { deviceId: "dev-1" },
        pollAfterMs: 5000,
      },
    );
  }

  cancelConnect(): Promise<void> {
    this.calls.push("cancel");
    return Promise.resolve();
  }

  identity(): Promise<Identity> {
    this.calls.push("identity");
    if (this.identityResult instanceof Error) return Promise.reject(this.identityResult);
    return Promise.resolve(this.identityResult);
  }

  capabilities(): Promise<readonly Capability[]> {
    this.calls.push("capabilities");
    return Promise.resolve(this.capabilityResult);
  }

  collect(): Promise<CollectResult> {
    this.calls.push("collect");
    const next = this.collectQueue.shift() ?? okCollect();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }

  refresh(): Promise<RefreshResult> {
    this.calls.push("refresh");
    const next = this.refreshQueue.shift() ?? {
      status: "refreshed",
      credential: credentialFixture("refreshed"),
    };
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }

  disconnect(): Promise<DisconnectResult> {
    this.calls.push("disconnect");
    return Promise.resolve(this.disconnectResult);
  }

  classify(error: unknown): ClassifiedError {
    return classifyUnknown(error);
  }
}

export function credentialFixture(access = "access-1"): StoredCredential {
  return { secret: { access, refresh: "refresh-1" }, expiresAt: 1_700_003_600_000 };
}

export function okCollect(percent = "42.5"): CollectResult {
  return {
    observedAt: 1_700_000_000_000,
    metrics: [
      {
        providerMetricKey: "weekly",
        kind: "quota_percentage",
        scope: "account",
        valueText: percent,
        unit: "percent",
        resetsAt: 1_700_604_800_000,
        availability: "available",
        interface: "private",
      },
    ],
    resetCredits: [{ providerCreditId: "rc-1", eligible: true, usable: true }],
    failures: [],
  };
}

export function partialCollect(): CollectResult {
  const base = okCollect();
  return {
    ...base,
    metrics: [
      ...base.metrics,
      {
        providerMetricKey: "credits",
        kind: "credits",
        scope: "account",
        valueText: null,
        unit: "credits",
        availability: "not_authorized",
        interface: "private",
      },
    ],
    failures: [
      { category: "permission_denied", class: "capability", message: "credits need admin" },
    ],
  };
}

export const authError = () => new ConnectorError("authentication_required", "401 from usage");
export const rateLimitError = () => new ConnectorError("rate_limited", "429", 30_000);
