# Make ak_baseball more impressive

The app already has a coherent visual language (Jon-Bois-ish strip plots, small multiples, monospace annotations) and a clean story: league → team → stat. To go from "nice personal site" to "wait, you built that?", the next-tier moves fall into four groups: **interactivity payoff**, **novel stats/derivations**, **new data sources**, and **narrative/personal touches**. Ranked recommendations at the bottom.

---

## A. Interactivity that rewards a hover/click

Strip plots and trajectories already have hover tooltips. What's missing is *progressive disclosure* — clicking any element reveals one more layer of context without leaving the page.

1. **Matchup preview on Today's Games** *(your hint — best bang for the buck)*
   Each projection card expands on click to show:
   - Probable pitcher's season line (ERA, K/9, recent 3 starts) with a percentile strip-plot tick for each metric
   - Top 3 hitters on each team + their last-10-game OPS
   - Head-to-head record this season
   - Pitcher's LHP/RHP split
   - A tiny lineup table with each hitter's projected "x vs. this pitcher" (needs Statcast — see §C)

   This directly answers your "see the opposing player next to my team stats" idea. It reuses the same chart components on a different payload.

2. **Clickable game on the trajectory**
   Hover already snaps a crosshair and shows record. Click → drawer below the chart with that game's final, box score link, WPA spark (see §B), top performer. Needs a small API addition to join silver_game into the trajectory response.

3. **Team-vs-team overlay**
   On the team page, "Compare to [dropdown]" adds a second trajectory line and a second set of dots on all the strip plots. Two-team comparison is something almost no public site does well.

4. **Strike-zone heat map** *(requires Statcast)*
   Click a player → 3×3 or 5×5 zone grid with xBA or contact% per zone. Filter by pitch type, count, pitcher handedness. Pure d3 — no chart library handles this well, which is part of what makes it feel custom.

5. **Pitch arsenal / velocity trends** *(Statcast)*
   For a starting pitcher, stacked area chart of pitch type usage across the season. Hover reveals velo/spin/movement that start. Shows if a pitcher is losing his fastball.

6. **Spray chart** *(Statcast)*
   Classic hit-location scatter on an MLB field SVG outline. Click a dot → game + play description. One of the most visceral baseball viz forms and trivial in d3.

