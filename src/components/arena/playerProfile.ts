/**
 * Guest identity and persistent progression for Ironhowl.
 *
 * The game never demands an external account. On first boot we mint a guest
 * ID and a random callsign so the player has a consistent identity for
 * leaderboards, stats and the store. Everything is stored locally.
 */

import { PASSIVE_SKILLS, combinePassives, defaultLoadout, loadLoadout, type Loadout, type PassiveSkillId } from "./skills";
import { TACTICAL_IDS, type TacticalId } from "./tactical";
import { PETS, defaultPet, loadPet, starterPets, type PetId } from "./pets";
import { defaultVault, loadVault } from "./vault";

export type PlayerProfile = {
  /** stable guest uuid */
  id: string;
  /** display name */
  name: string;
  /** guest creation timestamp */
  createdAt: number;
  /** matches started (finished or not) */
  matchesPlayed: number;
  matchesWon: number;
  totalKills: number;
  totalDeaths: number;
  /** highest headshot count in a single match */
  bestHeadshots: number;
  /** free currency earned by playing */
  gold: number;
  /** premium currency — not purchasable yet, but reserved for future IAP */
  diamonds: number;
  /** current battle-pass tier (Booyah Pass) */
  booyahPassTier: number;
  /** XP toward the next tier */
  booyahPassXp: number;
  /** claimed Booyah Pass reward tiers */
  booyahPassClaimed: number[];
  /** ranked ladder points */
  rankPoints: number;
  /** current ranked tier name */
  rankTier: string;
  /** matches played with each character for Character Link unlocks */
  characterProgress: Record<string, number>;
  /** active loadout: one active power + up to three passive skills */
  loadout: Loadout;
  /** selected pet companion */
  pet: PetId;
  /** owned pet ids (free pets are owned by default) */
  ownedPets: PetId[];
  /** owned weapon skin ids */
  ownedSkins: string[];
  /** weaponId -> equipped skin id */
  equippedSkins: Record<string, string>;
  /** owned vault item ids (skins, passives, pets) */
  vault: string[];
};


const KEY = "ironhowl.profile.v1";

const ADJECTIVES = [
  "Frost", "Ember", "Silent", "Rogue", "Swift", "Iron", "Bitter", "Wild",
  "Steel", "Shadow", "Blazing", "Frozen", "Dusty", "Thunder", "Midnight",
];

const NOUNS = [
  "Howl", "Wolf", "Viper", "Hawk", "Drifter", "Reaper", "Striker", "Ghost",
  "Nomad", "Vanguard", "Ronin", "Spectre", "Outlaw", "Hunter", "Raider",
];

