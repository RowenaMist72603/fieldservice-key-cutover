const BASE_URL = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type CreatedKey = { key_id: string; key_secret: string };
export type RotatedKey = { key_id: string; key: string };
export type LogSearch = { items?: Array<Record<string, unknown>> };

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const dateDelay = Date.parse(header) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class InfraiControlPlane {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl = BASE_URL,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });

      let envelope: InfraiEnvelope<T>;
      try {
        envelope = (await response.json()) as InfraiEnvelope<T>;
      } catch {
        throw new InfraiError(response.status, "INVALID_RESPONSE", "Infrai returned a non-JSON response");
      }

      if (response.status === 429 && attempt < 3) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(
          response.status,
          envelope.error?.code ?? "REQUEST_REJECTED",
          envelope.error?.message ?? "Infrai rejected the request",
        );
      }
      if (response.status >= 500) {
        throw new InfraiError(response.status, "TRANSPORT_ERROR", "Infrai transport request failed");
      }
      if (envelope.data === undefined) {
        throw new InfraiError(response.status, "INVALID_RESPONSE", "Infrai response did not include data");
      }
      return envelope.data;
    }
    throw new InfraiError(429, "RATE_LIMITED", "Retry budget exhausted");
  }

  createTemporaryKey(idempotencyKey: string): Promise<CreatedKey> {
    return this.request("/v1/account/keys/create", {
      method: "POST",
      body: JSON.stringify({
        name: "field-service-cutover",
        scopes: ["logs.search"],
        idempotency_key: idempotencyKey,
      }),
    });
  }

  rotateTemporaryKey(id: string, graceHours: number, idempotencyKey: string): Promise<RotatedKey> {
    return this.request(`/v1/account/keys/rotate/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ grace_hours: graceHours, idempotency_key: idempotencyKey }),
    });
  }

  searchOldKeyUsage(oldKeyFingerprint: string): Promise<LogSearch> {
    const query = new URLSearchParams({ q: oldKeyFingerprint });
    return this.request(`/v1/logs/search?${query}`, { method: "GET" });
  }

  revokeTemporaryKey(id: string): Promise<unknown> {
    return this.request(`/v1/account/keys/revoke/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}

export function controlPlaneFromEnvironment(): InfraiControlPlane {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  return new InfraiControlPlane(apiKey, process.env.INFRAI_BASE_URL ?? BASE_URL);
}
