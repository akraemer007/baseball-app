# Conventions

Ground rules for shared code. Keeps parallel feature branches from stepping on
each other.

## Type-sharing

Shared types live under `app/shared/types/`, one file per domain:

- `league.ts`: league-wide (teams, divisions, trajectories, HR race)
- `team.ts`: team page (record, streak, percentile stats, game summaries)
- `recap.ts`: recap feed (game recaps, day groups, game-type classifier)
- `projection.ts`: pre-game schedule projections
- `player.ts`: player page + stat distributions (team vs league, intra-team)
- `system.ts`: app infrastructure (health, uptime, version)

New type? Put it in the domain file that already fits. If nothing fits, add a
new domain file (one lowercase word, no plurals) and export it from the
barrel.

## The barrel rule

`app/shared/types/index.ts` is a re-export barrel. Don't touch it unless
you're adding a new domain file. Don't put type definitions there. Callers
always import from `@shared/types`, never from a domain file directly, so
the barrel stays the single source of truth for what's exported.

## Parallel-worktree etiquette

One domain file per PR when you can swing it. Touching multiple domain files
in a single PR is fine when the change genuinely crosses domains, but call it
out in the PR body so the reviewer knows to look for cross-cutting risk.

## Naming

- Domain file: one lowercase word, singular (`team`, not `teams`).
- Type names: `PascalCase`, no prefix, no `I` for interfaces.
- Response shape for an HTTP route: `FooResponse`.
- Row-shaped types for a query result: `FooRow` or `FooEntry`.

## When to collapse the split back

The per-domain split only earns its keep while parallel feature branches
are colliding on `types.ts`. Reconsider collapsing back to a single
`types.ts` if any of these become true:

- Multiple domain files end up with ≤3 types each (the split costs more
  navigation than it saves).
- Parallel work has dropped off and it's mostly solo again.
- You find yourself grepping across domain files to trace what a single
  response returns — that's the split hurting readability.

Un-split is a ~10-minute refactor. Don't preemptively track it as a
ticket; let the pain signal it.
