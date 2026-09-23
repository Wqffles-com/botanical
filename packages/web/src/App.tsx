import { useState } from "react";

interface HealthBody {
  ok: boolean;
  service: string;
  mode: string;
}

function isHealthBody(value: unknown): value is HealthBody {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ok === "boolean" &&
    typeof record.service === "string" &&
    typeof record.mode === "string"
  );
}

export function App() {
  const [health, setHealth] = useState<HealthBody | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkHealth() {
    setError(null);
    try {
      const response = await fetch("/api/health");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body: unknown = await response.json();
      if (!isHealthBody(body)) {
        throw new Error("unexpected health payload");
      }
      setHealth(body);
    } catch (caught) {
      setHealth(null);
      setError(caught instanceof Error ? caught.message : "request failed");
    }
  }

  return (
    <main>
      <h1>Botanical</h1>
      <p>
        Web client stub. Dev server proxies <code>/api/health</code> to the Botanical server{" "}
        <code>GET /health</code> route.
      </p>
      <button type="button" onClick={() => void checkHealth()}>
        Check server health
      </button>
      {health ? <pre>{JSON.stringify(health, null, 2)}</pre> : null}
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
