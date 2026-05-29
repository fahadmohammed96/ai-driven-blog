export type HealthStatus = { status: "ok"; ts: string };

export function healthStatus(now: Date = new Date()): HealthStatus {
  return { status: "ok", ts: now.toISOString() };
}
