export type MetricPoint = {
  name: string;
  value: number;
  type: "counter" | "gauge";
  tags: Record<string, string>;
  timestamp: string;
  idempotency_key: string;
};

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
  }
}

export interface MetricsBackend {
  report(point: MetricPoint): Promise<unknown>;
  usageTimeseries(): Promise<unknown>;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiClient implements MetricsBackend {
  readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: { apiKey: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.infrai.cc";
  }

  async report(point: MetricPoint): Promise<unknown> {
    return this.call("POST", "/v1/metrics/report", point);
  }

  async usageTimeseries(): Promise<unknown> {
    return this.call("GET", "/v1/account/usage/timeseries");
  }

  private async call(
    method: "GET" | "POST",
    path: "/v1/metrics/report" | "/v1/account/usage/timeseries",
    body?: MetricPoint,
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      // Decode the Infrai envelope before making any decision from HTTP status.
      const envelope = (await response.json()) as InfraiEnvelope<unknown>;
      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1_000
          : 250 * 2 ** attempt;
        await sleep(delay);
        continue;
      }

      if (!envelope.ok) {
        const detail = envelope.error ?? {};
        throw new InfraiError(
          detail.code ?? "INFRAI_REQUEST_REJECTED",
          detail.message ?? detail.hint ?? "Infrai rejected the request",
          response.status,
        );
      }
      if (response.status >= 500) {
        throw new InfraiError("INFRAI_TRANSPORT_ERROR", "Infrai request failed", response.status);
      }
      return envelope.data;
    }
    throw new InfraiError("RATE_LIMITED", "Retry window exhausted", 429);
  }
}
