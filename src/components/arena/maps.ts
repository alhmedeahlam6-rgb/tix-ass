/**
 * Playable maps / game modes.
 *
 * Each entry describes where the level model lives, how it has to be scaled to
 * match the player scale, where fighters spawn, and the hard barrier box the
 * player can never walk past.
 */
import outpostGlb from "@/assets/map-outpost.glb.asset.json";


export type MapId = "frostline" | "outpost";
export type MapTeam = "blue" | "red";

export type MapSpawn = { name: string; team: MapTeam; x: number; y: number; z: number };

export type ArenaMap = {
  id: MapId;
  name: string;
  mode: string;
  tagline: string;
  teamSize: number;
  url: string;
  /**
   * Optional low-poly, texture-free clone of the level used purely for
   * raycasts (ground snapping, wall probes, bullets). It is never rendered —
   * the full-detail model above stays on screen.
   */
  collisionUrl?: string;
  /** uniform scale applied to the loaded model (1 = authored scale) */
  scale: number;
  /** vertical shift applied after scaling, so the play surface sits near y = 0 */
  yOffset: number;
  /** horizontal shift applied after scaling, so the play area is centred on the origin */
  offsetX: number;
  offsetZ: number;
  /** true → drop each spawn onto whatever surface is underneath it */
  snapToGround: boolean;
  /** hard barrier box; null = derive a square limit from the model bounds */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  spawns: MapSpawn[];
};

export const ARENA_MAPS: Record<MapId, ArenaMap> = {
  frostline: {
    id: "frostline",
    name: "Frostline Depot",
    mode: "2v2 Duel",
    tagline: "Tight industrial compound. Two squads, one courtyard.",
    teamSize: 2,
    url: "/models/arena.glb",
    scale: 1,
    yOffset: 0,
    offsetX: 0,
    offsetZ: 0,
    snapToGround: false,
    bounds: null,
    spawns: [
      { name: "SPAWN_BLUE_1", team: "blue", x: -46.78, y: 0.58, z: -67.08 },
      { name: "SPAWN_BLUE_2", team: "blue", x: -55.04, y: 0.58, z: -67.08 },
      { name: "SPAWN_RED_1", team: "red", x: 45.03, y: 0.58, z: 66.05 },
      { name: "SPAWN_RED_2", team: "red", x: 53.29, y: 0.58, z: 66.05 },
    ],
  },
  outpost: {
    id: "outpost",
    name: "Timber Outpost",
    mode: "4v4 Squad",
    tagline: "Open woodland compound. Eight fighters, one fenced outpost.",
    teamSize: 4,
    url: (outpostGlb as { url: string }).url,
    collisionUrl: "/models/outpost-collision.glb",
    // the model is authored at roughly human scale already
    scale: 1,
    // the compound sits far from the origin in the source file — these recentre
    // the playable area and drop the spawn-house floor to y = 0
    yOffset: -1.05,
    offsetX: -22.5,
    offsetZ: -377,
    snapToGround: true,
    // the timber fence ring around the outpost — never passable
    bounds: { minX: -126, maxX: 122, minZ: -84, maxZ: 61 },
    spawns: [
      // TEAM 1 — on the west spawn pad mesh (world centre -125.38, 0.84, 2.65)
      { name: "SPAWN_BLUE_1", team: "blue", x: -125.38, y: 0.84, z: -3.35 },
      { name: "SPAWN_BLUE_2", team: "blue", x: -125.38, y: 0.84, z: 0.65 },
      { name: "SPAWN_BLUE_3", team: "blue", x: -125.38, y: 0.84, z: 4.65 },
      { name: "SPAWN_BLUE_4", team: "blue", x: -125.38, y: 0.84, z: 8.65 },
      // TEAM 2 — on the east spawn pad mesh (world centre 116.92, 0.77, 1.83)
      { name: "SPAWN_RED_1", team: "red", x: 116.92, y: 0.77, z: -4.17 },
      { name: "SPAWN_RED_2", team: "red", x: 116.92, y: 0.77, z: -0.17 },
      { name: "SPAWN_RED_3", team: "red", x: 116.92, y: 0.77, z: 3.83 },
      { name: "SPAWN_RED_4", team: "red", x: 116.92, y: 0.77, z: 7.83 },
    ],

  },
};

export const MAP_LIST: ArenaMap[] = [ARENA_MAPS.frostline, ARENA_MAPS.outpost];