function randomName() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${a}${n}`;
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function defaultProfile(): PlayerProfile {
  return {
    id: uuid(),
    name: randomName(),
    createdAt: Date.now(),
    matchesPlayed: 0,
    matchesWon: 0,
    totalKills: 0,
    totalDeaths: 0,
    bestHeadshots: 0,
    gold: 0,
    diamonds: 0,
    booyahPassTier: 0,
    booyahPassXp: 0,
    booyahPassClaimed: [],
    rankPoints: 0,
    rankTier: "Bronze V",
    characterProgress: {},
    loadout: defaultLoadout("coldsnap"),
    pet: defaultPet(),
    ownedPets: starterPets(),
    ownedSkins: [],
    equippedSkins: {},
    vault: defaultVault(),
  };
}

export function loadProfile(): PlayerProfile {
  const base = defaultProfile();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<PlayerProfile>;
    const num = (v: unknown, fallback: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : fallback;
    const loadOwnedPets = (): PetId[] => {
      const list = Array.isArray(saved.ownedPets) ? saved.ownedPets : [];
      const ids = list.filter((id): id is PetId => typeof id === "string" && id in PETS);
      return ids.length ? ids : starterPets();
    };
    return {
      id: typeof saved.id === "string" && saved.id ? saved.id : base.id,
      name: typeof saved.name === "string" && saved.name ? saved.name : base.name,
      createdAt: num(saved.createdAt, base.createdAt),
      matchesPlayed: num(saved.matchesPlayed, 0),
      matchesWon: num(saved.matchesWon, 0),
      totalKills: num(saved.totalKills, 0),
      totalDeaths: num(saved.totalDeaths, 0),
      bestHeadshots: num(saved.bestHeadshots, 0),
      gold: num(saved.gold, 0),
      diamonds: num(saved.diamonds, 0),
      booyahPassTier: num(saved.booyahPassTier, 0),
      booyahPassXp: num(saved.booyahPassXp, 0),
      booyahPassClaimed: Array.isArray(saved.booyahPassClaimed) ? saved.booyahPassClaimed.map((n) => num(n, 0)).filter((n) => n > 0) : [],
      rankPoints: num(saved.rankPoints, 0),
      rankTier: typeof saved.rankTier === "string" && saved.rankTier ? saved.rankTier : "Bronze V",
      characterProgress: isRecordOfNumbers(saved.characterProgress) ? saved.characterProgress : {},
      loadout: saved.loadout && typeof saved.loadout === "object" ? loadLoadoutFrom(saved.loadout) : base.loadout,
      pet: typeof saved.pet === "string" && saved.pet ? loadPetFrom(saved.pet) : base.pet,
      ownedPets: loadOwnedPets(),
      ownedSkins: Array.isArray(saved.ownedSkins) ? saved.ownedSkins.filter((s): s is string => typeof s === "string") : [],
      equippedSkins: isRecordOfStrings(saved.equippedSkins) ? saved.equippedSkins : {},
      vault: Array.isArray(saved.vault) ? saved.vault.filter((s): s is string => typeof s === "string") : defaultVault(),
    };
  } catch {
    return base;
  }
}

function loadLoadoutFrom(saved: Partial<Loadout>): Loadout {
  return {
    active: typeof saved.active === "string" && saved.active ? saved.active : "coldsnap",
    passives: Array.isArray(saved.passives)
      ? saved.passives.filter((id): id is PassiveSkillId => typeof id === "string" && id in PASSIVE_SKILLS).slice(0, 3)
      : [],
    tactical: saved.tactical && typeof saved.tactical === "string" && TACTICAL_IDS.includes(saved.tactical as TacticalId)
      ? (saved.tactical as TacticalId)
      : null,
  };
}

function loadPetFrom(id: string): PetId {
  return id in PETS ? (id as PetId) : defaultPet();
}

function isRecordOfNumbers(v: unknown): v is Record<string, number> {
  if (typeof v !== "object" || v == null) return false;
  for (const [, val] of Object.entries(v)) {
    if (typeof val !== "number" || !Number.isFinite(val)) return false;
  }
  return true;
}

function isRecordOfStrings(v: unknown): v is Record<string, string> {
  if (typeof v !== "object" || v == null) return false;
  for (const [, val] of Object.entries(v)) {
    if (typeof val !== "string") return false;
  }
  return true;
}

export function saveProfile(p: PlayerProfile) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode — progression won't persist */
  }
}

export function profileKey() {
  return KEY;
}

export function levelFromProfile(p: PlayerProfile) {
  // Every 1000 XP = 1 level. XP is derived from cumulative kills and wins.
  const xp = p.totalKills * 50 + p.matchesWon * 200;
  return Math.floor(xp / 1000) + 1;
}

export function kdRatio(p: PlayerProfile) {
  if (p.totalDeaths === 0) return p.totalKills;
  return Math.round((p.totalKills / p.totalDeaths) * 100) / 100;
}

export function winRate(p: PlayerProfile) {
  if (p.matchesPlayed === 0) return 0;
  return Math.round((p.matchesWon / p.matchesPlayed) * 100);
}

/** Awards for a completed match. Returns the updated profile. */
export function applyMatchRewards(
  p: PlayerProfile,
  {
    won,
    kills,
    deaths,
    headshots,
    characterId,
    bountyBonus,
    rankPoints,
    rankTier,
  }: {
    won: boolean;
    kills: number;
    deaths: number;
    headshots: number;
    characterId?: string;
    bountyBonus?: number;
    rankPoints?: number;
    rankTier?: string;
  }
): PlayerProfile {
  const next = { ...p };
  next.matchesPlayed += 1;
  if (won) next.matchesWon += 1;
  next.totalKills += kills;
  next.totalDeaths += deaths;
  next.bestHeadshots = Math.max(next.bestHeadshots, headshots);

  // Gold: 100 base + 50 per kill + 100 win bonus + 25 per headshot + bounty bonus.
  const baseGold = 100 + kills * 50 + (won ? 100 : 0) + headshots * 25 + (bountyBonus ?? 0);
  // Pet + Scavenger passive multiplier.
  const petGold = PETS[p.pet]?.effect.gold ?? 1;
  const passiveGold = combinePassives(p.loadout.passives).gold;
  next.gold += Math.round(baseGold * petGold * passiveGold);

  // Booyah Pass XP: 100 base + 25 per kill + 50 win + 10 per headshot.
  const xpGain = 100 + kills * 25 + (won ? 50 : 0) + headshots * 10;
  next.booyahPassXp += xpGain;
  while (next.booyahPassXp >= 1000) {
    next.booyahPassXp -= 1000;
    next.booyahPassTier += 1;
  }

  // Ranked ladder update.
  if (typeof rankPoints === "number") {
    next.rankPoints = Math.max(0, next.rankPoints + rankPoints);
  }
  if (rankTier) {
    next.rankTier = rankTier;
  }

  // Character Link progress: +1 match toward the operative used this game.
  if (characterId) {
    next.characterProgress = { ...next.characterProgress };
    next.characterProgress[characterId] = (next.characterProgress[characterId] ?? 0) + 1;
  }

  return next;
}

export function characterMatchesRemaining(p: PlayerProfile, c: { id: string; unlockedByDefault: boolean; unlockCost: number }) {
  if (c.unlockedByDefault) return 0;
  return Math.max(0, c.unlockCost - (p.characterProgress[c.id] ?? 0));
}

export function isCharacterUnlocked(p: PlayerProfile, c: { id: string; unlockedByDefault: boolean; unlockCost: number }) {
  return c.unlockedByDefault || characterMatchesRemaining(p, c) === 0;
}
