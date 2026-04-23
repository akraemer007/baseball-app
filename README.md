# ak_baseball

Personal Databricks App for exploring MLB stats with Jon-Bois-style trajectory charts.

Four pages: **League** (division W-L trajectories), **Team** (how a team compares to league), **Player** (HR race, cumulative stats), **News** (newspaper-style recaps + upset flags).

See `.claude/plans/i-d-like-to-make-rosy-sonnet.md` for the PRD and architecture.

## Layout

```
jobs/       Databricks job code (Python + SQL) — ingestion, transforms, Elo, recaps
bundles/    Databricks asset bundle (databricks.yml)
app/        Node.js + React app (AppKit)
shared/     Types shared between job outputs and the app
```

## Databricks profile

This project uses the `fe-vm-production-forecasting` profile (see `.mcp.json`).

## Data sources

- MLB Stats API (`statsapi.mlb.com`) — primary, free, no-auth
- Baseball Savant via `pybaseball` — Statcast enrichment only
- Chadwick register — player ID crosswalk

## Season scope

Current season + 3 prior. Backfill once, daily refresh at 07:00 ET.