7. **Live WPA timeline per game**
   In-game or post-game win-probability chart. With a play-by-play feed (Stats API's game endpoint exposes it) this becomes the signature chart per game recap.

---

## B. Novel stats the app doesn't show today

These are mostly derivations you can compute on top of data you already have or could pull cheaply. Each one is a conversation starter.

1. **Pythagorean expected record vs. actual** — `pyth = RS² / (RS² + RA²)`. You already have runs for / against per team. One line: "Expected 58-42, actual 55-45 (−3 unlucky)." Makes clear which teams are *really* good vs. lucky.

2. **xwOBA vs. wOBA** *(Statcast)* — the single most-cited "is this hitter getting lucky?" stat. Delta reveals regression candidates. Strip-plot it like everything else.

3. **Bullpen fatigue** — count of appearances / pitches thrown by each reliever in the last 3 and 7 days. Context for late-inning projections. Easy from boxscores you already ingest.

4. **Strength of schedule** — cumulative opponent win% weighted by games played against them. Adds meaning to a 55-45 record if the slate was brutal.

5. **Clutch / WPA leaders** — requires play-by-play. "Bregman has added +2.1 wins above average in high-leverage spots this year." Lets you name a player and cite a number.

6. **Park factors** — Coors and Fenway warp numbers. A column showing "park-neutral OPS" next to raw OPS lands differently.

7. **Pitcher workload curve** — running 5-game rolling pitch count for every starter. Highlight anyone trending above their career norm. Good for flagging "coming injury."

8. **Rest-advantage** — days since each team's last game, relevant for projections around off-days and travel.

9. **First-of-the-year / last-time** markers — "First 10-game win streak since 2018." Generated from multi-year backfill; already easy for 2025, extend to 2020+ with `seasons_back=N`.

---

## C. New data sources worth adding

1. **Statcast / Baseball Savant** *(biggest single upgrade)*
   Unlocks xwOBA, xBA, launch angle, exit velocity, pitch-level data, spray coordinates. Two ingestion paths:
   - `pybaseball` Python lib scrapes Savant's CSVs — drop-in for your existing ingest pattern
   - Direct to the Savant search endpoint JSON (public, no auth)

   Storage: one row per plate appearance (~190k/season) + one per pitch (~700k/season). Fits easily in your existing schema with two new silver tables: `silver_pa` and `silver_pitch`. This is the single unlock that opens up §B 2, 5 and all of §A 4-7.

2. **Retrosheet / Chadwick Bureau event files**
   Play-by-play going back to 1900. For historical comparisons, WPA, leverage index. Free download, one file per year. Heavy lift but pays off in unique historical narratives.

3. **FanGraphs-style advanced stats**
   wRC+, fWAR, xFIP. No free API. Options:
   - Scrape (ToS-grey; their robots.txt doesn't forbid but they have rate limits)
   - Compute your own close-enough versions from Statcast (xFIP = f(BB%, K%, HR/FB) is public math)

   Recommendation: skip FanGraphs and compute derived stats yourself from Statcast — more honest, more flexible, same numbers.

4. **MLB transactions feed** *(MLB Stats API, free)*
   Roster moves, injuries, DFAs. Surface "Ian Happ placed on 10-day IL (hamstring)" on the team page. Big signal for user engagement.

5. **Sportsbook odds** *(DraftKings / FanDuel have public feeds)*
   Compare your Elo implied win probability to the market's. "We like the Cubs tonight 10% more than Vegas." Rare angle for a personal site, feels like an edge.

6. **Weather** *(open-meteo, free)*
   Game-time wind direction at each stadium. Famously predictive at Wrigley. Niche but Chicago fans notice.

---

## D. Narrative / personal touches

These are what make the app feel like *yours*, not a generic stats site.

1. **"You are here" tick on the trajectory** — one small vertical line at the current games-played index so the in-season view reads as a position, not a history.

2. **Milestone callouts inline** — on the home page, surface "Cubs' longest winning streak since 2016" or "Swanson's first 4-hit game since Aug 2024." Run as a small job over gold tables. LLM-free; just SQL.

3. **Weekly digest** — a Sunday 5-AM job that writes "This week in CHC baseball" as a single paragraph using the existing recap pipeline. Save to a `weekly_digest` table; show on the home page.

4. **Shareable PNG recap** — "Share this recap" button renders a 1200×628 server-side card with team color, headline, and a mini trajectory. Use a headless Chromium or Satori. Turns the app into something you'd actually post.

5. **Primary-team theming** — tint UI accents with the primary team color (subtly — 8-12% opacity tints on cards, not the whole chrome).

6. **The "why this recap is interesting" row** — on each recap card, show the interest-score reasons as tiny chips ("walkoff", "upset", "rivalry"). Cheap to add from the existing `gold_game_recap_input` fields.

---

## E. Recommended priorities

Given "one weekend each" units of effort:

**Weekend 1 — Matchup preview (your hint)**
Highest leverage. Reuses existing chart components on a new payload. Makes projections feel like the thing you come back to instead of just "who plays today."

- New route: `GET /api/matchup/:gamePk` returning probable pitchers' season lines, top hitters' recent form, h2h, LHP/RHP splits
- New client: expand-on-click on projection cards, strip-plot tick per stat
- No new data source needed — all derivable from what's already ingested

**Weekend 2 — Statcast ingest + xwOBA**
One-time infrastructure cost, then everything in §A.4-7 and §B.2 becomes cheap.

- `jobs/ingest/fetch_statcast.py` — PyBaseball or direct Savant JSON
- Two silver tables: `silver_pa`, `silver_pitch`
- First payoff: add xwOBA column to the hitters chart; spray chart is ~200 lines of d3

**Weekend 3 — Clickable trajectory + game detail drawer**
Glues it all together. The WPA mini-chart per game recap is the "wait, this is full-fidelity" moment.

- Extend trajectory API with game_pk per point
- New drawer UI triggered on click
- WPA computation from play-by-play (MLB Stats API `game/{pk}/playByPlay`) — no Retrosheet needed for the current season

**Things to skip or defer**
- FanGraphs integration (not worth the ToS grey)
- Historical Retrosheet data (cool, but no one's asking)
- Park factors (niche; add with Statcast for free later)
- Sharable PNG (nice polish, not a signature feature)

---

## F. What not to change

- The strip-plot-as-universal-viz metaphor is working. Don't chase d3's fancier idioms (chord diagrams, Voronoi) — they don't add signal here.
- The light theme + monospace annotations is a distinctive look. Resist the urge to adopt an off-the-shelf UI kit.
- The "primary + secondary team" preference model is genuinely useful and something most stats sites lack. Lean into it (e.g., primary team gets color tints everywhere).
- One recap per game per day is right. Resist real-time in-game LLM — costly, noisy.

The app's voice today is "thoughtful, opinionated, dense-but-not-cluttered." The upgrades in §A-D all keep that voice. Anything that breaks it — flashy animations, splash screens, too many panels — subtracts.
