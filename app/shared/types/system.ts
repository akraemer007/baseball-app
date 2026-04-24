// System / infrastructure shared types (health, version, uptime).
// Domain-agnostic — anything tied to the app itself rather than a baseball
// concept belongs here.

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
}
