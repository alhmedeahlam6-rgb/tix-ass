/**
 * Playable game modes and ranked/casual match types.
 *
 * Modes control team size, available maps and whether the match awards
 * rank points. Ranked matches use a simple Elo-style point delta based on
 * result, kills, deaths and survival time.
 */

import type { MapId } from "./maps";

export type GameMode = "loneWolf" | "clashSquad" | "battleRoyale";

export type MatchType = "casual" | "ranked";

export type ModeInfo = {
  id: GameMode;
  name: string;
  short: string;
  teamSize: number;
  maps: MapId[];
  blurb: string;
  /** true → selectable in the lobby right now */
  live: boolean;
};

export const MODES: Record<GameMode, ModeInfo> = {
  loneWolf: {
    id: "loneWolf",
    name: "Lone Wolf",
    short: "1v1",
    teamSize: 1,
    maps: ["frostline"],
    blurb: "A pure 1v1 duel. First to the kill goal wins the round.",
    live: true,
  },
  clashSquad: {
    id: "clashSquad",
    name: "Clash Squad",
    short: "4v4",
    teamSize: 4,
    maps: ["outpost", "frostline"],
    blurb: "Two squads fight for control of the compound.",
    live: true,
  },
  battleRoyale: {
    id: "battleRoyale",
    name: "Battle Royale",
    short: "BR",
    teamSize: 4,
    maps: ["outpost"],
    blurb: "Large-scale survival. Drop, loot and outlast everyone else.",
    live: false,
  },
};

export const MODE_IDS: GameMode[] = Object.keys(MODES) as GameMode[];

export const MATCH_TYPES: Record<MatchType, { name: string; blurb: string }> = {
  casual: { name: "Casual", blurb: "No rank pressure. Practice and earn gold." },
  ranked: { name: "Ranked", blurb: "Win to climb. Losses cost rank points." },
};

/** Default mode for new players. */
export const DEFAULT_MODE: GameMode = "clashSquad";

/** Default match type. */
export const DEFAULT_MATCH_TYPE: MatchType = "casual";

/** Ranked tier names by point thresholds. */
export const RANK_TIERS = [
  { min: 0, name: "Bronze", color: 0xcd7f32 },
  { min: 500, name: "Silver", color: 0xc0c0c0 },
  { min: 1000, name: "Gold", color: 0xffd700 },
  { min: 1500, name: "Platinum", color: 0x3eb489 },
  { min: 2000, name: "Diamond", color: 0x3f8fff },
  { min: 2500, name: "Heroic", color: 0xb741ff },
];

export function rankTierFromPoints(points: number) {
  let tier = RANK_TIERS[0]!;
  for (const t of RANK_TIERS) {
    if (points >= t.min) tier = t;
  }
  return tier;
}

/**
 * Calculate the rank-point delta for a finished match.
 * Wins give a positive bump, losses a penalty. Kills and survival time
 * soften the blow and amplify wins.
 */
export function rankPointsForMatch(
  won: boolean,
  kills: number,
  deaths: number,
  survivalSeconds: number,
): number {
  const base = won ? 25 : -15;
  const killPts = kills * 3;
  const deathPts = -deaths * 2;
  const survivalPts = Math.min(10, Math.floor(survivalSeconds / 60));
  return base + killPts + deathPts + survivalPts;
}
