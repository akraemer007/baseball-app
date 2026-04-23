// Baseball Savant URL builders — used in places we link out to the
// canonical Statcast pages for a player or game.

export const savantPlayerUrl = (mlbamId: string | number): string =>
  `https://baseballsavant.mlb.com/savant-player/-${mlbamId}`;

export const savantBoxScoreUrl = (gamePk: string | number): string =>
  `https://baseballsavant.mlb.com/gamefeed?gamePk=${gamePk}&hf=boxScore`;

export const savantPreviewUrl = (
  gamePk: string | number,
  gameDate: string,
): string =>
  `https://baseballsavant.mlb.com/preview?game_pk=${gamePk}&game_date=${gameDate}&date=${gameDate}`;
