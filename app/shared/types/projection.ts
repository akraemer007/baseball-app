// Projection shared types: pre-game schedule projections.

import type { ScheduledGame } from './team';

export interface ProjectionsResponse {
  date: string;
  games: ScheduledGame[];
}
