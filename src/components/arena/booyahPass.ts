/** Booyah Pass rewards for Ironhowl. */

export type BooyahReward = {
  tier: number;
  label: string;
  gold: number;
  diamonds: number;
};

export const BOOYAH_REWARDS: BooyahReward[] = [
  { tier: 1, label: "Rookie crate", gold: 150, diamonds: 0 },
  { tier: 2, label: "Steel crate", gold: 200, diamonds: 0 },
  { tier: 3, label: "Gold stash", gold: 300, diamonds: 0 },
  { tier: 4, label: "Diamond chip", gold: 100, diamonds: 5 },
  { tier: 5, label: "Silver crate", gold: 250, diamonds: 0 },
  { tier: 6, label: "Gold crate", gold: 400, diamonds: 0 },
  { tier: 7, label: "Premium shard", gold: 200, diamonds: 10 },
  { tier: 8, label: "Elite crate", gold: 500, diamonds: 0 },
  { tier: 9, label: "Diamond bundle", gold: 300, diamonds: 15 },
  { tier: 10, label: "Legendary crate", gold: 1000, diamonds: 25 },
];

export function rewardForTier(tier: number): BooyahReward | undefined {
  return BOOYAH_REWARDS.find((r) => r.tier === tier);
}

export function claimableTiers(currentTier: number, claimed: number[]): number[] {
  const out: number[] = [];
  for (const r of BOOYAH_REWARDS) {
    if (r.tier <= currentTier && !claimed.includes(r.tier)) {
      out.push(r.tier);
    }
  }
  return out;
}
