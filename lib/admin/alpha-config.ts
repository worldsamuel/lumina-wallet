export const ALPHA_WINDOW_DAYS = 15;
export const ALPHA_BOX_COST = 15;
export const ALPHA_MIN_SCORE_TO_OPEN_BOX = 30;
export const ALPHA_RECENT_SWAP_DAYS = 7;
export const ALPHA_BOX_DEFAULT_STOCK = 10000;
export const ALPHA_SWAP_USD_PER_POINT = 10;
export const ALPHA_SWAP_DAILY_CAP_POINTS = 20;

export const ALPHA_BALANCE_TIERS = [
  { minUsd: 1000, points: 10 },
  { minUsd: 200, points: 6 },
  { minUsd: 50, points: 3 },
  { minUsd: 10, points: 1 },
] as const;
