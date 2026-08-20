/**
 * Placeholder roster. Real character models come later — for now every
 * operative is a coloured capsule so the lobby, picker and selection flow can
 * be built and tested end to end.
 */

import type { PowerId } from "./powers";

export type ArenaCharacter = {
  id: string;
  name: string;
  tagline: string;
  /** capsule body colour */
  color: number;
  /** trim / visor colour */
  accent: number;
  /** the operative's active ability */
  power: PowerId;
  /** unlocked from the start for new guests */
  unlockedByDefault: boolean;
  /** matches played with this character to unlock when not default */
  unlockCost: number;
};

export const CHARACTERS: ArenaCharacter[] = [
  { id: "howl", name: "Howl", tagline: "Frostline vanguard", color: 0x4fa8ff, accent: 0xd8ecff, power: "coldsnap", unlockedByDefault: true, unlockCost: 0 },
  { id: "ember", name: "Ember", tagline: "Close-quarters rusher", color: 0xff6b3d, accent: 0xffd9a8, power: "overburn", unlockedByDefault: false, unlockCost: 5 },
  { id: "vireo", name: "Vireo", tagline: "Recon and flanks", color: 0x46d39a, accent: 0xdcfff0, power: "slipstream", unlockedByDefault: false, unlockCost: 5 },
  { id: "onyx", name: "Onyx", tagline: "Bubble breacher", color: 0x8b8fa3, accent: 0x2b2f36, power: "emberveil", unlockedByDefault: false, unlockCost: 8 },
  { id: "lumen", name: "Lumen", tagline: "Support and walls", color: 0xf2c94c, accent: 0x6b4f00, power: "lifespring", unlockedByDefault: false, unlockCost: 8 },
  { id: "nyx", name: "Nyx", tagline: "Silent marksman", color: 0xa06bff, accent: 0xe9dcff, power: "deadeye", unlockedByDefault: false, unlockCost: 12 },
];

const KEY = "lonewolf.character.v1";

export function defaultCharacter(): ArenaCharacter {
  return CHARACTERS[0]!;
}

export function loadCharacter(): ArenaCharacter {
  if (typeof window === "undefined") return defaultCharacter();
  try {
    const id = window.localStorage.getItem(KEY);
    return CHARACTERS.find((c) => c.id === id) ?? defaultCharacter();
  } catch {
    return defaultCharacter();
  }
}

export function saveCharacter(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* private mode — selection just won't persist */
  }
}

export const hexCss = (v: number) => `#${v.toString(16).padStart(6, "0")}`;
