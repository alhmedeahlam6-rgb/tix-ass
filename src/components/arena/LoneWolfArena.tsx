import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { acceleratedRaycast } from "three-mesh-bvh";
import {
  buildMergedCollider,
  buildCollisionTiles,
  activeTileMeshes,
  warmTiles,
  type CollisionTile,
} from "./collision";

import { Skull, Volume2, VolumeX, Maximize, Minimize, Settings, PawPrint, Wifi, Eye, Smile, Boxes, MousePointer2 } from "lucide-react";
import { createSpawnFx, type SpawnFx } from "./spawnFx";
import { createPowerFx } from "./powerFx";
import { createBarrierDome } from "./barrierDome";
import {
  createBombSystem,
  predictBombPath,
  BOMB_DAMAGE,
  BOMB_RADIUS,
  THROW_SPEED,
  THROW_SPEED_JUMP,
  FLASH_RADIUS,
  DECOY_LIFE,
  DECOY_BARK_INTERVAL,
  GRENADE_DEFS,
  GRENADE_KINDS,
  type GrenadeKind,
  type BombSystem,
} from "./bomb";
import { createSmokeField } from "./smokeCloud";
import { createExplosionFx } from "./explosionFx";
import { bakeVertexLighting, makeBlobShadowTexture } from "./bakeLighting";
import { loadCharacter } from "./characters";
import { applyMatchRewards, type PlayerProfile } from "./playerProfile";
import { NO_EFFECT, POWERS } from "./powers";
import { combinePassives, type Loadout } from "./skills";
import { TACTICAL_BONUS, rollArmorLevel, TACTICALS } from "./tactical";
import { PETS } from "./pets";
import { applySkinStats } from "./weaponSkins";
import { createArmorPickupMesh, createArmorPiece, applyArmor, emptyArmor, equipArmor, shouldPickupArmor, armorIconLabel, type ArmorState } from "./armor";
import { createPingMarker, updatePings, nextPingKind, pingKindAtIndex, type PingKind, type Ping } from "./ping";
import { addDaySkybox, DAY_HORIZON, type Skybox } from "./skybox";
import { createImpactFx, type ImpactFx } from "./impactFx";
import { ARENA_MAPS, type MapId } from "./maps";
import { type GameMode, type MatchType, rankPointsForMatch } from "./modes";
import { OUTPOST_BARRIER, clampInsideBarrier } from "./mapBarrier";
import { saveMatchResult, getLeaderboard } from "@/lib/arena.functions";
import { initSfx, playSfx, playSfxStoppable, playSfxAt, playVictory, warmSfx, suspendSfx, resumeSfx, setSfxMuted, setSfxVolume, setWeatherAmbience, stopWeatherAmbience, playThunder } from "./sfx";
import { createWeather, type Weather } from "./weather";
import SettingsPanel from "./SettingsPanel";
import {
  AIM_ASSIST_STRENGTH,
  defaultSettings,
  loadSettings,
  saveSettings,
  type ArenaSettings,
  type BindAction,
  type Quality,
} from "./settings";
import WeaponShop from "./WeaponShop";
import WeaponSlots from "./WeaponSlots";
import Minimap, { type MapGrid, type RadarState } from "./Minimap";
import TouchControls from "./TouchControls";
import {
  loadGlooTemplate,
  createGlooVisual,
  setGhostValid,
  GLOO_WIDTH,
  GLOO_HEIGHT,
  GLOO_DEPTH,
  type GlooVisual,
} from "./glooWall";
import {
  WEAPONS,
  STARTING_CREDITS,
  isHeavy,
  getWeapon,
  getWeaponDamageAt,
  getWeaponRange,
  getWeaponFireInterval,
  getWeaponBehavior,
  getMagazine,
  getReserveAmmo,
  getReloadTime,
  isDeflectionMelee,
  type Weapon,
} from "./weapons";
import { createSafeZone, updateSafeZone, damageOutsideZone, createSafeZoneVisual, type SafeZone } from "./safeZone";
import { defaultBackpack, scanFfCoinPickups, spawnFfCoins, disposeFfCoins, type Backpack, type BackpackLevel, type FfCoinPickup } from "./backpack";
import {
  BOT_PROFILES,
  createBotBrain,
  preferredRangeFor,
  rerollStrafe,
  rollBurst,
  rollPause,
  attractToDecoy,
  type BotBrain,
} from "./botAi";

// The outpost collision clone still contains hundreds of thousands of
// triangles. Three's default raycaster scans those triangles for every ground
// and wall probe; the BVH keeps the exact mesh but indexes it spatially.
THREE.Mesh.prototype.raycast = acceleratedRaycast;



type Mode = "orbit" | "walk";
type Team = "blue" | "red";

type SpawnPoint = {
  name: string;
  team: Team;
  /** top-middle of the spawn pad — where a fighter stands */
  top: THREE.Vector3;
};

const TEAM_COLORS: Record<Team, number> = {
  blue: 0x3f8fff,
  red: 0xff3b1f,
};

const PLAYER_RADIUS = 0.7;
const EYE_HEIGHT = 1.7;
const STEP_UP = 0.55; // anything taller must be jumped
const GRAVITY = 24;
const JUMP_SPEED = 8.2;
const MAX_HP = 200;
/** cap of the Energy Point reserve */
const MAX_EP = 100;
/** EP converted into HP per second while the player is hurt */
const EP_TO_HP_RATE = 3;
const PLAYER_DAMAGE = 34;
const BOT_DAMAGE = 16;
const RESPAWN_SECONDS = 3;
const FIRE_COOLDOWN = 0.18;
const MUZZLE_FLASH_LIFE = 0.06;
const RECOIL_RECOVERY = 4.0;
const INTERMISSION_SECONDS = 5;
const MATCH_END_SECONDS = 5;
const COUNTDOWN_SECONDS = 10;
const SPAWN_BOX_HALF = 1.5; // 3m wide spawn cage
const SPAWN_BOX_HEIGHT = 5;

/** quick match shrinks the goal; standard is first to 10, best of 3 */
const MATCH_CONFIG = {
  quick: { killsToWinRound: 5, roundsToWinMatch: 1 },
  standard: { killsToWinRound: 10, roundsToWinMatch: 2 },
};


type Fighter = {
  id: string;
  team: Team;
  isHuman: boolean;
  group: THREE.Group | null;
  meshes: THREE.Mesh[];
  hp: number;
  alive: boolean;
  respawnIn: number;
  home: SpawnPoint;
  /** feet position */
  pos: THREE.Vector3;
  cooldown: number;
  tracer: { line: THREE.Line; mat: THREE.LineBasicMaterial; ttl: number } | null;
  /** personal spawn-in effect, played at this fighter's own spot */
  fx: SpawnFx | null;
  /** weapon id used for damage/fire-rate calculations */
  weapon: string;
  /** sidearm id carried on the back; used for melee deflection checks */
  sidearm: string | null;
  /** tactical brain — null for the human player */
  ai: BotBrain | null;
  /** equipped armor (vest + helmet) */
  armor: ArmorState;
  /** carried backpack and FF coins */
  backpack: Backpack;
};

type HudFighter = { id: string; team: Team; hp: number; alive: boolean; isHuman: boolean };

type MatchPhase = "warmup" | "countdown" | "round" | "intermission" | "matchEnd";

type KillFeedItem = {
  id: string;
  killer: string;
  killerTeam: Team;
  victim: string;
  victimTeam: Team;
  weapon: string;
  time: number;
};


type LeaderboardEntry = {
  winner: string;
  player_team: string;
  player_kills: number;
  player_deaths: number;
  blue_score: number;
  red_score: number;
};

type LeaderboardTotals = {
  recent: LeaderboardEntry[];
  totals: Record<string, { wins: number; losses: number; kills: number; deaths: number }>;
};



/** shared fake-contact-shadow sprite (baked lighting leaves no shadow receiver) */
let blobShadowTex: THREE.Texture | null = null;
function blobShadow() {
  if (!blobShadowTex) blobShadowTex = makeBlobShadowTexture();
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.6),
    new THREE.MeshBasicMaterial({
      map: blobShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  m.renderOrder = -1;
  return m;
}

function buildBot(team: Team, label: string) {
  const g = new THREE.Group();
  const color = TEAM_COLORS[team];
  const meshes: THREE.Mesh[] = [];

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15 });
  const gearMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.8, metalness: 0.2 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc79a72, roughness: 0.9 });

  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 4, 12), gearMat);
  legs.position.y = 0.52;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 4, 14), bodyMat);
  torso.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 14), skinMat);
  head.position.y = 1.62;
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.215, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 }),
  );
  helmet.position.y = 1.63;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.85), gearMat);
  gun.position.set(0.26, 1.12, -0.42);

  for (const m of [legs, torso, head, helmet, gun]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData["hitZone"] = m === head || m === helmet ? "head" : "body";
    g.add(m);
    meshes.push(m);
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.62, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  g.add(blobShadow());



  g.name = label;
  return { group: g, meshes };
}

type ArenaProps = {
  /** called once the map + scene are fully built and the match has started */
  onReady?: () => void;
  /** back to the lobby */
  onExit?: () => void;
  /** which map / mode to play */
  mapId?: MapId;
  /** selected game mode */
  gameMode?: GameMode;
  /** ranked or casual */
  matchType?: MatchType;
  /** persistent guest profile */
  profile?: PlayerProfile;
  /** called when match rewards update the profile */
  onProfileChange?: (p: PlayerProfile) => void;
};

export default function LoneWolfArena({ onReady, onExit, mapId = "frostline", gameMode = "loneWolf", matchType = "casual", profile, onProfileChange }: ArenaProps = {}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const mapIdRef = useRef<MapId>(mapId);
  mapIdRef.current = mapId;
  const [mode, setMode] = useState<Mode>("walk");
  const [intro, setIntro] = useState(true);

  const [showDebug, setShowDebug] = useState(false);
  const [status, setStatus] = useState("Loading map…");
  const [mapLoadProgress, setMapLoadProgress] = useState(0);
  const [showRoof, setShowRoof] = useState(true);
  const [hud, setHud] = useState<HudFighter[]>([]);
  const [score, setScore] = useState<Record<Team, number>>({ blue: 0, red: 0 });
  const [playerHp, setPlayerHp] = useState(MAX_HP);
  const [playerRespawn, setPlayerRespawn] = useState(0);
  const [match, setMatch] = useState({
    blue: 0,
    red: 0,
    phase: "warmup" as MatchPhase,
    round: 1,
    roundWinner: null as Team | null,
    matchWinner: null as Team | null,
    countdown: 0,
  });
  const [matchConfig, setMatchConfig] = useState(MATCH_CONFIG.standard);
  const matchConfigRef = useRef(matchConfig);
  const safeZoneRef = useRef<SafeZone | null>(null);
  matchConfigRef.current = matchConfig;
  const [killFeed, setKillFeed] = useState<KillFeedItem[]>([]);
  const [weaponReady, setWeaponReady] = useState(true);
  const [hitMarker, setHitMarker] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardTotals | null>(null);
  const [orbitLeaderboard, setOrbitLeaderboard] = useState<LeaderboardTotals | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [credits, setCredits] = useState(STARTING_CREDITS);
  const [owned, setOwned] = useState<string[]>(["deagle", "fists"]);
  // Loadout: [heavy 1, heavy 2, sidearm (pistol or knife), fists]
  const [slots, setSlots] = useState<(string | null)[]>([null, null, "deagle", "fists"]);
  const [activeSlot, setActiveSlot] = useState(2);
  const [ammo, setAmmo] = useState<Record<string, { mag: number; reserve: number }>>({
    deagle: { mag: 7, reserve: 21 },
  });
  const [isReloading, setIsReloading] = useState(false);
  const [reloadLeft, setReloadLeft] = useState(0);
  const [sfxReady, setSfxReady] = useState(false);
  const [playerStatsHud, setPlayerStatsHud] = useState({ kills: 0, deaths: 0, headshots: 0 });
  /** transient "double kill / rampage" callout — purely cosmetic */
  const [streakBanner, setStreakBanner] = useState<{ id: number; title: string; sub: string } | null>(null);
  const streakRef = useRef({ count: 0, lastAt: 0, multi: 0, timer: 0 });
  const [damagePopups, setDamagePopups] = useState<
    { id: number; x: number; y: number; amount: number; head: boolean }[]
  >([]);
  /** true while the crosshair is over a living enemy — turns the reticle red */
  const [onTarget, setOnTarget] = useState(false);
  const onTargetRef = useRef(false);
  const targetProbeRef = useRef(0);
  const [scoped, setScoped] = useState(false);
  const [paused, setPaused] = useState(false);
  /** wireframe overlay of the real collision geometry (debug invisible walls) */
  const [collisionDebug, setCollisionDebug] = useState(false);
  const setCollisionDebugRef = useRef<(on: boolean) => void>(() => {});
  const toggleCollisionDebugRef = useRef(() => {});
  toggleCollisionDebugRef.current = () => setCollisionDebug((v) => !v);
  /** why movement got blocked this frame (debug only): bounds box, spawn cage, geometry */
  const blockReasonRef = useRef("");
  const [blockReason, setBlockReason] = useState("");
  /** cursor released on purpose — the game keeps running, no pause */
  const [cursorFree, setCursorFree] = useState(false);
  const freeCursorRef = useRef(false);
  const toggleCursorRef = useRef(() => {});
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [prone, setProne] = useState(false);
  const [kits, setKits] = useState(3);
  const [ffCoinCount, setFfCoinCount] = useState(0);
  const [backpackLevel, setBackpackLevel] = useState<BackpackLevel>(1);
  const ffCoinsRef = useRef<FfCoinPickup[]>([]);
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  /** fraction (0..1) left in the partially used medkit at the top of the stack */
  /** Energy Points: yellow reserve that trickles back into HP over time */
  const [ep, setEp] = useState(0);
  const epRef = useRef(0);
  epRef.current = ep;
  /** inhalers: instant small HP + EP, usable on the move */
  const [inhalers, setInhalers] = useState(2);
  const inhalersRef = useRef(2);
  inhalersRef.current = inhalers;
  const useInhalerRef = useRef(() => {});
  const [kitPartial, setKitPartial] = useState(1);
  const kitPartialRef = useRef(1);
  kitPartialRef.current = kitPartial;
  /** 0..1 progress of the medkit currently being applied */
  const [healProgress, setHealProgress] = useState(0);
  /** throwables per type; frag damages, flash blinds, smoke blocks sight, decoy fakes shots */
  const [grenades, setGrenades] = useState<Record<GrenadeKind, number>>({ frag: 3, flash: 2, smoke: 2, decoy: 2 });
  const [grenadeKind, setGrenadeKind] = useState<GrenadeKind>("frag");
  const grenadeKindRef = useRef<GrenadeKind>(grenadeKind);
  grenadeKindRef.current = grenadeKind;
  const bombs = grenades[grenadeKind];
  /** 0..1 flashbang blindness, decayed in the render loop */
  const flashRef = useRef(0);
  const flashElRef = useRef<HTMLDivElement | null>(null);
  /** true while a bomb is in hand, waiting for the fire button */
  const [bombArmed, setBombArmed] = useState(false);
  const throwBombRef = useRef(() => {});
  /** the scene tells us when the held bomb actually left the hand */
  const onBombThrownRef = useRef(() => {});
  /** called by the scene when a channelled heal ends: leftover 0..1 of the kit */
  const onHealEndRef = useRef<(leftover: number) => void>(() => {});
  onHealEndRef.current = (leftover) => {
    setHealProgress(0);
    if (leftover <= 0.02) {
      setKits((k) => Math.max(0, k - 1));
      setKitPartial(1);
    } else {
      setKitPartial(leftover);
    }
  };
  const [wallCharges, setWallCharges] = useState(3);
  const [armor, setArmor] = useState<ArmorState>(emptyArmor());
  const armorRef = useRef<ArmorState>(emptyArmor());
  /** true while the gloo wall ghost preview is being positioned */
  const [placingWall, setPlacingWall] = useState(false);
  const consumeWallChargeRef = useRef(() => {});
  const throwShieldWallRef = useRef(() => {});
  const placePingRef = useRef<(kind?: PingKind) => void>(() => {});
  const cyclePingKindRef = useRef(() => {});
  const currentPingKindRef = useRef<PingKind>("enemy");
  consumeWallChargeRef.current = () => setWallCharges((w) => Math.max(0, w - 1));
  const [touchUi, setTouchUi] = useState(false);
  const [settings, setSettings] = useState<ArenaSettings>(() => defaultSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<ArenaSettings>(settings);
  settingsRef.current = settings;

  /** load persisted settings after hydration, then keep audio + storage in sync */
  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    setMuted(loaded.muted);
  }, []);

  toggleCursorRef.current = () => {
    const canvas = mountRef.current?.querySelector("canvas");
    if (document.pointerLockElement === canvas) {
      freeCursorRef.current = true;
      setCursorFree(true);
      document.exitPointerLock?.();
    } else {
      freeCursorRef.current = false;
      setCursorFree(false);
      canvas?.requestPointerLock?.();
    }
  };

  useEffect(() => {
    setCollisionDebugRef.current(collisionDebug);
    if (!collisionDebug) {
      setBlockReason("");
      return;
    }
    const id = window.setInterval(() => setBlockReason(blockReasonRef.current), 150);
    return () => window.clearInterval(id);
  }, [collisionDebug]);

  useEffect(() => {
    saveSettings(settings);
    setSfxVolume(settings.masterVolume * settings.sfxVolume);
    setSfxMuted(settings.muted);
    applyFovRef.current(settings.fov);
    applyAtmosphereRef.current(settings.skyBrightness, settings.fogIntensity, settings.cloudMotion);
  }, [settings]);

  /** shrinks the HUD on small / short (phone landscape) screens so it stops overlapping */
  const [hudScale, setHudScale] = useState(1);

  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerHeight / 760, window.innerWidth / 1180, 1);
      setHudScale(Math.max(0.55, s) * settings.hudScale);
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [settings.hudScale]);



  const showRoofRef = useRef(true);
  const clipRef = useRef<{ renderer: THREE.WebGLRenderer; plane: THREE.Plane } | null>(null);
  const modeRef = useRef<Mode>("walk");
  const settingsOpenRef = useRef(false);
  const collidersRef = useRef<THREE.Mesh[]>([]);
  const startMatchRef = useRef<(() => void) | null>(null);
  const laserRef = useRef<{
    line: THREE.Line;
    material: THREE.LineBasicMaterial;
    spark: THREE.PointLight;
    sparkMesh: THREE.Mesh;
    ttl: number;
  } | null>(null);
  const muzzleRef = useRef<{
    light: THREE.PointLight;
    mesh: THREE.Mesh;
    ttl: number;
  } | null>(null);
  const recoilRef = useRef(0);
  const recoilYawRef = useRef(0);
  const weaponCooldownRef = useRef(0);
  const hitMarkerRef = useRef(0);
  const weaponRef = useRef<string>("deagle");
  const matchRef = useRef({
    blue: 0,
    red: 0,
    phase: "warmup" as MatchPhase,
    round: 1,
    roundWinner: null as Team | null,
    matchWinner: null as Team | null,
    countdown: 0,
  });
  const killFeedRef = useRef<KillFeedItem[]>([]);
  const intermissionRef = useRef(0);
  const countdownRef = useRef(0);
  const shakeRef = useRef(0);
  const applyFovRef = useRef<(fov: number) => void>(() => {});
  /** live sky exposure / fog strength / cloud drift on outdoor maps */
  const applyAtmosphereRef = useRef<(sky: number, fog: number, clouds: number) => void>(() => {});
  const sprintToggleRef = useRef(false);
  const useHealthKitRef = useRef<() => void>(() => {});
  /** the operative chosen in the lobby, plus their live ability state */
  const characterRef = useRef(loadCharacter());
  const profileRef = useRef<PlayerProfile | undefined>(profile);
  profileRef.current = profile;
  const power = POWERS[characterRef.current.power];
  const powerRef = useRef({ active: 0, cooldown: 0, shield: 0 });
  const [powerHud, setPowerHud] = useState({ active: 0, cooldown: 0, shield: 0 });
  const activatePowerRef = useRef<() => void>(() => {});
  const spawnCageRef = useRef<{
    mesh: THREE.Object3D;
    center: THREE.Vector3;
    halfX: number;
    halfZ: number;
  } | null>(null);

  const saveSentRef = useRef(false);
  const introRef = useRef(0);
  const ammoRef = useRef<Record<string, { mag: number; reserve: number }>>({
    deagle: { mag: 7, reserve: 21 },
  });
  const isReloadingRef = useRef(false);
  const reloadTimerRef = useRef(0);
  const reloadLeftRef = useRef(0);
  const reloadingWeaponRef = useRef<string | null>(null);
  const startReloadRef = useRef<(id: string) => void>(() => {});
  const mouseHeldRef = useRef(false);
  const autoFireRef = useRef(settings.autoFire);
  autoFireRef.current = settings.autoFire;
  const burstQueueRef = useRef<{ shotsLeft: number; nextIn: number } | null>(null);
  const sfxInitializedRef = useRef(false);
  const crosshairRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const damageFlashRef = useRef(0);
  const radarRef = useRef<RadarState>({ fighters: [], player: null, decoys: [], pings: [] });
  const mapGridRef = useRef<MapGrid | null>(null);
  const mapImageRef = useRef<string | null>(null);
  const adsRef = useRef(false);
  const adsProgressRef = useRef(0);
  const scopedRef = useRef(false);
  const scopeRef = useRef<HTMLDivElement>(null);
  const centerDotRef = useRef<HTMLDivElement>(null);
  const popupIdRef = useRef(0);
  const popupTimersRef = useRef<number[]>([]);
  /** live movement keys, shared between the desktop loop and the touch HUD */
  const keysRef = useRef<Set<string>>(new Set());
  const proneRef = useRef(false);
  /** imperative hooks into the render loop, wired up once the scene exists */
  const actionsRef = useRef<{
    triggerDown: () => void;
    triggerUp: () => void;
    toggleAds: () => void;
    jump: () => void;
    /** starts the channelled medkit; fraction is how much of the kit is left */
    startHeal: (fraction: number) => boolean;
    cancelHeal: () => void;
    /** take a bomb in hand / put it away; returns the new armed state */
    armBomb: () => boolean;
    /** returns true when a charge was consumed (a wall actually got placed) */
    wallButton: () => boolean;
    cancelWall: () => void;
  } | null>(null);




  modeRef.current = mode;
  settingsOpenRef.current = settingsOpen;

  useEffect(() => {
    const nextWeapon = (slots[activeSlot] ?? "deagle") as string;
    if (weaponRef.current !== nextWeapon && isReloadingRef.current && reloadingWeaponRef.current !== nextWeapon) {
      // cancel reload when switching away from the weapon being reloaded
      isReloadingRef.current = false;
      reloadingWeaponRef.current = null;
      reloadTimerRef.current = 0;
      reloadLeftRef.current = 0;
      setIsReloading(false);
      setReloadLeft(0);
    }
    weaponRef.current = nextWeapon;
    if (sfxInitializedRef.current) playSfx("equip", 0.6);
    // dropping the scope when swapping to a weapon that has none
    const cls = getWeapon(nextWeapon)?.cls;
    if (cls === "Shotgun" || cls === "Melee") setScoped(false);
  }, [slots, activeSlot]);

  useEffect(() => {
    scopedRef.current = scoped;
  }, [scoped]);

  useEffect(() => {
    proneRef.current = prone;
  }, [prone]);

  useEffect(() => {
    // The HUD is designed as a mobile-style touch layout, so it is always shown.
    setTouchUi(true);
  }, []);


  useEffect(() => {
    ammoRef.current = ammo;
  }, [ammo]);

  useEffect(() => {
    isReloadingRef.current = isReloading;
  }, [isReloading]);




  useEffect(() => {
    // Defer leaderboard fetch so boot / map load isn't competing for bandwidth.
    const fetchLeaderboard = () => {
      getLeaderboard()
        .then((res) => setOrbitLeaderboard(res))
        .catch(() => {});
    };
    const leaderboardTimer = window.setTimeout(fetchLeaderboard, 2500);
    const onFirstInteraction = () => {
      window.clearTimeout(leaderboardTimer);
      fetchLeaderboard();
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("keydown", onFirstInteraction);
    };
    window.addEventListener("pointerdown", onFirstInteraction, { once: true });
    window.addEventListener("keydown", onFirstInteraction, { once: true });

    const mount = mountRef.current;
    if (!mount) return;

    // read the persisted quality preset fresh so the renderer is configured
    // before the first frame, without waiting for the settings state effect.
    const bootSettings: Partial<ArenaSettings> = (() => {
      try {
        const raw = window.localStorage.getItem("lonewolf.settings.v1");
        return raw ? (JSON.parse(raw) as Partial<ArenaSettings>) : {};
      } catch {
        return {};
      }
    })();
    const q = bootSettings.quality;
    const initialQuality: Quality = q === "low" || q === "medium" || q === "high" ? q : "medium";
    // Baked lighting draws the level unlit, so a shadow map has nothing static
    // left to fall on — fighters get cheap blob shadows instead.
    const bakedLight = typeof bootSettings.bakedLight === "boolean" ? bootSettings.bakedLight : true;
    const initialShadows =
      (typeof bootSettings.shadows === "boolean" ? bootSettings.shadows : initialQuality !== "low") && !bakedLight;
    const initialRenderScale =
      typeof bootSettings.renderScale === "number" && Number.isFinite(bootSettings.renderScale)
        ? Math.max(0.5, Math.min(1, bootSettings.renderScale))
        : 1;
    const initialFov =
      typeof bootSettings.fov === "number" && Number.isFinite(bootSettings.fov)
        ? Math.max(55, Math.min(110, bootSettings.fov))
        : 70;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1117);
    scene.fog = new THREE.Fog(0x0d1117, initialQuality === "low" ? 120 : 160, initialQuality === "low" ? 360 : 520);

    let BASE_FOV = initialFov;
    const camera = new THREE.PerspectiveCamera(BASE_FOV, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    applyFovRef.current = (fov: number) => {
      BASE_FOV = fov;
      if (!adsRef.current) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    };

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    // Always render at (close to) native density — a capped ratio was what made
    // the arena look soft/washed after the map optimisation pass.
    const pixelRatio = () =>
      Math.min(window.devicePixelRatio || 1, initialQuality === "low" ? 1.5 : initialQuality === "medium" ? 2 : 3) *
      initialRenderScale;
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = initialShadows;
    renderer.shadowMap.type = initialQuality === "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.26; // +20% brighter overall
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.userSelect = "none";
    mount.appendChild(renderer.domElement);

    const safeZoneVisual = createSafeZoneVisual(1);
    safeZoneVisual.mesh.visible = false;
    scene.add(safeZoneVisual.mesh);

    // ---- Lighting rig ----
    // With baked lighting on, the level is unlit: these lights only shade the
    // handful of dynamic objects (fighters, gloo walls, props), so the extra
    // fill/bounce lights are pure per-fragment cost and get dropped.
    scene.add(new THREE.HemisphereLight(0x9fc6ff, 0x7a8a9a, bakedLight ? 1.0 : 1.62));

    const sun = new THREE.DirectionalLight(0xffd9a0, 2.52);
    sun.position.set(90, 120, 60);
    sun.castShadow = initialShadows;
    sun.shadow.mapSize.set(
      initialQuality === "high" ? 2048 : initialQuality === "medium" ? 1024 : 512,
      initialQuality === "high" ? 2048 : initialQuality === "medium" ? 1024 : 512,
    );
    // A 220-unit-wide shadow frustum spread the whole map over one map; a tight
    // box that travels with the player is both far cheaper and much sharper.
    const s = initialQuality === "low" ? 28 : initialQuality === "medium" ? 40 : 55;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 320;
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    const sunTarget = new THREE.Object3D();
    scene.add(sunTarget);
    sun.target = sunTarget;
    const SUN_OFFSET = new THREE.Vector3(70, 110, 50);
    // Static level + a handful of fighters: re-rendering the shadow map at
    // 30 Hz instead of every frame is invisible and saves a full extra pass.
    renderer.shadowMap.autoUpdate = false;
    let shadowClock = 0;

    if (!bakedLight) {
      const fill = new THREE.DirectionalLight(0x7fa8ff, 0.78);
      fill.position.set(-80, 60, -70);
      scene.add(fill);

      const groundFill = new THREE.PointLight(0xffc48a, 2.64, 260, 1.5);
      groundFill.position.set(0, 8, 0);
      scene.add(groundFill);
    }

    scene.add(new THREE.AmbientLight(0xffffff, bakedLight ? 0.42 : 0.66));

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 20);
    renderer.localClippingEnabled = true;

    const root = new THREE.Group();
    scene.add(root);

    // ---- Player laser ----
    const laserGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const laserMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 });
    const laserLine = new THREE.Line(laserGeo, laserMat);
    laserLine.frustumCulled = false;
    root.add(laserLine);

    const sparkMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 }),
    );
    sparkMesh.visible = false;
    root.add(sparkMesh);

    const sparkLight = new THREE.PointLight(0xffa040, 0, 12, 2);
    sparkLight.position.set(0, -1000, 0);
    root.add(sparkLight);

    laserRef.current = { line: laserLine, material: laserMat, spark: sparkLight, sparkMesh, ttl: 0 };

    // ---- Muzzle flash ----
    const muzzleGeo = new THREE.SphereGeometry(0.07, 12, 12);
    const muzzleMat = new THREE.MeshBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0 });
    const muzzleMesh = new THREE.Mesh(muzzleGeo, muzzleMat);
    muzzleMesh.visible = false;
    root.add(muzzleMesh);
    const muzzleLight = new THREE.PointLight(0xffa040, 0, 18, 2);
    muzzleLight.position.set(0, -1000, 0);
    root.add(muzzleLight);
    muzzleRef.current = { light: muzzleLight, mesh: muzzleMesh, ttl: 0 };

    // ---- impact spark pool ----
    const impactPool: ImpactFx[] = [];
    for (let i = 0; i < (initialQuality === "low" ? 2 : 4); i++) {
      const fx = createImpactFx(initialQuality);
      root.add(fx.group);
      impactPool.push(fx);
    }
    const spawnImpact = (at: THREE.Vector3, color?: THREE.Color) => {
      const fx = impactPool.find((f) => f.group.visible === false) ?? impactPool[0]!;
      fx.burst(at, color);
    };

    // ---- state ----

    let theta = Math.PI * 0.25;
    let phi = 0.85;
    let radius = 190;
    const target = new THREE.Vector3(0, 6, 0);

    const walkPos = new THREE.Vector3(-50, 0, -66); // FEET position
    // sampled once per frame so bots can tell a strafing player from a static one
    const prevWalkPos = walkPos.clone();
    const walkMovingRef = { current: false };
    let velY = 0;
    let grounded = false;
    // movement-audio bookkeeping
    const lastStepPos = new THREE.Vector3(-50, 0, -66);
    let stepDist = 0;
    let stepIndex = 0;
    let runStepIndex = 0;
    const STEP_KINDS = ["step1", "step2", "step3", "step4"] as const;
    const RUN_KINDS = ["steprun", "steprun2"] as const;
    let yaw = Math.PI * 0.75;
    let pitch = 0;
    const keys = keysRef.current;
    keys.clear();
    /** prone lowers the camera and the muzzle */
    const eyeHeight = () => (proneRef.current ? 0.85 : EYE_HEIGHT);

    const fighters: Fighter[] = [];
    const fxList: SpawnFx[] = [];
    let human: Fighter | null = null;
    let humanBody: { group: THREE.Group; meshes: THREE.Mesh[] } | null = null;

    const scoreState: Record<Team, number> = { blue: 0, red: 0 };
    const playerStats = { kills: 0, deaths: 0, headshots: 0 };
    let bountyBonus = 0;




    const syncHud = () => {
      setHud(
        fighters.map((f) => ({
          id: f.id,
          team: f.team,
          hp: Math.max(0, Math.round(f.hp)),
          alive: f.alive,
          isHuman: f.isHuman,
        })),
      );
      setScore({ ...scoreState });
      if (human) {
        setPlayerHp(Math.max(0, Math.round(human.hp)));
        setPlayerRespawn(human.alive ? 0 : Math.ceil(human.respawnIn));
        setArmor(human.armor);
        armorRef.current = human.armor;
      }
    };

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (modeRef.current !== "orbit") return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerUp = () => (dragging = false);

    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const scratch = new THREE.Vector3();

    /**
     * Closest hit only. With a BVH-indexed collider this lets the tree prune
     * everything behind the first surface instead of collecting every triangle
     * along the ray — the cheapest probe we can do, and all we ever need for
     * wall checks, line of sight and bullets.
     */
    const castFirst = (
      origin: THREE.Vector3,
      dir: THREE.Vector3,
      far: number,
      objects: THREE.Object3D[] = collidersRef.current,
    ): THREE.Intersection | null => {
      if (objects.length === 0) return null;
      raycaster.set(origin, dir);
      raycaster.far = far;
      (raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
      const hit = raycaster.intersectObjects(objects, false)[0] ?? null;
      (raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = false;
      return hit;
    };

    /**
     * Movement probes only ever need geometry a step away, so instead of
     * handing them the whole level we hand them the collision tiles around the
     * player (plus any gloo walls, which are always few and always close).
     * The selection is cached until the player leaves the tile neighbourhood.
     */
    let collisionTiles: CollisionTile[] = [];
    let cancelWarm: (() => void) | null = null;
    let nearCache: THREE.Mesh[] = [];
    let nearX = Infinity;
    let nearZ = Infinity;
    let nearFx = 0;
    let nearFz = 0;
    const NEAR_RADIUS = 48;
    const VIEW_RADIUS = 140;
    const VIEW_COS_HALF = Math.cos(Math.PI / 3);
    const camFwd = new THREE.Vector3();
    const localColliders = (pos: THREE.Vector3): THREE.Mesh[] => {
      if (collisionTiles.length === 0) return collidersRef.current;
      camera.getWorldDirection(camFwd);
      const dx = pos.x - nearX;
      const dz = pos.z - nearZ;
      // re-select on a step of movement or a meaningful turn
      if (dx * dx + dz * dz > 100 || camFwd.x * nearFx + camFwd.z * nearFz < 0.98) {
        nearX = pos.x;
        nearZ = pos.z;
        nearFx = camFwd.x;
        nearFz = camFwd.z;
        nearCache = activeTileMeshes(
          collisionTiles,
          { x: pos.x, z: pos.z },
          { x: camFwd.x, z: camFwd.z },
          {
            nearRadius: NEAR_RADIUS,
            viewRadius: VIEW_RADIUS,
            viewCosHalfAngle: VIEW_COS_HALF,
            // never index more than one distant tile inside a frame
            maxBuilds: 1,
          },
        );
      }
      const dynamic = collidersRef.current.filter((m) => m.userData["shieldWall"]);
      return dynamic.length ? [...nearCache, ...dynamic] : nearCache;
    };



    /* ---- collision debug overlay ------------------------------------------
     * Draws the *actual* collision geometry (the merged/tiled proxy the movement
     * probes hit) as a wireframe, so invisible walls become visible. Built once
     * on enable, torn down on disable — zero cost while it's off. Geometry is
     * shared with the colliders, so nothing extra is uploaded to the GPU. */
    const collisionDebugGroup = new THREE.Group();
    collisionDebugGroup.visible = false;
    scene.add(collisionDebugGroup);
    const collisionDebugMat = new THREE.MeshBasicMaterial({
      color: 0x39ff9c,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    let collisionDebugBuilt = false;
    const clearCollisionDebug = () => {
      for (const c of collisionDebugGroup.children) {
        const m = c as THREE.Mesh;
        if (m.userData?.["debugOwned"]) {
          m.geometry?.dispose();
          (m.material as THREE.Material)?.dispose();
        }
      }
      collisionDebugGroup.clear();
      collisionDebugBuilt = false;
    };
    const buildCollisionDebug = () => {
      clearCollisionDebug();
      const seen = new Set<THREE.Mesh>();
      for (const t of collisionTiles) seen.add(t.mesh);
      for (const m of collidersRef.current) seen.add(m);
      for (const m of seen) {
        if (!m.geometry) continue;
        m.updateWorldMatrix(true, false);
        const wire = new THREE.Mesh(m.geometry, collisionDebugMat);
        wire.matrixAutoUpdate = false;
        wire.matrix.copy(m.matrixWorld);
        wire.matrixWorldNeedsUpdate = true;
        collisionDebugGroup.add(wire);
      }
      // The hard map-bounds box and the buy-phase spawn cage are pure maths —
      // no geometry — so they are the classic "invisible wall in the middle of
      // nowhere". Draw them too, in different colours.
      const boundsBox = new THREE.Mesh(
        new THREE.BoxGeometry(
          Math.max(0.1, boundsMaxX - boundsMinX),
          14,
          Math.max(0.1, boundsMaxZ - boundsMinZ),
        ),
        new THREE.MeshBasicMaterial({
          color: 0xff3d81,
          wireframe: true,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      boundsBox.position.set((boundsMinX + boundsMaxX) / 2, 6, (boundsMinZ + boundsMaxZ) / 2);
      boundsBox.userData["debugOwned"] = true;
      collisionDebugGroup.add(boundsBox);

      const cage = spawnCageRef.current;
      if (cage) {
        const cageBox = new THREE.Mesh(
          new THREE.BoxGeometry(cage.halfX * 2, SPAWN_BOX_HEIGHT, cage.halfZ * 2),
          new THREE.MeshBasicMaterial({
            color: 0xffd23d,
            wireframe: true,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        cageBox.position.set(cage.center.x, cage.center.y + SPAWN_BOX_HEIGHT / 2, cage.center.z);
        cageBox.userData["debugOwned"] = true;
        collisionDebugGroup.add(cageBox);
      }

      collisionDebugBuilt = true;
    };
    setCollisionDebugRef.current = (on: boolean) => {
      if (on) buildCollisionDebug();
      if (!on) clearCollisionDebug();
      collisionDebugGroup.visible = on;
    };

    const enemyMeshes = (team: Team) =>
      fighters.filter((f) => f.team !== team && f.alive && f.group).flatMap((f) => f.meshes);

    const friendlyMeshes = (team: Team) =>
      fighters.filter((f) => f.team === team && f.alive && f.group).flatMap((f) => f.meshes);

    const fighterByMesh = (mesh: THREE.Object3D) => {
      for (const f of fighters) if (f.meshes.includes(mesh as THREE.Mesh)) return f;
      return null;
    };

    /**
     * Highest walkable surface under (x, z).
     * Anything higher than `fromY + maxRise` is treated as a ceiling / roof
     * overhead and skipped — otherwise standing inside a shed snaps you onto
     * its roof and every doorway reads as a wall.
     */
    const groundAt = (x: number, z: number, fromY: number, maxRise = STEP_UP + 0.4) => {
      // Start the ray just under the ceiling limit so the very first hit is
      // already the answer — no need to gather (and sort) the whole column.
      const hit = castFirst(scratch.set(x, fromY + maxRise + 0.01, z), down, 60);
      return hit ? hit.point.y : null;
    };


    const pushKillFeed = (killer: Fighter, victim: Fighter, weaponName = "Rifle") => {
      const item: KillFeedItem = {
        id: Math.random().toString(36).slice(2),
        killer: killer.isHuman ? "YOU" : killer.id,
        killerTeam: killer.team,
        victim: victim.isHuman ? "YOU" : victim.id,
        victimTeam: victim.team,
        weapon: weaponName,
        time: 5,
      };
      killFeedRef.current = [item, ...killFeedRef.current].slice(0, 6);
      setKillFeed(killFeedRef.current);
    };


    const endRound = (winner: Team) => {
      const m = matchRef.current;
      const cfg = matchConfigRef.current;
      m[winner] += 1;
      m.phase = m[winner] >= cfg.roundsToWinMatch ? "matchEnd" : "intermission";
      m.roundWinner = winner;
      m.matchWinner = m[winner] >= cfg.roundsToWinMatch ? winner : null;
      m.countdown = m.matchWinner ? MATCH_END_SECONDS : INTERMISSION_SECONDS;
      intermissionRef.current = m.countdown;
      setMatch({ ...m });
      syncHud();
      const playerTeam = human?.team ?? "blue";
      if (m.matchWinner === playerTeam) {
        resumeSfx();
        // let the final kill/death one-shots clear before the stinger lands
        window.setTimeout(() => playVictory(0.95), 260);
      }
      if (m.matchWinner) {

        if (!saveSentRef.current) {
          saveSentRef.current = true;
          saveMatchResult({
            data: {
              blue_score: m.blue,
              red_score: m.red,
              winner: m.matchWinner,
              player_team: human?.team ?? "blue",
              player_kills: playerStats.kills,
              player_deaths: playerStats.deaths,
            },
          }).catch(() => {});
          getLeaderboard()
            .then((res) => setLeaderboard(res))
            .catch(() => {});
          if (profile && onProfileChange) {
            const updated = applyMatchRewards(profile, {
              won: m.matchWinner === human?.team,
              kills: playerStats.kills,
              deaths: playerStats.deaths,
              headshots: playerStats.headshots,
              characterId: characterRef.current.id,
              bountyBonus,
            });
            onProfileChange(updated);
          }

        }
        setTimeout(() => {
          saveSentRef.current = false;
          startMatch();
        }, MATCH_END_SECONDS * 1000);
      } else {
        setTimeout(() => startNewRound(), INTERMISSION_SECONDS * 1000);
      }
    };

    const startNewRound = () => {
      scoreState.blue = 0;
      scoreState.red = 0;
      matchRef.current.phase = "countdown";
      matchRef.current.roundWinner = null;
      matchRef.current.countdown = COUNTDOWN_SECONDS;
      matchRef.current.round += 1;
      countdownRef.current = COUNTDOWN_SECONDS;
      setMatch({ ...matchRef.current });
      for (const f of fighters) respawn(f, true);
      syncHud();
    };

    const announceStreak = (title: string, sub: string) => {
      const id = performance.now();
      setStreakBanner({ id, title, sub });
      window.clearTimeout(streakRef.current.timer);
      streakRef.current.timer = window.setTimeout(() => setStreakBanner(null), 1900);
    };

    const trackStreak = (victim: Fighter, killer: Fighter) => {
      const s = streakRef.current;
      if (victim.isHuman) {
        s.count = 0;
        s.multi = 0;
        return;
      }
      if (!killer.isHuman) return;
      const now = performance.now();
      s.multi = now - s.lastAt < 4000 ? s.multi + 1 : 1;
      s.lastAt = now;
      s.count += 1;
      const multiLabel =
        s.multi >= 5 ? "Wolfpack" : s.multi === 4 ? "Quad kill" : s.multi === 3 ? "Triple kill" : s.multi === 2 ? "Double kill" : null;
      if (multiLabel) {
        announceStreak(multiLabel, `${s.multi} in a row, fast`);
        return;
      }
      if (s.count === 3) announceStreak("On a roll", "3 kill streak");
      else if (s.count === 5) announceStreak("Rampage", "5 kill streak");
      else if (s.count === 8) announceStreak("Unstoppable", "8 kill streak");
      else if (s.count > 8 && s.count % 5 === 0) announceStreak("Lone wolf", `${s.count} kill streak`);
    };

    const kill = (victim: Fighter, killer: Fighter) => {
      victim.alive = false;
      victim.hp = 0;
      victim.respawnIn = RESPAWN_SECONDS;
      if (victim.group) victim.group.visible = false;
      scoreState[killer.team] += 1;
      if (killer.isHuman) {
        playerStats.kills += 1;
        const hasBounty = profileRef.current?.loadout.tactical === "bounty";
        if (hasBounty && bountyBonus === 0) {
          bountyBonus = TACTICAL_BONUS;
          playSfx("equip", 0.8, 0.9);
        }
      }
      if (victim.isHuman) playerStats.deaths += 1;
      setPlayerStatsHud({ kills: playerStats.kills, deaths: playerStats.deaths, headshots: playerStats.headshots });
      if (killer.isHuman || victim.isHuman) playSfx("kill", killer.isHuman ? 0.9 : 0.55);
      if (victim.isHuman) playSfx("death", 0.85);
      else playSfxAt("death", victim.pos.distanceTo(walkPos), 0.6, (Math.random() - 0.5) * 0.08);
      pushKillFeed(killer, victim);
      trackStreak(victim, killer);
      // Drop FF coins from eliminated fighters.
      const bounds = activeMap.bounds;
      if (bounds) {
        const coins = spawnFfCoins(root, victim.isHuman ? 5 : 2, bounds, (x, z) => groundAt(x, z, victim.pos.y, 3));
        ffCoinsRef.current.push(...coins);
      }
      if (scoreState[killer.team] >= matchConfigRef.current.killsToWinRound) {
        endRound(killer.team);
      } else {
        syncHud();
      }
    };

    /** effects of the equipped power + skill slots + pet companion */
    const activeEffects = () => {
      const powerFx = powerRef.current.active > 0
        ? { ...NO_EFFECT, ...POWERS[characterRef.current.power].effects }
        : NO_EFFECT;
      const passiveFx = combinePassives(profileRef.current?.loadout?.passives ?? []);
      const petFx = PETS[profileRef.current?.pet as keyof typeof PETS]?.effect ?? {};
      const get = (obj: Record<string, unknown>, key: string, fallback: number) => {
        const v = obj[key];
        return typeof v === "number" ? v : fallback;
      };
      return {
        speed: get(powerFx, "speed", 1) * passiveFx.speed * get(petFx, "speed", 1),
        damageTaken: get(powerFx, "damageTaken", 1) * passiveFx.damageTaken * get(petFx, "damageTaken", 1),
        damageDealt: get(powerFx, "damageDealt", 1) * passiveFx.damageDealt * get(petFx, "damageDealt", 1),
        recoil: get(powerFx, "recoil", 1) * passiveFx.recoil * get(petFx, "recoil", 1),
        reload: get(powerFx, "reload", 1) * passiveFx.reload * get(petFx, "reload", 1),
        fireRate: get(powerFx, "fireRate", 1),
        regen: get(powerFx, "regen", 0) + passiveFx.regen + get(petFx, "regen", 0),
      };
    };

    const damage = (victim: Fighter, amount: number, killer: Fighter, headshot = false) => {
      if (!victim.alive) return;
      let incoming = amount;
      // Melee deflection: pan/bat/katana on the back can block shots from behind
      if (isDeflectionMelee(victim.sidearm)) {
        const toKiller = killer.pos.clone().sub(victim.pos);
        toKiller.y = 0;
        const victimYaw = victim.isHuman ? camera.rotation.y : (victim.group?.rotation.y ?? 0);
        const facing = new THREE.Vector3(Math.sin(victimYaw), 0, Math.cos(victimYaw));
        const behind = toKiller.normalize().dot(facing) > 0.35;
        if (behind && Math.random() < 0.35) {
          playSfxAt("hit", victim.pos.distanceTo(walkPos), 0.6, (Math.random() - 0.5) * 0.1);
          spawnImpact(victim.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), new THREE.Color(0xc0c0c0));
          return;
        }
      }
      if (victim.isHuman) {
        // Emberveil: the round dies on the shell, never reaching the player
        if (barrierUp()) {
          const from = killer.pos.clone().setY(killer.pos.y + 1.2);
          const to = victim.pos.clone().setY(victim.pos.y + 1.1);
          const dir = from.sub(to).normalize().multiplyScalar(barrierDome.radius);
          barrierDome.impact(to.add(dir));
          playSfx("hit", 0.35, -0.35);
          return;
        }
      }
      // Physical armor soaks body/head damage before skills or shields.
      const armor = applyArmor(victim.armor, incoming, headshot);
      incoming = armor.damage;
      if (victim.isHuman) {
        incoming *= activeEffects().damageTaken;
        const st = powerRef.current;
        if (st.shield > 0) {
          const absorbed = Math.min(st.shield, incoming);
          st.shield -= absorbed;
          incoming -= absorbed;
        }
      }
      incoming = Math.max(0, Math.round(incoming));
      victim.hp -= incoming;
      if (victim.isHuman) {
        damageFlashRef.current = 0.7;
        playSfx(Math.random() < 0.5 ? "hurt" : "hurt2", 0.8, (Math.random() - 0.5) * 0.06);
      }
      if (victim.hp <= 0) {
        if (killer.isHuman && headshot) playerStats.headshots += 1;
        kill(victim, killer);
      } else {
        if (!victim.isHuman) {
          playSfxAt(Math.random() < 0.5 ? "hurt" : "hurt2", victim.pos.distanceTo(walkPos), 0.5, (Math.random() - 0.5) * 0.1);
        }
        if (killer.isHuman) {
          if (settingsRef.current.showHitMarkers) {
            hitMarkerRef.current = 0.18;
            setHitMarker(0.18);
          }
          if (settingsRef.current.hitSounds) playSfx("hit", 0.85, (Math.random() - 0.5) * 0.08);
        }
        syncHud();
      }
    };

    /** Restore HP to a teammate. */
    const heal = (target: Fighter, amount: number) => {
      if (!target.alive) return;
      target.hp = Math.min(MAX_HP, target.hp + Math.round(amount));
      if (target.isHuman) syncHud();
    };

    /** Floating damage number at the world-space hit point. */
    const spawnDamagePopup = (point: THREE.Vector3, amount: number, head: boolean) => {
      if (!settingsRef.current.showDamageNumbers) return;
      const el = renderer.domElement;
      const p = point.clone().project(camera);
      if (p.z > 1) return;
      const x = (p.x * 0.5 + 0.5) * el.clientWidth;
      const y = (-p.y * 0.5 + 0.5) * el.clientHeight;
      const id = ++popupIdRef.current;
      setDamagePopups((list) => [...list.slice(-11), { id, x, y, amount, head }]);
      const t = window.setTimeout(() => {
        setDamagePopups((list) => list.filter((d) => d.id !== id));
        popupTimersRef.current = popupTimersRef.current.filter((h) => h !== t);
      }, 900);
      popupTimersRef.current.push(t);
    };


    // the spawn animation is a one-time show at the start of the match
    let spawnFxPlayed = false;
    let introTime = 0;

    const respawn = (f: Fighter, withFx = false) => {
      f.alive = true;
      f.hp = MAX_HP;
      f.respawnIn = 0;
      f.cooldown = 0.8 + Math.random() * 1.2;
      f.backpack.items = [];
      if (f.ai) {
        // fresh brain on respawn, and pick up any difficulty change mid-match
        const prof = settingsRef.current.botDifficulty;
        f.ai = createBotBrain(prof, f.ai.preferredRange);
      }
      f.pos.copy(f.home.top);
      const gy = groundAt(f.pos.x, f.pos.z, f.pos.y + 0.5, 1.0);
      if (gy !== null) f.pos.y = gy;
      // each fighter gets its own effect, played exactly where it lands
      if (withFx) {
        f.fx?.burst(f.pos);
        if (f.isHuman) playSfx("spawn", 0.8);
      }
      if (f.group) {
        f.group.visible = true;
        f.group.position.copy(f.pos);
      }
      if (f.isHuman) {
        // the cage is a fixed team-wide box, so it stays where it was built

        walkPos.copy(f.pos);
        velY = 0;
        grounded = true;
        yaw = Math.atan2(f.pos.x, f.pos.z);
        pitch = 0;
        setBackpackLevel(f.backpack.level);
      }
      syncHud();
    };

    const startMatch = () => {
      scoreState.blue = 0;
      scoreState.red = 0;
      matchRef.current = {
        blue: 0,
        red: 0,
        phase: "countdown",
        round: 1,
        roundWinner: null,
        matchWinner: null,
        countdown: COUNTDOWN_SECONDS,
      };
      countdownRef.current = COUNTDOWN_SECONDS;
      killFeedRef.current = [];
      streakRef.current.count = 0;
      streakRef.current.multi = 0;
      window.clearTimeout(streakRef.current.timer);
      setStreakBanner(null);
      playerStats.kills = 0;
      playerStats.deaths = 0;
      playerStats.headshots = 0;
      setPlayerStatsHud({ kills: 0, deaths: 0, headshots: 0 });
      setMatch(matchRef.current);
      setKillFeed([]);
      saveSentRef.current = false;
      // clear lingering decoys and FF coins between matches
      for (const d of decoys) decoyGroup.remove(d.root);
      decoys.length = 0;
      disposeFfCoins(ffCoinsRef.current);
      setFfCoinCount(0);
      setBackpackLevel(1);
      // safe zone: starts covering the whole arena, then shrinks to a duel ring
      const mapW = boundsMaxX - boundsMinX;
      const mapD = boundsMaxZ - boundsMinZ;
      safeZoneRef.current = createSafeZone(
        new THREE.Vector3((boundsMinX + boundsMaxX) / 2, 0, (boundsMinZ + boundsMaxZ) / 2),
        Math.max(mapW, mapD) * 0.55,
        Math.min(mapW, mapD) * 0.22,
        35,
        60,
        5,
      );
      const firstTime = !spawnFxPlayed;
      for (const f of fighters) respawn(f, true);
      if (firstTime) {
        spawnFxPlayed = true;
        introTime = 5;
        introRef.current = 5;
        setIntro(true);
      }

      syncHud();
    };
    startMatchRef.current = startMatch;

    const startReload = (weaponId: string) => {
      if (isReloadingRef.current) return;
      const cur = ammoRef.current[weaponId];
      if (!cur || cur.mag >= getMagazine(weaponId) || cur.reserve <= 0) return;
      isReloadingRef.current = true;
      reloadingWeaponRef.current = weaponId;
      setIsReloading(true);
      reloadTimerRef.current = getReloadTime(weaponId);
      reloadLeftRef.current = reloadTimerRef.current;
      setReloadLeft(reloadTimerRef.current);
      const mode = getWeaponBehavior(weaponId).mode;
      playSfx(mode === "pump" || mode === "bolt" ? "pump" : "reload", 0.75);
    };
    startReloadRef.current = startReload;


    const finishReload = (weaponId: string) => {
      if (!isReloadingRef.current) return;
      const weaponBeingReloaded = reloadingWeaponRef.current ?? weaponId;
      const cur = ammoRef.current[weaponBeingReloaded];
      if (!cur) {
        isReloadingRef.current = false;
        reloadingWeaponRef.current = null;
        reloadLeftRef.current = 0;
        setIsReloading(false);
        setReloadLeft(0);
        return;
      }
      const mag = getMagazine(weaponBeingReloaded);
      const need = mag - cur.mag;
      const take = Math.min(need, cur.reserve);
      const next = { ...cur, mag: cur.mag + take, reserve: cur.reserve - take };
      ammoRef.current = { ...ammoRef.current, [weaponBeingReloaded]: next };
      setAmmo(ammoRef.current);
      isReloadingRef.current = false;
      reloadingWeaponRef.current = null;
      reloadLeftRef.current = 0;
      setIsReloading(false);
      setReloadLeft(0);
    };


    const RECOIL_PITCH = 0.045;


    // Proper cone spread: build an orthonormal basis around `dir` and offset
    // inside a disc, so the deviation is symmetric and never biased downward.
    const applySpread = (dir: THREE.Vector3, spread: number) => {
      if (spread <= 0) return dir.normalize();
      const ref = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(dir, ref).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      dir.add(right.multiplyScalar(Math.cos(theta) * r));
      dir.add(up.multiplyScalar(Math.sin(theta) * r));
      return dir.normalize();
    };


    /* ------------------------------------------------------------------
     * Breakable shield walls: thrown in front of the player, added to the
     * collider set with their own HP so bullets chip them down.
     * ---------------------------------------------------------------- */
    const WALL_HP = 350;
    const WALL_RANGE = 14;
    const shieldWalls: { mesh: THREE.Mesh; hp: number; visual: GlooVisual }[] = [];
    let glooTemplate: THREE.Object3D | null = null;
    loadGlooTemplate().then((t) => {
      glooTemplate = t;
    });

    const removeWall = (mesh: THREE.Mesh) => {
      const i = shieldWalls.findIndex((w) => w.mesh === mesh);
      if (i !== -1) {
        shieldWalls[i]!.visual.dispose();
        shieldWalls.splice(i, 1);
      }
      collidersRef.current = collidersRef.current.filter((m) => m !== mesh);
      root.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    };

    const damageWall = (mesh: THREE.Mesh, amount: number, at: THREE.Vector3) => {
      const entry = shieldWalls.find((w) => w.mesh === mesh);
      if (!entry) return;
      entry.hp -= amount;
      // brighter, chunkier ice shatter: a hot white core plus icy cyan shards
      spawnImpact(at, new THREE.Color(0xffffff));
      spawnImpact(at.clone().addScaledVector(new THREE.Vector3(
        (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5),
      ), 0.18), new THREE.Color(0x7fe8ff));
      playSfx("hit", 0.85, 0.25);
      shakeRef.current = Math.max(shakeRef.current, 0.05);
      entry.visual.flash();
      entry.visual.setHealth(entry.hp / WALL_HP);
      if (entry.hp <= 0) {
        // shatter burst on break
        for (let i = 0; i < 5; i++) {
          spawnImpact(
            at.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 1.6,
              Math.random() * 1.4,
              (Math.random() - 0.5) * 1.6,
            )),
            new THREE.Color(i % 2 ? 0xffffff : 0x9fe4ff),
          );
        }
        playSfx("land", 1, -0.3);
        playSfx("knife", 0.7, 0.3);
        shakeRef.current = Math.max(shakeRef.current, 0.22);
        removeWall(mesh);
      }
    };

    /** invisible box collider carrying the animated gloo visual */
    const placeWallAt = (center: THREE.Vector3, angle: number) => {
      const collider = new THREE.Mesh(
        new THREE.BoxGeometry(GLOO_WIDTH, GLOO_HEIGHT, GLOO_DEPTH),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
      );
      collider.position.set(center.x, center.y + GLOO_HEIGHT / 2, center.z);
      collider.rotation.y = angle;
      collider.userData["shieldWall"] = true;
      const visual = createGlooVisual(glooTemplate);
      visual.object.position.y = -GLOO_HEIGHT / 2;
      collider.add(visual.object);
      root.add(collider);
      collidersRef.current = [...collidersRef.current, collider];
      shieldWalls.push({ mesh: collider, hp: WALL_HP, visual });

      // --- summon punch: layered whoosh + slam + icy crackle -------------
      playSfx("equip", 0.9, 0.1);
      playSfx("land", 1, -0.35);
      playSfx("spawn", 0.6, 0.35);
      window.setTimeout(() => playSfx("knife", 0.5, -0.25), 70);
      shakeRef.current = Math.max(shakeRef.current, 0.38);

      // bright frost burst along the base of the wall
      const right = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
      for (let i = 0; i < 7; i++) {
        const t = (i / 6 - 0.5) * GLOO_WIDTH;
        spawnImpact(
          new THREE.Vector3(center.x, center.y + 0.15 + Math.random() * 0.5, center.z).addScaledVector(right, t),
          new THREE.Color(i % 2 ? 0xffffff : 0x8fe9ff),
        );
      }
      return true;
    };


    /* ---- placement preview ("aim & place" mode) ---- */
    let ghost: GlooVisual | null = null;
    let ghostValid = false;
    const ghostSpot = new THREE.Vector3();
    let ghostAngle = 0;

    /** where the player is currently looking, clamped to a walkable spot */
    const resolveAimSpot = () => {
      const dirv = new THREE.Vector3(
        -Math.sin(yaw) * Math.cos(pitch),
        Math.sin(-pitch),
        -Math.cos(yaw) * Math.cos(pitch),
      ).normalize();
      const eye = walkPos.clone().setY(walkPos.y + EYE_HEIGHT);
      const hits = [castFirst(eye, dirv, WALL_RANGE)].filter(Boolean) as THREE.Intersection[];

      const target = hits[0]
        ? hits[0].point.clone().addScaledVector(dirv, -0.6)
        : eye.clone().addScaledVector(dirv, WALL_RANGE);
      const gy = groundAt(target.x, target.z, Math.max(target.y, walkPos.y) + 0.5, 2.5);
      const flat = walkPos.distanceTo(new THREE.Vector3(target.x, walkPos.y, target.z));
      ghostValid = gy !== null && flat <= WALL_RANGE && Math.abs((gy ?? 0) - walkPos.y) < 4;
      ghostSpot.set(target.x, gy ?? walkPos.y, target.z);
      ghostAngle = yaw + Math.PI;
    };

    const startPlacement = () => {
      if (ghost) return;
      ghost = createGlooVisual(glooTemplate, { ghost: true });
      root.add(ghost.object);
      resolveAimSpot();
      ghost.object.position.copy(ghostSpot);
      setPlacingWall(true);
      playSfx("ads", 0.4);
    };

    const cancelPlacement = () => {
      if (!ghost) return;
      root.remove(ghost.object);
      ghost.dispose();
      ghost = null;
      setPlacingWall(false);
    };

    const confirmPlacement = () => {
      if (!ghost) return false;
      if (!ghostValid) {
        playSfx("ads", 0.3, -0.4);
        return false;
      }
      const spot = ghostSpot.clone();
      const angle = ghostAngle;
      cancelPlacement();
      return placeWallAt(spot, angle);
    };

    /** instant mode — slam it down on the nearest ground right in front */
    const instantDrop = () => {
      const dirv = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      for (const dist of [3.2, 2.4, 1.8, 4.2]) {
        const c = walkPos.clone().addScaledVector(dirv, dist);
        const gy = groundAt(c.x, c.z, walkPos.y + 0.5, 1.5);
        if (gy !== null && Math.abs(gy - walkPos.y) < 2.5) {
          return placeWallAt(new THREE.Vector3(c.x, gy, c.z), yaw + Math.PI);
        }
      }
      return placeWallAt(walkPos.clone().addScaledVector(dirv, 3.2).setY(walkPos.y), yaw + Math.PI);
    };

    const wallButton = () => {
      if (!human || !human.alive || modeRef.current !== "walk") return false;
      if (settingsRef.current.wallPlacement === "instant") return instantDrop();
      if (ghost) return confirmPlacement();
      startPlacement();
      return false;
    };

    const updateWalls = (dt: number) => {
      for (const w of shieldWalls) w.visual.update(dt);
      if (ghost) {
        if (!human || !human.alive) {
          cancelPlacement();
        } else {
          resolveAimSpot();
          ghost.object.position.lerp(ghostSpot, Math.min(1, dt * 18));
          ghost.object.rotation.y = ghostAngle;
          setGhostValid(ghost, ghostValid);
          ghost.update(dt);
        }
      }
    };

    const isPlacingWall = () => ghost !== null;

    const shoot = (fromAuto = false) => {
      const colliders = collidersRef.current;
      if (isPlacingWall()) return false;
      if (!laserRef.current || !human || !human.alive) return false;
      if (matchRef.current.phase === "countdown") return false;
      if (isReloadingRef.current) return false;
      if (weaponCooldownRef.current > 0) return false;

      const weaponId = weaponRef.current;
      const w = applySkinStats(getWeapon(weaponId) ?? undefined, profileRef.current?.equippedSkins[weaponId]);
      if (!w) return false;
      const behavior = getWeaponBehavior(weaponId);
      const weaponName = w.name;
      const weaponRange = getWeaponRange(w);

      const currentAmmo = ammoRef.current[weaponId];
      if (currentAmmo && currentAmmo.mag <= 0) {
        // dry click, then auto-reload when empty
        playSfx("dryfire", 0.7);
        if (settingsRef.current.autoReload) startReload(weaponId);
        return false;
      }

      // sound
      if (sfxInitializedRef.current) {
        playSfx(behavior.sound, 1, (Math.random() - 0.5) * 0.04);
        // pump / bolt weapons rack the action right after the shot
        if (behavior.mode === "pump" || behavior.mode === "bolt") {
          window.setTimeout(() => playSfx("pump", 0.65), behavior.cycle * 420);
        }
      }


      weaponCooldownRef.current = getWeaponFireInterval(w) * activeEffects().fireRate;
      setWeaponReady(false);

      // The ray is built from the player's own state, never from the camera:
      // the camera carries screen shake and is repositioned later in the frame.
      // IMPORTANT: the ray uses the aim the player currently sees (the recoil
      // already accumulated and rendered), and the *new* kick from this shot is
      // applied afterwards — so the bullet always leaves through the crosshair.
      const aimYaw = yaw + recoilYawRef.current;
      const aimPitch = pitch - recoilRef.current;
      const origin = new THREE.Vector3(walkPos.x, walkPos.y + eyeHeight(), walkPos.z);
      const dir = new THREE.Vector3(
        Math.sin(aimYaw) * Math.cos(aimPitch),
        Math.sin(aimPitch),
        Math.cos(aimYaw) * Math.cos(aimPitch),
      ).multiplyScalar(-1).normalize();
      applySpread(dir, behavior.spread * (adsRef.current ? 0.35 : 1));

      // now kick the view up for the *next* shot
      const recoilScale = Math.max(0.5, 1.1 - w.fireRate / 200) * behavior.recoil * activeEffects().recoil;
      recoilRef.current = Math.min(recoilRef.current + RECOIL_PITCH * recoilScale, 0.32);
      recoilYawRef.current += (Math.random() - 0.5) * 0.035 * recoilScale;
      shakeRef.current = 0.12;


      // tracers leave the gun, which sits down-right of the eye
      const rightVec = new THREE.Vector3(Math.cos(aimYaw), 0, -Math.sin(aimYaw));
      const muzzlePos = origin
        .clone()
        .add(rightVec.clone().multiplyScalar(0.3))
        .add(new THREE.Vector3(0, -0.25, 0))
        .add(dir.clone().multiplyScalar(0.6));

      const muzzle = muzzleRef.current;
      if (muzzle) {
        muzzle.mesh.position.copy(muzzlePos);
        muzzle.light.position.copy(muzzle.mesh.position);
        muzzle.mesh.visible = true;
        muzzle.light.intensity = 18;
        muzzle.ttl = 0.06;
      }

      const pellets = Math.max(1, behavior.shots);
      let anyHit = false;

      for (let p = 0; p < pellets; p++) {
        let pelletDir = dir.clone();
        if (pellets > 1) {
          // shotgun pellet spread
          pelletDir.add(new THREE.Vector3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08));
          pelletDir.normalize();
        }
        const worldHits = [castFirst(origin, pelletDir, weaponRange, colliders)].filter(
          Boolean,
        ) as THREE.Intersection[];
        raycaster.set(origin, pelletDir);
        raycaster.far = weaponRange;
        const botHits = raycaster.intersectObjects(enemyMeshes(human.team), false);
        const friendlyHits = behavior.healsTeammates
          ? raycaster.intersectObjects(friendlyMeshes(human.team), false)
          : [];

        const worldDist = worldHits[0]?.distance ?? Infinity;
        const botDist = botHits[0]?.distance ?? Infinity;
        const friendDist = friendlyHits[0]?.distance ?? Infinity;


        const laser = laserRef.current;
        const posAttr = laser.line.geometry.attributes["position"];
        if (!posAttr) continue;
        const positions = posAttr.array as Float32Array;
        positions[0] = muzzlePos.x;
        positions[1] = muzzlePos.y;
        positions[2] = muzzlePos.z;

        let end: THREE.Vector3;
        let hitBot = false;
        let healBeam = false;
        const botHit = botHits[0];
        const friendHit = friendlyHits[0];
        if (behavior.healsTeammates && friendDist < worldDist && friendDist < botDist && friendHit) {
          end = friendHit.point.clone();
          const target = fighterByMesh(friendHit.object);
          if (target) {
            const amt = Math.round(getWeaponDamageAt(w, friendHit.distance, false) * 1.6);
            heal(target, amt);
            spawnDamagePopup(end, amt, false);
            healBeam = true;
            anyHit = true;
          }
        } else if (botDist < worldDist && botHit) {
          end = botHit.point.clone();
          const victim = fighterByMesh(botHit.object);
          if (victim) {
            const headshot = botHit.object.userData["hitZone"] === "head";
            const dmg = Math.round(getWeaponDamageAt(w, botHit.distance, headshot) * activeEffects().damageDealt);
            damage(victim, dmg, human, headshot);
            spawnDamagePopup(end, dmg, headshot);
            hitBot = true;
            anyHit = true;
          }
        } else if (worldHits[0]) {
          end = worldHits[0].point.clone();
          const obj = worldHits[0].object as THREE.Mesh;
          if (obj.userData["shieldWall"]) {
            damageWall(obj, getWeaponDamageAt(w, worldHits[0].distance, false), end);
          }
        } else {
          end = origin.clone().add(pelletDir.multiplyScalar(weaponRange));
        }

        positions[3] = end.x;
        positions[4] = end.y;
        positions[5] = end.z;
        posAttr.needsUpdate = true;

        laser.material.color.setHex(healBeam ? 0x4ade80 : 0xffe08a);
        (laser.sparkMesh.material as THREE.MeshBasicMaterial).color.setHex(healBeam ? 0x4ade80 : 0xffe08a);
        laser.spark.color.setHex(healBeam ? 0x4ade80 : 0xffa040);
        laser.sparkMesh.position.copy(end);
        laser.sparkMesh.visible = true;
        laser.spark.position.copy(end);
        laser.spark.intensity = 5;
        laser.material.opacity = 1;
        laser.ttl = 0.12;

        spawnImpact(end, hitBot ? new THREE.Color(human.team === "blue" ? 0x3f8fff : 0xff3b1f) : healBeam ? new THREE.Color(0x4ade80) : undefined);
        // Kill feed is already pushed by damage()/kill(); don't duplicate it here.
      }


      // decrement ammo
      if (currentAmmo) {
        currentAmmo.mag = Math.max(0, currentAmmo.mag - 1);
        ammoRef.current = { ...ammoRef.current, [weaponId]: currentAmmo };
        setAmmo(ammoRef.current);
      }

      return anyHit;
    };



    /* ------------------------------------------------------------------
     * Scope aim assist
     * Right-clicking snaps the aim onto the closest visible enemy's nearest
     * body part. The head is only ever chosen when the crosshair is already
     * sitting near it, and even then only ~25% of the time — otherwise the
     * lock lands on the torso. Once locked, the aim keeps tracking the target
     * every frame, so it follows the enemy (and the player) while moving.
     * ---------------------------------------------------------------- */
    const HEAD_Y = 1.62;
    const BODY_Y = 1.15;
    const ASSIST_ACQUIRE_ANGLE = 0.22; // ~12.5° cone around the crosshair
    const ASSIST_HEAD_WINDOW = 0.022; // "near the head" tolerance
    const ASSIST_HEAD_CHANCE = 0.25;
    const ASSIST_BREAK_ANGLE = 0.45; // looking this far away drops the lock
    const ASSIST_MAX_RANGE = 160;
    let aimLock: { target: Fighter; zone: "head" | "body" } | null = null;
    /** 0..1 — how hard the player is currently dragging against the lock */
    let manualAim = 0;

    const eyePos = () => new THREE.Vector3(walkPos.x, walkPos.y + eyeHeight(), walkPos.z);
    const aimPointOf = (f: Fighter, zone: "head" | "body") =>
      f.pos.clone().setY(f.pos.y + (zone === "head" ? HEAD_Y : BODY_Y));
    const currentAimDir = () =>
      new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
        .multiplyScalar(-1)
        .normalize();
    const visible = (from: THREE.Vector3, to: THREE.Vector3) => {
      const delta = to.clone().sub(from);
      const dist = delta.length();
      if (dist < 0.001) return true;
      return castFirst(from, delta.normalize(), dist - 0.35) === null;

    };

    const acquireAimLock = () => {
      aimLock = null;
      if (settingsRef.current.aimAssist === "off") return;
      if (!human || !human.alive) return;
      const eye = eyePos();
      const aimDir = currentAimDir();
      const strength = AIM_ASSIST_STRENGTH[settingsRef.current.aimAssist];
      let best: { target: Fighter; zone: "head" | "body"; ang: number } | null = null;
      for (const f of fighters) {
        if (f.team === human.team || !f.alive || !f.group) continue;
        const head = aimPointOf(f, "head");
        const body = aimPointOf(f, "body");
        if (eye.distanceTo(body) > ASSIST_MAX_RANGE) continue;
        const headSeen = visible(eye, head);
        const bodySeen = visible(eye, body);
        if (!headSeen && !bodySeen) continue;
        const aHead = headSeen ? aimDir.angleTo(head.clone().sub(eye).normalize()) : Infinity;
        const aBody = bodySeen ? aimDir.angleTo(body.clone().sub(eye).normalize()) : Infinity;
        const ang = Math.min(aHead, aBody);
        if (ang > ASSIST_ACQUIRE_ANGLE * strength) continue;
        if (best && ang >= best.ang) continue;
        const nearHead = aHead <= aBody + ASSIST_HEAD_WINDOW;
        const zone: "head" | "body" =
          nearHead && headSeen && Math.random() < ASSIST_HEAD_CHANCE ? "head" : bodySeen ? "body" : "head";
        best = { target: f, zone, ang };
      }
      if (best) aimLock = { target: best.target, zone: best.zone };
    };

    const updateAimLock = (dt: number) => {
      if (!adsRef.current || !human || !human.alive || settingsRef.current.aimAssist === "off") {
        aimLock = null;
        manualAim = 0;
        return;
      }
      // dragging bleeds off as soon as the player stops fighting the magnet
      manualAim = Math.max(0, manualAim - dt * 0.9);
      const lock = aimLock;
      if (!lock) return;
      if (!lock.target.alive || !lock.target.group) {
        aimLock = null;
        return;
      }
      const eye = eyePos();
      const point = aimPointOf(lock.target, lock.zone);
      const delta = point.clone().sub(eye);
      if (delta.length() > ASSIST_MAX_RANGE) {
        aimLock = null;
        return;
      }
      const v = delta.clone().normalize();
      if (currentAimDir().angleTo(v) > ASSIST_BREAK_ANGLE) {
        aimLock = null;
        return;
      }
      // sustained manual drag rips the aim off the body entirely
      if (manualAim >= 0.999) {
        aimLock = null;
        manualAim = 0;
        return;
      }
      const desiredPitch = Math.asin(THREE.MathUtils.clamp(-v.y, -1, 1));
      const desiredYaw = Math.atan2(-v.x, -v.z);
      let dYaw = desiredYaw - yaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      // the magnet weakens the more the player pulls; vertical is looser than
      // horizontal so walking the shots up a body always stays possible
      const give = 1 - manualAim * 0.95;
      const k = (1 - Math.exp(-dt * 10)) * give;
      yaw += dYaw * k;
      pitch += (desiredPitch - pitch) * k * 0.5;
    };

    /**
     * Aim "weight": scoped aiming is slower, firing while scoped is slower
     * still, and a locked-on target adds real resistance — you can drag the
     * muzzle up or off the enemy, it just takes a deliberate pull.
     */
    const aimHeaviness = () => {
      let m = 1;
      if (adsRef.current) m *= 0.85;
      if (adsRef.current && mouseHeldRef.current) m *= 0.78;
      if (aimLock) m *= 0.5;
      return m;
    };
    const noteManualAim = (dx: number, dy: number) => {
      if (!aimLock) return;
      manualAim = Math.min(1, manualAim + (Math.abs(dx) + Math.abs(dy) * 1.6) * 0.012);
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onMouseDown = (e: MouseEvent) => {
      // while a gloo wall ghost is up, the mouse places / cancels it instead of firing
      if (isPlacingWall() && modeRef.current === "walk") {
        e.preventDefault();
        if (e.button === 2) {
          cancelPlacement();
          return;
        }
        if (e.button === 0) {
          if (document.pointerLockElement !== renderer.domElement) {
            renderer.domElement.requestPointerLock?.();
            return;
          }
          if (confirmPlacement()) consumeWallChargeRef.current();
          return;
        }
        return;
      }
      if (e.button === 2) {
        if (modeRef.current === "walk" && document.pointerLockElement === renderer.domElement) {
          if (settingsRef.current.adsMode === "toggle") {
            actionsRef.current?.toggleAds();
          } else if (!adsRef.current) {
            adsRef.current = true;
            const cls = getWeapon(weaponRef.current)?.cls;
            // every weapon aims down sights except shotguns and melee
            if (cls !== "Shotgun" && cls !== "Melee") setScoped(true);
            playSfx("ads", 0.5);
            acquireAimLock();
          }
        }
        return;
      }
      if (e.button !== 0) return;
      if (!sfxInitializedRef.current) {
        initSfx();
        sfxInitializedRef.current = true;
        setSfxReady(true);
      }
      if (modeRef.current !== "walk") return;
      if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock?.();
        return;
      }
      if (bombArmed) {
        bombAiming = true;
        return;
      }
      mouseHeldRef.current = true;
      const behavior = getWeaponBehavior(weaponRef.current);
      if (behavior.mode === "auto" || behavior.mode === "burst") {
        if (behavior.mode === "burst" && !burstQueueRef.current) {
          burstQueueRef.current = { shotsLeft: behavior.shots, nextIn: 0 };
        }
      } else {
        shoot();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        if (settingsRef.current.adsMode !== "toggle" && adsRef.current) {
          adsRef.current = false;
          setScoped(false);
          playSfx("ads", 0.35, -0.08);
        }
        return;
      }
      if (e.button !== 0) return;
      if (bombArmed) {
        releaseBomb();
        return;
      }
      mouseHeldRef.current = false;
      // cancelling a burst mid-burst is intentional
    };


    /* ---- imperative actions used by the touch HUD ---- */
    const triggerDown = () => {
      if (bombArmed) {
        bombAiming = true;
        return;
      }
      if (isPlacingWall()) {
        if (confirmPlacement()) consumeWallChargeRef.current();
        return;
      }
      if (!sfxInitializedRef.current) {
        initSfx();
        sfxInitializedRef.current = true;
        setSfxReady(true);
      }
      mouseHeldRef.current = true;
      const behavior = getWeaponBehavior(weaponRef.current);
      if (behavior.mode === "auto") return;
      if (behavior.mode === "burst") {
        if (!burstQueueRef.current) burstQueueRef.current = { shotsLeft: behavior.shots, nextIn: 0 };
        return;
      }
      shoot();
    };
    const triggerUp = () => {
      if (bombArmed) {
        releaseBomb();
        return;
      }
      mouseHeldRef.current = false;
    };
    const toggleAds = () => {
      if (adsRef.current) {
        adsRef.current = false;
        setScoped(false);
        playSfx("ads", 0.35, -0.08);
        return;
      }
      adsRef.current = true;
      const cls = getWeapon(weaponRef.current)?.cls;
      if (cls !== "Shotgun" && cls !== "Melee") setScoped(true);
      playSfx("ads", 0.5);
      acquireAimLock();
    };
    const jump = () => {
      keys.add("Space");
      window.setTimeout(() => keys.delete("Space"), 120);
    };
    /* ---- channelled medkit ---- */
    const HEAL_TIME = 2;
    const HEAL_AMOUNT = 75;
    const healState = { active: false, remain: 0, stop: null as (() => void) | null };

    const endHeal = () => {
      if (!healState.active) return;
      healState.active = false;
      healState.stop?.();
      healState.stop = null;
      const leftover = Math.max(0, healState.remain) / HEAL_TIME;
      healState.remain = 0;
      onHealEndRef.current(leftover);
    };

    const startHeal = (fraction: number) => {
      if (!human || !human.alive || human.hp >= MAX_HP) return false;
      if (healState.active) return false;
      if (modeRef.current !== "walk") return false;
      healState.active = true;
      healState.remain = HEAL_TIME * Math.max(0.05, Math.min(1, fraction));
      healState.stop = playSfxStoppable("medkit", 0.9);
      return true;
    };

    /** ticked every frame; any movement aborts the kit and banks the rest */
    const tickHeal = (dt: number, moving: boolean) => {
      if (!healState.active) return;
      if (!human || !human.alive || moving) {
        endHeal();
        return;
      }
      const heal = (HEAL_AMOUNT / HEAL_TIME) * dt;
      human.hp = Math.min(MAX_HP, human.hp + heal);
      healState.remain -= dt;
      setHealProgress(1 - Math.max(0, healState.remain) / HEAL_TIME);
      syncHud();
      if (healState.remain <= 0 || human.hp >= MAX_HP) {
        healState.remain = Math.max(0, healState.remain);
        endHeal();
      }
    };

    /* ---- inhaler: instant top-up, works while sprinting ---- */
    const useInhaler = () => {
      if (!human || !human.alive) return;
      if (inhalersRef.current <= 0) return;
      if (human.hp >= MAX_HP && epRef.current >= MAX_EP) return;
      human.hp = Math.min(MAX_HP, human.hp + 25);
      setInhalers((n) => Math.max(0, n - 1));
      setEp((e) => Math.min(MAX_EP, e + 50));
      playSfx("medkit", 0.7, 0.4);
      syncHud();
    };
    useInhalerRef.current = useInhaler;

    /* ---- mushrooms: ground pickups that grant EP ---- */
    const mushroomGroup = new THREE.Group();
    scene.add(mushroomGroup);
    type Mushroom = { mesh: THREE.Object3D; cooldown: number; base: THREE.Vector3 };
    const mushrooms: Mushroom[] = [];
    const capMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.7 });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.9 });
    const spawnMushroom = (at: THREE.Vector3) => {
      const g = new THREE.Group();
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
      cap.position.y = 0.26;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.26, 8), stemMat);
      stem.position.y = 0.13;
      g.add(cap, stem);
      g.position.copy(at);
      mushroomGroup.add(g);
      mushrooms.push({ mesh: g, cooldown: 0, base: at.clone() });
    };
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.random();
      const r = 12 + Math.random() * 22;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const gy = groundAt(x, z, 12, 24);
      if (gy === null) continue;
      spawnMushroom(new THREE.Vector3(x, gy + 0.02, z));
    }
    /** walk over a mushroom to eat it: +30 EP, regrows after 25 s */
    const tickMushrooms = (dt: number) => {
      const t = performance.now() * 0.002;
      for (const m of mushrooms) {
        if (m.cooldown > 0) {
          m.cooldown -= dt;
          if (m.cooldown <= 0) m.mesh.visible = true;
          continue;
        }
        m.mesh.position.y = m.base.y + Math.sin(t + m.base.x) * 0.03;
        if (!human || !human.alive) continue;
        if (walkPos.distanceTo(m.base) > 1.1) continue;
        m.cooldown = 25;
        m.mesh.visible = false;
        setEp((e) => Math.min(MAX_EP, e + 30));
        playSfx("buy", 0.5, 0.6);
      }
    };

    /* ---- armor pickups: vests and helmets on the ground ---- */
    const armorGroup = new THREE.Group();
    scene.add(armorGroup);
    type ArmorPickup = { mesh: THREE.Group; slot: "vest" | "helmet"; level: 1 | 2 | 3; base: THREE.Vector3 };
    const armorPickups: ArmorPickup[] = [];
    const spawnArmor = (slot: "vest" | "helmet", level: 1 | 2 | 3, at: THREE.Vector3) => {
      const g = createArmorPickupMesh(slot, level);
      g.position.copy(at);
      armorGroup.add(g);
      armorPickups.push({ mesh: g, slot, level, base: at.clone() });
    };
    // place a few low/mid tier vests and helmets around the map
    const armorSpawns: ["vest" | "helmet", 1 | 2 | 3][] = [
      ["vest", 1],
      ["helmet", 1],
      ["vest", 2],
      ["helmet", 2],
    ];
    for (let i = 0; i < armorSpawns.length; i++) {
      const [slot, level] = armorSpawns[i]!;
      const a = (i / armorSpawns.length) * Math.PI * 2 + Math.random() * 0.4;
      const r = 16 + Math.random() * 18;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const gy = groundAt(x, z, 12, 24);
      if (gy === null) continue;
      spawnArmor(slot, level, new THREE.Vector3(x, gy + 0.02, z));
    }
    const tickArmorPickups = (dt: number) => {
      const t = performance.now() * 0.002;
      for (const p of armorPickups) {
        p.mesh.position.y = p.base.y + Math.sin(t + p.base.x) * 0.03;
        p.mesh.rotation.y += dt * 0.5;
      }
      if (!human || !human.alive) return;
      for (let i = armorPickups.length - 1; i >= 0; i--) {
        const p = armorPickups[i]!;
        if (walkPos.distanceTo(p.base) > 1.2) continue;
        if (!shouldPickupArmor(human.armor[p.slot], p.level)) continue;
        equipArmor(human.armor, p.slot, p.level);
        p.mesh.removeFromParent();
        armorPickups.splice(i, 1);
        playSfx("buy", 0.55, 0.7);
        syncHud();
      }
    };
    const explosionFx = createExplosionFx(BOMB_RADIUS);
    scene.add(explosionFx.group);
    const smokeField = createSmokeField(initialQuality === "low" ? 0.5 : 1);
    scene.add(smokeField.group);
    /** active decoys: fake gunshot sources that draw bot attention and minimap dots */
    type Decoy = { root: THREE.Group; ttl: number; nextBark: number; team: Team };
    const decoys: Decoy[] = [];
    /** active pings: player-placed markers in the world */
    let currentPingKind: PingKind = "enemy";
    const pings: Ping[] = [];
    const pingGroup = new THREE.Group();
    scene.add(pingGroup);
    const decoyMat = new THREE.MeshStandardMaterial({ color: 0x8ee36d, emissive: 0x4aa02c, emissiveIntensity: 0.6 });
    const decoyGroup = new THREE.Group();
    scene.add(decoyGroup);
    const spawnDecoy = (at: THREE.Vector3, team: Team) => {
      const root = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.35, 8), decoyMat);
      body.position.y = 0.18;
      const dish = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.12, 12), decoyMat);
      dish.position.y = 0.42;
      root.add(body, dish);
      root.position.copy(at);
      decoyGroup.add(root);
      const light = new THREE.PointLight(0x8ee36d, 2.5, 7, 2);
      light.position.set(0, 0.6, 0);
      root.add(light);
      decoys.push({ root, ttl: DECOY_LIFE, nextBark: 0.2 + Math.random() * 0.4, team });
    };
    const bombSystem: BombSystem = createBombSystem({
      groundAt: (x, z, fromY, maxRise) => groundAt(x, z, fromY, maxRise ?? 4),
      onExplode: (at, kind) => {
        if (kind === "smoke") {
          smokeField.spawn(at);
          playSfx("equip", 0.8, -0.5);
          return;
        }
        if (kind === "flash") {
          playSfx("land", 1, 0.6);
          const bang = new THREE.PointLight(0xffffff, 90, 40, 2);
          bang.position.copy(at).add(new THREE.Vector3(0, 1, 0));
          root.add(bang);
          window.setTimeout(() => root.remove(bang), 110);
          shakeRef.current = Math.max(shakeRef.current, 0.35);
          // player blindness scales with distance and whether they were looking at it
          if (human && human.alive) {
            const eye = walkPos.clone().setY(walkPos.y + EYE_HEIGHT);
            const d = eye.distanceTo(at);
            if (d < FLASH_RADIUS && castFirst(eye, at.clone().sub(eye).normalize(), Math.max(0.1, d - 0.4)) === null) {
              const look = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
              const toBang = at.clone().sub(eye).setY(0).normalize();
              const facing = Math.max(0, look.dot(toBang));
              flashRef.current = Math.max(flashRef.current, (1 - d / FLASH_RADIUS) * (0.35 + 0.65 * facing));
            }
          }
          for (const f of fighters) {
            if (!f.alive || f.isHuman || !f.ai) continue;
            const d = f.pos.distanceTo(at);
            if (d > FLASH_RADIUS) continue;
            f.ai.blindLeft = Math.max(f.ai.blindLeft, 3.2 * (1 - d / FLASH_RADIUS));
          }
          return;
        }
        if (kind === "decoy") {
          spawnDecoy(at, human?.team ?? "blue");
          playSfx("equip", 0.7, 0.2);
          return;
        }
        playSfx("land", 1, -0.55);
        playSfx("kill", 0.7, -0.4);
        playSfx("shotgun", 0.9, -0.5);
        shakeRef.current = Math.max(shakeRef.current, 0.7);
        explosionFx.burst(at);
        for (let i = 0; i < 10; i++) {
          spawnImpact(
            at.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 3.4,
              Math.random() * 2.4,
              (Math.random() - 0.5) * 3.4,
            )),
            new THREE.Color(i % 3 === 0 ? 0xfff2c0 : i % 3 === 1 ? 0xff9b3d : 0xff3b12),
          );
        }
        const flash = new THREE.PointLight(0xff8a3c, 40, 26, 2);
        flash.position.copy(at).add(new THREE.Vector3(0, 1, 0));
        root.add(flash);
        window.setTimeout(() => root.remove(flash), 140);
        if (!human) return;
        for (const f of fighters) {
          if (!f.alive) continue;
          // your own blast hurts you and the enemy team, never your squad
          if (f !== human && f.team === human.team) continue;
          const d = f.pos.distanceTo(at);
          if (d > BOMB_RADIUS) continue;
          const falloff = 1 - d / BOMB_RADIUS;
          damage(f, BOMB_DAMAGE * falloff, human);
        }
      },
    });
    scene.add(bombSystem.group);

    /* ---- landing preview while a bomb is held ---- */
    let bombArmed = false;
    let bombAiming = false;
    const arcPoints: THREE.Vector3[] = [];
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(151 * 3), 3));
    const arcLine = new THREE.Line(
      arcGeo,
      new THREE.LineBasicMaterial({ color: 0xffb45c, transparent: true, opacity: 0.9, depthTest: false }),
    );
    arcLine.frustumCulled = false;
    arcLine.renderOrder = 999;
    arcLine.visible = false;
    scene.add(arcLine);
    const landMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.62, 28),
      new THREE.MeshBasicMaterial({ color: 0xffb45c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }),
    );
    landMarker.rotation.x = -Math.PI / 2;
    landMarker.renderOrder = 999;
    landMarker.visible = false;
    scene.add(landMarker);

    const bombOrigin = () => {
      const dir = new THREE.Vector3(
        -Math.sin(yaw) * Math.cos(pitch),
        Math.sin(-pitch),
        -Math.cos(yaw) * Math.cos(pitch),
      ).normalize();
      const from = walkPos.clone().setY(walkPos.y + EYE_HEIGHT - 0.15).addScaledVector(dir, 0.7);
      return { dir, from, speed: grounded ? THROW_SPEED : THROW_SPEED_JUMP };
    };

    const updateBombPreview = () => {
      if (!bombAiming || !human || !human.alive) {
        arcLine.visible = false;
        landMarker.visible = false;
        return;
      }
      const { dir, from, speed } = bombOrigin();
      const { points, landing } = predictBombPath(
        from,
        dir,
        speed,
        (x: number, z: number, fy: number, mr?: number) => groundAt(x, z, fy, mr ?? 4),
        arcPoints,
      );
      const attr = arcGeo.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const n = Math.min(points.length, 151);
      for (let i = 0; i < n; i++) {
        const p = points[i]!;
        arr[i * 3] = p.x;
        arr[i * 3 + 1] = p.y;
        arr[i * 3 + 2] = p.z;
      }
      for (let i = n; i < 151; i++) {
        const p = points[n - 1]!;
        arr[i * 3] = p.x;
        arr[i * 3 + 1] = p.y;
        arr[i * 3 + 2] = p.z;
      }
      attr.needsUpdate = true;
      arcGeo.setDrawRange(0, 151);
      arcGeo.computeBoundingSphere();
      arcLine.visible = true;
      if (landing) {
        landMarker.position.copy(landing).setY(landing.y + 0.06);
        landMarker.visible = true;
      } else {
        landMarker.visible = false;
      }
    };

    /** bomb button: take a bomb in hand (or put it away) */
    const armBomb = () => {
      if (!human || !human.alive || modeRef.current !== "walk") return false;
      bombArmed = !bombArmed;
      if (!bombArmed) {
        bombAiming = false;
        arcLine.visible = false;
        landMarker.visible = false;
      } else {
        playSfx("equip", 0.6, 0.3);
      }
      return bombArmed;
    };

    /** release the fire button while holding a bomb -> throw it */
    const releaseBomb = () => {
      if (!bombArmed || !bombAiming) return;
      bombAiming = false;
      bombArmed = false;
      arcLine.visible = false;
      landMarker.visible = false;
      const { dir, from, speed } = bombOrigin();
      bombSystem.throwBomb(from, dir, speed, grenadeKindRef.current);
      playSfx("equip", 0.7, 0.5);
      onBombThrownRef.current();
    };


    /* ---- character power ---- */
    const powerDef = POWERS[characterRef.current.power];
    const powerFx = createPowerFx(initialQuality === "low" ? 24 : 56);
    scene.add(powerFx.group);
    // projected bubble (Emberveil): stops incoming rounds, follows the player
    const barrierDome = createBarrierDome(initialQuality === "low" ? 2 : 3);
    scene.add(barrierDome.group);
    /** true while the player's bubble is up */
    const barrierUp = () => powerRef.current.active > 0 && powerDef.effects.barrier === true;
    const activatePower = () => {
      const st = powerRef.current;
      if (st.cooldown > 0 || st.active > 0) return;
      if (!human || !human.alive) return;
      if (matchRef.current.phase === "countdown") return;
      st.active = powerDef.duration;
      st.cooldown = powerDef.cooldown;
      st.shield = powerDef.effects.shield ?? 0;
      if (powerDef.effects.instantReload) {
        const id = weaponRef.current;
        const cur = ammoRef.current[id];
        if (cur) {
          const mag = getMagazine(id);
          const need = Math.min(mag - cur.mag, cur.reserve);
          if (need > 0) {
            setAmmo((prev) => {
              const slot = prev[id];
              if (!slot) return prev;
              return { ...prev, [id]: { mag: slot.mag + need, reserve: slot.reserve - need } };
            });
          }
        }
        isReloadingRef.current = false;
        reloadingWeaponRef.current = null;
        reloadTimerRef.current = 0;
        setIsReloading(false);
      }
      powerFx.activate(powerDef.color, powerDef.duration);
      if (powerDef.effects.barrier) barrierDome.activate(powerDef.duration);
      shakeRef.current = Math.max(shakeRef.current, 0.16);
      playSfx("equip", 1, 0.25);
      setPowerHud({ active: st.active, cooldown: st.cooldown, shield: st.shield });
    };
    activatePowerRef.current = activatePower;

    const placePing = (kind?: PingKind) => {
      if (!human || !human.alive) return;
      const k = kind ?? currentPingKind;
      camera.getWorldDirection(camFwd);
      const far = 120;
      const hit = castFirst(camera.position, camFwd, far);
      const pos = new THREE.Vector3();
      if (hit) {
        pos.copy(hit.point);
      } else {
        pos.copy(camera.position).add(camFwd.clone().multiplyScalar(far));
      }
      const ground = castFirst(new THREE.Vector3(pos.x, pos.y + 3, pos.z), down, 8);
      if (ground) pos.y = ground.point.y;
      const ping = createPingMarker(k, pos, human.team);
      pingGroup.add(ping.mesh);
      pings.push(ping);
      playSfx("equip", 0.55, 0.75);
      if (!kind) {
        currentPingKind = nextPingKind(currentPingKind);
      }
      currentPingKindRef.current = currentPingKind;
    };
    placePingRef.current = placePing;
    cyclePingKindRef.current = () => {
      currentPingKind = nextPingKind(currentPingKind);
      currentPingKindRef.current = currentPingKind;
    };

    actionsRef.current = { triggerDown, triggerUp, toggleAds, jump, startHeal, cancelHeal: endHeal, armBomb, wallButton, cancelWall: cancelPlacement };

    /* ---- touch look-drag: aiming without a mouse ---- */
    let touchLookId: number | null = null;
    let touchLastX = 0;
    let touchLastY = 0;
    /** every pointer currently down anywhere in the page */
    const activePointers = new Set<number>();
    const trackDown = (e: PointerEvent) => activePointers.add(e.pointerId);
    const trackUp = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      // if the finger that owned look-around is gone, release the slot
      if (touchLookId !== null && !activePointers.has(touchLookId)) touchLookId = null;
    };
    const onTouchLookStart = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || modeRef.current !== "walk") return;
      // a stale id (its pointerup was swallowed by an overlay or a frame hitch)
      // must never block aiming — reclaim it
      if (touchLookId !== null && !activePointers.has(touchLookId)) touchLookId = null;
      if (touchLookId !== null) return;
      touchLookId = e.pointerId;
      // keep receiving moves even if the finger slides over HUD overlays
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      touchLastX = e.clientX;
      touchLastY = e.clientY;
      if (!sfxInitializedRef.current) {
        initSfx();
        sfxInitializedRef.current = true;
        setSfxReady(true);
      }
    };
    const onTouchLookEnd = (e: PointerEvent) => {
      if (touchLookId === e.pointerId) touchLookId = null;
    };
    // Safety net: if a touch is swallowed (capture lost during a frame hitch,
    // gesture cancel, overlay churn) the look pointer could stay latched and
    // aiming would die until reload. Clear it whenever no fingers remain.
    const onLostLookCapture = (e: PointerEvent) => {
      if (touchLookId === e.pointerId) touchLookId = null;
    };
    const onAnyTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        touchLookId = null;
        activePointers.clear();
        // no fingers left: the trigger can never legitimately still be held
        mouseHeldRef.current = false;
      }
    };
    // If a drag on the canvas has no look owner (its pointerdown was swallowed,
    // or the browser cancelled the gesture mid-drag), adopt it so aiming
    // recovers instantly instead of dying until the next reload.
    const onCanvasPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || modeRef.current !== "walk") return;
      if (touchLookId !== null) return;
      touchLookId = e.pointerId;
      activePointers.add(e.pointerId);
      touchLastX = e.clientX;
      touchLastY = e.clientY;
    };




    const onPointerMove = (e: PointerEvent) => {
      if (touchLookId === e.pointerId) {
        const cfg = settingsRef.current;
        const dx = e.clientX - touchLastX;
        const dy = e.clientY - touchLastY;
        const sens = cfg.touchSensitivity * (adsRef.current ? cfg.adsMultiplier : 1) * aimHeaviness();
        const inv = cfg.invertY ? -1 : 1;
        noteManualAim(dx, dy);
        yaw -= dx * sens;
        // camera forward is the negated dir vector, so dragging down (+clientY)
        // must increase pitch for the view to actually tilt down
        pitch = Math.max(-1.2, Math.min(1.2, pitch + dy * sens * inv));
        touchLastX = e.clientX;
        touchLastY = e.clientY;
        return;
      }
      if (modeRef.current === "walk") {
        if (document.pointerLockElement !== renderer.domElement) return;
        const cfg = settingsRef.current;
        const sens = cfg.mouseSensitivity * (adsRef.current ? cfg.adsMultiplier : 1) * aimHeaviness();
        const inv = cfg.invertY ? -1 : 1;
        noteManualAim(e.movementX, e.movementY);
        yaw -= e.movementX * sens;
        pitch = Math.max(-1.2, Math.min(1.2, pitch + e.movementY * sens * inv));
        return;
      }
      if (!dragging) return;
      theta -= (e.clientX - lastX) * 0.005;
      phi = Math.max(0.15, Math.min(1.45, phi - (e.clientY - lastY) * 0.005));
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onWheel = (e: WheelEvent) => {
      if (modeRef.current !== "orbit") return;
      e.preventDefault();
      radius = Math.max(20, Math.min(420, radius + e.deltaY * 0.25));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && modeRef.current === "walk") e.preventDefault();
      // ` releases / re-grabs the mouse without pausing, F9 toggles collision wireframes
      if (e.code === "Backquote") {
        e.preventDefault();
        toggleCursorRef.current();
        return;
      }
      if (e.code === "F9") {
        e.preventDefault();
        toggleCollisionDebugRef.current();
        return;
      }
      keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);

    renderer.domElement.addEventListener("pointerdown", onTouchLookStart);
    renderer.domElement.addEventListener("pointermove", onCanvasPointerMove);

    window.addEventListener("pointerdown", trackDown, true);
    window.addEventListener("pointerup", trackUp, true);
    window.addEventListener("pointercancel", trackUp, true);
    window.addEventListener("pointerup", onTouchLookEnd);
    window.addEventListener("pointercancel", onTouchLookEnd);
    renderer.domElement.addEventListener("lostpointercapture", onLostLookCapture);
    window.addEventListener("touchend", onAnyTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onAnyTouchEnd, { passive: true });

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      if (locked && freeCursorRef.current) {
        freeCursorRef.current = false;
        setCursorFree(false);
      }
      // a deliberate cursor release keeps the match running — don't pause
      if (freeCursorRef.current) return;
      if (modeRef.current === "walk" && !locked && matchRef.current.phase === "round" && !settingsOpenRef.current) {
        setPaused(true);
        suspendSfx();
      }
    };
    document.addEventListener("pointerlockchange", onPointerLockChange);

    const onFullscreenChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    // Only while fullscreen may we swallow browser-reserved combos; outside of
    // it the player must keep normal tab control (CrazyGames restricted keys).
    const onReservedKey = (e: KeyboardEvent) => {
      if (!document.fullscreenElement) return;
      if ((e.ctrlKey || e.metaKey) && (e.code === "KeyW" || e.code === "KeyT" || e.code === "KeyN")) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onReservedKey, { capture: true });



    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(pixelRatio());
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    const activeMap = ARENA_MAPS[mapIdRef.current];

    /**
     * Daytime sky dome. The 4v4 outpost is an open outdoor map with baked
     * lighting, so a painted sky + matching haze makes it read much brighter
     * without touching the light rig (one extra unlit draw call).
     */
    const bootNum = (v: unknown, fallback: number) =>
      typeof v === "number" && Number.isFinite(v) ? v : fallback;
    const skyBrightness = bootNum(bootSettings.skyBrightness, 1.12);
    const fogIntensity = bootNum(bootSettings.fogIntensity, 0.85);
    const cloudMotion = bootNum(bootSettings.cloudMotion, 1);
    const groundBrightness = bootNum(bootSettings.groundBrightness, 1.25);

    const skyBrightnessRef = { current: skyBrightness };
    const fogIntensityRef = { current: fogIntensity };
    const WET_HORIZON = new THREE.Color(0x8f9aa6);
    let weatherWet = 0;

    let skybox: Skybox | null = null;
    let weather: Weather | null = null;
    let weatherApply: ((flash: number, wet: number) => void) | null = null;
    if (activeMap.id === "outpost") {
      skybox = addDaySkybox(scene, {
        radius: 900,
        textureSize: initialQuality === "low" ? 1024 : 2048,
        brightness: skyBrightness,
        cloudMotion: cloudMotion,
      });
      scene.background = null;
      renderer.setClearColor(DAY_HORIZON, 1);
      const fogNear = initialQuality === "low" ? 150 : 200;
      const fogFar = initialQuality === "low" ? 480 : 700;
      const dayFog = new THREE.Fog(DAY_HORIZON, fogNear, fogFar);
      scene.fog = dayFog;

      /**
       * Live atmosphere tuning from the settings panel — sky exposure, haze
       * strength and cloud drift all apply instantly, no reload needed.
       */
      applyAtmosphereRef.current = (sky, fog, clouds) => {
        skyBrightnessRef.current = sky;
        fogIntensityRef.current = fog;
        skybox?.setBrightness(sky);
        skybox?.setCloudMotion(clouds);
        if (fog <= 0.02) {
          scene.fog = null;
          return;
        }
        scene.fog = dayFog;
        // more intensity = haze starts sooner and closes in faster
        dayFog.near = fogNear / Math.max(0.35, fog);
        dayFog.far = fogFar / Math.max(0.35, fog);
      };
      applyAtmosphereRef.current(skyBrightness, fogIntensity, cloudMotion);

      /**
       * Weather. Rain/snow are GPU-only (see weather.ts) and roll in on their
       * own timer, so most of a match is clear and costs nothing. Lightning
       * reuses the existing sky/fog uniforms for the flash — no extra lights,
       * no material recompiles.
       */
      weather = createWeather(scene, initialQuality, {
        onKind: (k) => {
          if (k === "clear") stopWeatherAmbience();
          else setWeatherAmbience(k, k === "rain" ? 0.32 : 0.16);
        },
        onThunder: (delay) => playThunder(delay, 0.65),
      });
      weatherApply = (flash, wet) => {
        // darker, hazier sky while it pours; lightning briefly blows it out
        const sky = skyBrightnessRef.current * (1 - wet * 0.32) + flash * 0.9;
        skybox?.setBrightness(sky);
        const fogMul = 1 + wet * 0.45;
        const f = Math.max(0.35, fogIntensityRef.current) * fogMul;
        if (scene.fog === dayFog) {
          dayFog.near = fogNear / f;
          dayFog.far = fogFar / f;
          dayFog.color.setHex(DAY_HORIZON).lerp(WET_HORIZON, wet * 0.7).addScalar(flash * 0.25);
        }
      };
    }

    let boundsMinX = activeMap.bounds?.minX ?? -200;
    let boundsMaxX = activeMap.bounds?.maxX ?? 200;
    let boundsMinZ = activeMap.bounds?.minZ ?? -200;
    let boundsMaxZ = activeMap.bounds?.maxZ ?? 200;
    // Extra hand-authored hard limit (4v4 Timber Outpost only). It sits on top
    // of the bounds box above and can never be crossed at any speed or height.
    const hardBarrier = activeMap.id === "outpost" ? OUTPOST_BARRIER : null;
    let disposed = false;

    // The arena GLB ships meshopt-compressed geometry and KTX2/ETC1S textures,
    // so both decoders have to be attached before loading.
    const ktx2Loader = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer);
    const loader = new GLTFLoader();
    loader.setKTX2Loader(ktx2Loader);
    loader.setMeshoptDecoder(MeshoptDecoder);
    /**
     * Optional collision proxy: a simplified, texture-free clone of the level.
     * It is never added to the scene (so nothing extra is drawn) but it is
     * transformed exactly like the visual model, so raycasts against it line
     * up with what the player sees — at a fraction of the triangle count.
     */
    let collisionRoot: THREE.Object3D | null = null;
    const loadCollision = () =>
      new Promise<void>((resolve) => {
        if (!activeMap.collisionUrl) return resolve();
        const cl = new GLTFLoader();
        cl.setMeshoptDecoder(MeshoptDecoder);
        cl.load(
          activeMap.collisionUrl,
          (g) => {
            const proxy = g.scene;
            if (activeMap.scale !== 1) proxy.scale.setScalar(activeMap.scale);
            proxy.position.set(activeMap.offsetX, activeMap.yOffset, activeMap.offsetZ);
            proxy.updateMatrixWorld(true);
            collisionRoot = proxy;
            resolve();
          },
          undefined,
          () => resolve(),
        );
      });

    const loadLevel = () => loader.load(
      activeMap.url,
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        if (activeMap.scale !== 1) model.scale.setScalar(activeMap.scale);
        model.position.set(activeMap.offsetX, activeMap.yOffset, activeMap.offsetZ);
        model.updateMatrixWorld(true);
        const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            // The level is static: it only receives shadows. Letting every one
            // of its ~880k verts cast into the shadow map every frame was the
            // single biggest source of stutter.
            m.castShadow = false;
            m.receiveShadow = true;
            // Compressed (KTX2) textures ship without anisotropic filtering, so
            // floors/walls smear at grazing angles — restore crisp sampling.
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) {
              const std = mat as THREE.MeshStandardMaterial;
              for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"] as const) {

                const tex = std?.[key] as THREE.Texture | null | undefined;
                if (tex) {
                  tex.anisotropy = maxAniso;
                  tex.magFilter = THREE.LinearFilter;
                  tex.minFilter = THREE.LinearMipmapLinearFilter;
                  tex.needsUpdate = true;
                }
              }
            }
          }
        });

        // Fold sky, sun and ambient occlusion into vertex colours once, then
        // draw the whole level unlit. Runs behind the deploy splash.
        if (bakedLight) {
          // `groundBrightness` folds extra bounce/ambient light into the bake so
          // the floor of the outdoor map stops reading as dark under the new sky.
          const gb = groundBrightness;
          bakeVertexLighting(model, {
            sunDirection: sun.position.clone().negate(),
            sunColor: 0xffd9a0,
            sunIntensity: 0.9 * Math.min(1.3, gb),
            skyColor: 0x9fc6ff,
            // warmer, lighter bounce colour scaled by the ground slider
            groundColor: new THREE.Color(0x6f6255).multiplyScalar(Math.min(1.6, 1.18 * gb)),
            ambient: Math.min(1.1, 0.66 * gb),
            // less contact darkening on the floor
            aoFloor: Math.min(0.7, 0.36 * gb),
          });
        }

        root.add(model);

        // Collide against the simplified proxy when the map ships one, else
        // fall back to the rendered geometry. Everything static is baked into a
        // single BVH-indexed mesh so a probe only touches the triangles along
        // its own ray instead of every collider in the level.
        const colliders: THREE.Mesh[] = [];
        (collisionRoot ?? model).traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry) colliders.push(m);
        });
        collisionTiles = buildCollisionTiles(collisionRoot ?? model, {
          tileSize: 32,
          // pad the authored box so edge geometry (now reachable) still collides
          bounds: activeMap.bounds
            ? {
                minX: activeMap.bounds.minX - 40,
                maxX: activeMap.bounds.maxX + 40,
                minZ: activeMap.bounds.minZ - 40,
                maxZ: activeMap.bounds.maxZ + 40,
              }
            : null,
          regions: 2,
        });

        nearX = Infinity;
        nearZ = Infinity;
        nearFx = 0;
        nearFz = 0;

        if (collisionTiles.length > 0) {
          collidersRef.current = collisionTiles.map((t) => t.mesh);
          // Index the rest of the level during idle time so no frame — and no
          // queued mouse/key event behind it — ever waits on a BVH build.
          cancelWarm?.();
          cancelWarm = warmTiles(collisionTiles);
        } else {
          const staticCollider = buildMergedCollider(collisionRoot ?? model);
          collidersRef.current = staticCollider ? [staticCollider] : colliders;
        }


        // Real walkable footprint: the authored bounds box was hand-tuned and
        // sits well inside the actual ground, which fenced off ~10% of the map
        // on every side. Measure the ground/geometry extent from the level
        // itself (vertices near play height) and use that as the hard barrier.
        let fpMinX = Infinity;
        let fpMaxX = -Infinity;
        let fpMinZ = Infinity;
        let fpMaxZ = -Infinity;
        {
          const v = new THREE.Vector3();
          for (const m of colliders) {
            const pos = m.geometry.getAttribute("position");
            if (!pos) continue;
            m.updateWorldMatrix(true, false);
            const step = pos.count > 60000 ? 3 : 1;
            for (let i = 0; i < pos.count; i += step) {
              v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(m.matrixWorld);
              if (v.y < -5 || v.y > 12) continue; // ignore skybox / roofs / pits
              if (v.x < fpMinX) fpMinX = v.x;
              if (v.x > fpMaxX) fpMaxX = v.x;
              if (v.z < fpMinZ) fpMinZ = v.z;
              if (v.z > fpMaxZ) fpMaxZ = v.z;
            }
          }
        }
        const footprintOk =
          Number.isFinite(fpMinX) && fpMaxX - fpMinX > 10 && fpMaxZ - fpMinZ > 10;
        if (footprintOk) {
          const INSET = 1.5; // stop just short of the ground edge
          boundsMinX = fpMinX + INSET;
          boundsMaxX = fpMaxX - INSET;
          boundsMinZ = fpMinZ + INSET;
          boundsMaxZ = fpMaxZ - INSET;
        }

        // Radar footprint: sample every vertex of the level between knee and
        // roof height into a top-down occupancy grid. The GLB batches whole
        // areas into single meshes, so per-mesh bounds are useless here.
        {
          const RES = 128;
          const EXT = footprintOk
            ? Math.max(Math.abs(boundsMinX), Math.abs(boundsMaxX), Math.abs(boundsMinZ), Math.abs(boundsMaxZ))
            : activeMap.bounds
              ? Math.max(
                  Math.abs(activeMap.bounds.minX),
                  Math.abs(activeMap.bounds.maxX),
                  Math.abs(activeMap.bounds.minZ),
                  Math.abs(activeMap.bounds.maxZ),
                )
              : 78;
          const cells = new Uint8Array(RES * RES);
          const v = new THREE.Vector3();
          for (const m of colliders) {
            const pos = m.geometry.getAttribute("position");
            if (!pos) continue;
            m.updateWorldMatrix(true, false);
            const step = pos.count > 60000 ? 3 : 1;
            for (let i = 0; i < pos.count; i += step) {
              v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(m.matrixWorld);
              if (v.y < 0.5 || v.y > 9) continue; // skip floors, roofs, sky
              const gx = Math.floor(((v.x + EXT) / (EXT * 2)) * RES);
              const gz = Math.floor(((v.z + EXT) / (EXT * 2)) * RES);
              if (gx < 0 || gz < 0 || gx >= RES || gz >= RES) continue;
              const idx = gz * RES + gx;
              const cur = cells[idx] ?? 0;
              if (cur < 255) cells[idx] = cur + 1;
            }
          }
          mapGridRef.current = { cells, res: RES, extent: EXT };
        }


        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        if (!activeMap.bounds && !footprintOk) {
          const lim = Math.max(size.x, size.z) / 2 - 2;
          boundsMinX = -lim;
          boundsMaxX = lim;
          boundsMinZ = -lim;
          boundsMaxZ = lim;
        }
        if (activeMap.bounds || footprintOk) {

          radius = Math.max(boundsMaxX - boundsMinX, boundsMaxZ - boundsMinZ) * 0.8;
          target.set((boundsMinX + boundsMaxX) / 2, 6, (boundsMinZ + boundsMaxZ) / 2);
        } else {
          radius = Math.max(size.x, size.z) * 1.15;
          target.set(0, size.y * 0.15, 0);
        }

        // ---- spawn spots come from the active map definition ----
        // one fighter per spot, standing in the middle of its own pad
        const points: SpawnPoint[] = activeMap.spawns.map((s) => {
          const top = new THREE.Vector3(s.x, s.y, s.z);
          if (activeMap.snapToGround) {
            const gy = groundAt(s.x, s.z, s.y + 0.5, 1.0);
            if (gy != null) top.y = gy;
          }
          return { name: s.name, team: s.team as Team, top };
        });

        const bluePads = points.filter((p) => p.team === "blue");
        const redPads = points.filter((p) => p.team === "red");




        const makeTracer = () => {
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(),
            new THREE.Vector3(),
          ]);
          const mat = new THREE.LineBasicMaterial({ color: 0xff9d5c, transparent: true, opacity: 0 });
          const line = new THREE.Line(geo, mat);
          line.frustumCulled = false;
          root.add(line);
          return { line, mat, ttl: 0 };
        };

        const addFighter = (team: Team, index: number, isHuman: boolean) => {
          const pads = team === "blue" ? bluePads : redPads;
          // one fighter per pad; if a team has fewer pads than fighters, stand
          // side by side around the shared pad instead of inside each other
          const pad = pads[index % pads.length]!;
          const overflow = Math.floor(index / pads.length);
          const home: SpawnPoint =
            overflow === 0
              ? pad
              : {
                  ...pad,
                  top: pad.top
                    .clone()
                    .add(
                      new THREE.Vector3(
                        Math.cos(overflow * 2.2) * 2.6,
                        0,
                        Math.sin(overflow * 2.2) * 2.6,
                      ),
                    ),
                };
          const id = `${team.toUpperCase()}_${index + 1}`;
          const weapon = isHuman ? "deagle" : team === "blue" ? "ak47" : index === 0 ? "m4a1" : "ump";
          const rawSidearm = slots[2];
          const sidearm: string = (isHuman
            ? (typeof rawSidearm === "string" && ["pan", "bat", "katana", "knife", "fists"].includes(rawSidearm)
                ? rawSidearm
                : "fists")
            : Math.random() < 0.25
              ? (["pan", "bat", "katana"] as const)[Math.floor(Math.random() * 3)]
              : "knife") as string;
          const f: Fighter = {
            id,
            team,
            isHuman,
            group: null,
            meshes: [],
            hp: MAX_HP,
            alive: true,
            respawnIn: 0,
            home,
            pos: home.top.clone(),
            cooldown: 0.8 + Math.random() * 1.2,
            tracer: null,
            fx: null,
            weapon,
            sidearm,
            ai: isHuman
              ? null
              : createBotBrain(
                  settingsRef.current.botDifficulty,
                  preferredRangeFor((() => {
                    const w = getWeapon(weapon);
                    return w ? getWeaponRange(w) : 120;
                  })()),
                ),
            armor: emptyArmor(),
            backpack: defaultBackpack(isHuman && profileRef.current?.loadout.tactical === "legPockets" ? 2 : 1),
          };
          // personal spawn effect, sitting on this fighter's own spot
          const fx = createSpawnFx(team === "blue" ? "water" : "fire", home.top, initialQuality);
          root.add(fx.group);
          fxList.push(fx);
          f.fx = fx;
          if (!isHuman) {
            const built = buildBot(team, id);
            built.group.position.copy(f.pos);
            root.add(built.group);
            f.group = built.group;
            f.meshes = built.meshes;
            f.tracer = makeTracer();
          }
          fighters.push(f);
          return f;
        };

        // you + (teamSize - 1) friendly bots vs teamSize enemy bots
        human = addFighter("blue", 0, true);
        if (profileRef.current?.loadout.tactical === "armorCrate") {
          const vestLevel = rollArmorLevel();
          const helmetLevel = rollArmorLevel();
          equipArmor(human.armor, "vest", vestLevel);
          equipArmor(human.armor, "helmet", helmetLevel);
          setArmor(human.armor);
          armorRef.current = human.armor;
          playSfx("equip", 0.75, 0.85);
        }
        humanBody = buildBot("blue", "YOU");
        humanBody.group.position.copy(human.pos);
        humanBody.group.visible = false;
        root.add(humanBody.group);

        for (let i = 1; i < activeMap.teamSize; i += 1) addFighter("blue", i, false);
        for (let i = 0; i < activeMap.teamSize; i += 1) addFighter("red", i, false);

        {
          // one shared cage covering the whole friendly spawn pad, not one box per player
          const blueHomes = fighters.filter((f) => f.team === "blue").map((f) => f.home.top);
          const bb = new THREE.Box3();
          for (const p of blueHomes) bb.expandByPoint(p);
          bb.expandByScalar(SPAWN_BOX_HALF);
          const center = bb.getCenter(new THREE.Vector3());
          center.y = human.home.top.y;
          const halfX = Math.max(SPAWN_BOX_HALF, (bb.max.x - bb.min.x) / 2);
          const halfZ = Math.max(SPAWN_BOX_HALF, (bb.max.z - bb.min.z) / 2);

          const cage = new THREE.Group();
          const box = new THREE.Mesh(
            new THREE.BoxGeometry(halfX * 2, SPAWN_BOX_HEIGHT, halfZ * 2),
            new THREE.MeshBasicMaterial({
              color: 0x3f8fff,
              transparent: true,
              opacity: 0.08,
              side: THREE.BackSide,
              depthWrite: false,
            }),
          );
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(box.geometry),
            new THREE.LineBasicMaterial({ color: 0x9ecbff, transparent: true, opacity: 0.6 }),
          );
          cage.add(box, edges);
          cage.position.copy(center).add(new THREE.Vector3(0, SPAWN_BOX_HEIGHT / 2, 0));
          cage.visible = false;
          root.add(cage);
          spawnCageRef.current = { mesh: cage, center, halfX, halfZ };
        }


        // the match waits for the player to dismiss the onboarding overlay;
        // enterWalk (the "Enter arena" button) kicks off startMatch.

        // pad key light
        for (const p of points) {
          const spot = new THREE.PointLight(TEAM_COLORS[p.team], 12, 20, 2);
          spot.position.copy(p.top).add(new THREE.Vector3(0, 6, 0));
          root.add(spot);
        }

        clipPlane.constant = box.min.y + size.y * 0.78;
        renderer.clippingPlanes = showRoofRef.current ? [] : [clipPlane];
        clipRef.current = { renderer, plane: clipPlane };

        // ---- real minimap: one orthographic top-down render with the roof clipped ----
        try {
          const RT = 512;
          const EXT = 80; // must match ARENA_EXTENT in Minimap
          const topCam = new THREE.OrthographicCamera(-EXT, EXT, EXT, -EXT, 0.1, 600);
          topCam.up.set(0, 0, -1);
          topCam.position.set(0, 300, 0);
          topCam.lookAt(0, 0, 0);
          const rt = new THREE.WebGLRenderTarget(RT, RT);
          const prevPlanes = renderer.clippingPlanes;
          renderer.clippingPlanes = [clipPlane];
          renderer.setRenderTarget(rt);
          renderer.render(scene, topCam);
          renderer.setRenderTarget(null);
          renderer.clippingPlanes = prevPlanes;

          const buf = new Uint8Array(RT * RT * 4);
          renderer.readRenderTargetPixels(rt, 0, 0, RT, RT, buf);
          const cv = document.createElement("canvas");
          cv.width = cv.height = RT;
          const cx = cv.getContext("2d");
          if (cx) {
            const img = cx.createImageData(RT, RT);
            for (let y = 0; y < RT; y++) {
              const srcRow = (RT - 1 - y) * RT * 4; // GL reads bottom-up
              const dstRow = y * RT * 4;
              img.data.set(buf.subarray(srcRow, srcRow + RT * 4), dstRow);
            }
            cx.putImageData(img, 0, 0);
            mapImageRef.current = cv.toDataURL("image/png");
          }
          rt.dispose();
        } catch {
          // fall back to the occupancy grid minimap
        }

        syncHud();
        setStatus("");
      },
      (e) => {
        if (e.total) {
          const pct = e.loaded / e.total;
          setMapLoadProgress(pct);
          setStatus(`Loading map… ${Math.round(pct * 100)}%`);
        }
      },
      (err) => {
        console.error("[arena] map load failed", err);
        setStatus("Failed to load the map file.");
        setMapLoadProgress(0);
      },
    );

    void loadCollision().then(() => {
      if (!disposed) loadLevel();
    });

    let raf = 0;
    let last = performance.now();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();

    // Bots barely move, so re-probing the ground under every one of them on
    // every frame is pure waste — refresh each ~4 Hz (or when they teleport).
    const botGroundTimers = new Map<string, number>();
    /**
     * Collision-aware bot step: tries the full move, then each axis alone so
     * bots slide along walls instead of sticking to them.
     */
    const moveBot = (f: Fighter, dx: number, dz: number) => {
      if (!dx && !dz) return;
      const tryStep = (ax: number, az: number) => {
        const nx = f.pos.x + ax;
        const nz = f.pos.z + az;
        const eye = new THREE.Vector3(f.pos.x, f.pos.y + 1.0, f.pos.z);
        const dir = new THREE.Vector3(ax, 0, az);
        const len = dir.length();
        if (len < 1e-4) return false;
        dir.divideScalar(len);
        if (castFirst(eye, dir, len + PLAYER_RADIUS) !== null) return false;
        const gy = groundAt(nx, nz, f.pos.y + 0.6, STEP_UP + 0.5);
        if (gy === null || Math.abs(gy - f.pos.y) > STEP_UP + 0.5) return false;
        f.pos.set(nx, gy, nz);
        return true;
      };
      if (tryStep(dx, dz)) return;
      if (tryStep(dx, 0)) return;
      tryStep(0, dz);
    };

    const botTick = (f: Fighter, dt: number) => {
      if (!f.group) return;
      if (matchRef.current.phase !== "round") return;
      if (!f.alive) {
        f.respawnIn -= dt;
        if (f.respawnIn <= 0) respawn(f);
        return;
      }

      const brain = f.ai;
      if (!brain) return;
      const prof = BOT_PROFILES[brain.difficulty];
      if (brain.blindLeft > 0) brain.blindLeft -= dt;

      // keep bots planted on the ground
      const nextProbe = (botGroundTimers.get(f.id) ?? 0) - dt;
      if (nextProbe <= 0) {
        botGroundTimers.set(f.id, 0.25);
        const gy = groundAt(f.pos.x, f.pos.z, f.pos.y + 0.5, 1.0);
        if (gy !== null) f.pos.y = gy;
      } else {
        botGroundTimers.set(f.id, nextProbe);
      }

      // ---- decoy bait timer
      if (brain.decoyAttractLeft > 0) brain.decoyAttractLeft -= dt;
      if (brain.decoyAttractLeft <= 0) brain.decoyAttract = null;

      // ---- target selection: nearest living enemy, sticky to the current one
      let bestTarget: Fighter | null = null;
      let bestDist = Infinity;
      for (const other of fighters) {
        if (other.team === f.team || !other.alive) continue;
        const p = other.isHuman ? walkPos : other.pos;
        let d = p.distanceTo(f.pos);
        // hysteresis so bots do not flip-flop between two equidistant enemies
        if (other.id === brain.targetId) d *= 0.75;
        if (d < bestDist) {
          bestDist = d;
          bestTarget = other;
        }
      }

      // enemy decoys draw bots that can hear them; closer/smarter bots fall for it longer
      if (bestDist > 18) {
        for (const d of decoys) {
          if (d.team === f.team) continue;
          const distToDecoy = d.root.position.distanceTo(f.pos);
          if (distToDecoy < 55 && Math.random() < 0.35) {
            attractToDecoy(brain, d.root.position, 2.5 + Math.random() * 2);
            break;
          }
        }
      }

      if (!bestTarget) {
        brain.state = "hunt";
        brain.targetId = null;
        if (brain.decoyAttract) {
          const goal = brain.decoyAttract;
          const away = goal.clone().sub(f.pos);
          away.y = 0;
          if (away.length() > 2.5) {
            away.normalize();
            moveBot(f, away.x * prof.moveSpeed * 0.8 * dt, away.z * prof.moveSpeed * 0.8 * dt);
          }
        }
        f.group.position.copy(f.pos);
        return;
      }

      if (bestTarget.id !== brain.targetId) {
        brain.targetId = bestTarget.id;
        brain.reactionLeft = prof.reaction * (0.8 + Math.random() * 0.5);
        brain.burstLeft = rollBurst(prof);
        brain.pauseLeft = 0;
        brain.losClear = false;
        brain.losTimer = 0;
      }

      const targetPos = (bestTarget.isHuman ? walkPos : bestTarget.pos).clone();
      const aim = targetPos.clone().setY(targetPos.y + 1.3);
      const eye = f.pos.clone().setY(f.pos.y + 1.3);
      const toTarget = aim.clone().sub(eye);
      const dist = toTarget.length();
      const dir = toTarget.clone().normalize();

      // ---- line of sight, re-probed a few times a second instead of per frame
      brain.losTimer -= dt;
      if (brain.losTimer <= 0) {
        brain.losTimer = 0.12 + Math.random() * 0.08;
        brain.losClear =
          castFirst(eye, dir, Math.max(0.1, dist - 0.4)) === null && !smokeField.blocks(eye, aim);
        if (brain.losClear) {
          brain.lastSeen = targetPos.clone();
        }
      }
      const visible = brain.losClear;

      // ---- state machine
      const hurt = f.hp <= MAX_HP * prof.retreatHp;
      if (hurt && visible && dist < brain.preferredRange * 0.8) brain.state = "retreat";
      else if (visible) brain.state = dist > brain.preferredRange * 1.4 ? "reposition" : "engage";
      else brain.state = "hunt";

      // ---- face the target (or the last place it was seen)
      const facePoint = visible ? targetPos : (brain.lastSeen ?? targetPos);
      const faceDelta = facePoint.clone().sub(f.pos);
      const wantYaw = Math.atan2(faceDelta.x, faceDelta.z) + Math.PI;
      const yawDelta = ((wantYaw - f.group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      f.group.rotation.y += yawDelta * Math.min(1, prof.tracking * 6 * dt * 10);

      // ---- movement
      const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
      const side = new THREE.Vector3(-flat.z, 0, flat.x);
      brain.strafeLeft -= dt;
      if (brain.strafeLeft <= 0) rerollStrafe(brain);
      brain.moveLeft -= dt;

      let forward = 0;
      let strafe = 0;
      if (brain.state === "engage") {
        // hold the pocket: nudge in or out, strafe across the duel
        const gap = dist - brain.preferredRange;
        forward = Math.abs(gap) > 4 ? Math.sign(gap) * 0.5 * prof.aggression : 0;
        strafe = brain.strafeDir * prof.strafe;
      } else if (brain.state === "reposition") {
        forward = prof.aggression;
        strafe = brain.strafeDir * prof.strafe * 0.4;
      } else if (brain.state === "retreat") {
        forward = -0.9;
        strafe = brain.strafeDir * prof.strafe * 0.8;
      } else {
        // hunt: walk to the last known position or a decoy bait, then wander around it
        const goal = brain.decoyAttract ?? brain.lastSeen ?? bestTarget.home.top;
        const away = goal.clone().sub(f.pos);
        away.y = 0;
        if (away.length() > 2.5) {
          away.normalize();
          moveBot(f, away.x * prof.moveSpeed * 0.9 * dt, away.z * prof.moveSpeed * 0.9 * dt);
        } else if (brain.moveLeft <= 0) {
          brain.moveLeft = 0.8 + Math.random() * 1.4;
          rerollStrafe(brain);
        } else {
          moveBot(
            f,
            side.x * brain.strafeDir * prof.moveSpeed * 0.5 * dt,
            side.z * brain.strafeDir * prof.moveSpeed * 0.5 * dt,
          );
        }
      }

      if (brain.state !== "hunt" && (forward || strafe)) {
        const step = prof.moveSpeed * dt;
        moveBot(
          f,
          (flat.x * forward + side.x * strafe) * step,
          (flat.z * forward + side.z * strafe) * step,
        );
      }

      f.group.position.copy(f.pos);

      const bw = getWeapon(f.weapon);
      const botRange = bw ? getWeaponRange(bw) : 120;
      const botInterval = bw ? getWeaponFireInterval(bw) : 0.65;
      const botWeaponName = bw?.name ?? "Rifle";

      // ---- firing discipline: reaction delay, bursts, pauses
      if (brain.blindLeft > 0) {
        // flashed: stumble, hold fire
        brain.reactionLeft = Math.max(brain.reactionLeft, prof.reaction);
        return;
      }
      if (!visible || dist > botRange) {
        brain.reactionLeft = Math.min(brain.reactionLeft + dt * 0.5, prof.reaction);
        return;
      }
      if (brain.reactionLeft > 0) {
        brain.reactionLeft -= dt;
        return;
      }
      if (brain.pauseLeft > 0) {
        brain.pauseLeft -= dt;
        return;
      }

      f.cooldown -= dt;
      if (f.cooldown > 0) return;
      f.cooldown = botInterval * (0.9 + Math.random() * 0.3);
      brain.burstLeft -= 1;
      if (brain.burstLeft <= 0) {
        brain.burstLeft = rollBurst(prof);
        brain.pauseLeft = rollPause(prof);
      }

      // distant gunfire — attenuated so the arena has depth
      playSfxAt(
        getWeaponBehavior(f.weapon).sound,
        eye.distanceTo(camera.position),
        0.85,
        (Math.random() - 0.5) * 0.05,
      );

      if (f.tracer) {
        const attr = f.tracer.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        // rounds aimed at a shielded player visibly stop on the bubble skin
        const shielded = bestTarget.isHuman && barrierUp();
        const end = shielded
          ? eye.clone().add(dir.clone().multiplyScalar(Math.max(0, dist - barrierDome.radius)))
          : aim;
        arr[0] = eye.x;
        arr[1] = eye.y;
        arr[2] = eye.z;
        arr[3] = end.x;
        arr[4] = end.y;
        arr[5] = end.z;
        attr.needsUpdate = true;
        f.tracer.mat.color.setHex(f.team === "blue" ? 0x8ec5ff : 0xff9d5c);
        f.tracer.mat.opacity = 1;
        f.tracer.ttl = 0.1;
      }

      // accuracy falls off with distance and improves against static targets
      const moving = bestTarget.isHuman ? walkMovingRef.current : brain.state !== "hunt";
      const hitChance = Math.max(
        0.12,
        prof.accuracy - dist / prof.accuracyFalloff - (moving ? 0.12 : 0),
      );
      if (Math.random() < hitChance) {
        const head = Math.random() < prof.headshotChance;
        const amount = BOT_DAMAGE * prof.damageScale * (head ? 2.2 : 1);
        damage(bestTarget, amount, f, head);
        if (!bestTarget.alive) pushKillFeed(f, bestTarget, botWeaponName);
      }
    };

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      let pendingFire = false;

      for (const fx of fxList) fx.update(dt);
      updateWalls(dt);
      bombSystem.update(dt);
      explosionFx.update(dt);
      updateBombPreview();
      const nowSec = now / 1000;
      if (safeZoneRef.current && matchRef.current.phase === "round") {
        updateSafeZone(safeZoneRef.current, nowSec, dt);
        safeZoneVisual.mesh.visible = true;
        safeZoneVisual.mesh.scale.setScalar(safeZoneRef.current.currentRadius);
        for (const f of fighters) {
          if (!f.alive) continue;
          const zoneDmg = damageOutsideZone(safeZoneRef.current, f.pos, dt);
          if (zoneDmg > 0) {
            damage(f, zoneDmg, f); // self-damage from the storm
            if (f.isHuman && f.hp > 0) {
              // brief red vignette handled by damage() already
            }
          }
        }
      } else {
        safeZoneVisual.mesh.visible = false;
      }
      tickMushrooms(dt);
      tickArmorPickups(dt);
      // FF coins: auto-pickup near the player
      if (human && human.alive && ffCoinsRef.current.length > 0) {
        const collected = scanFfCoinPickups(ffCoinsRef.current, human.pos, human.backpack, now);
        if (collected > 0) {
          setFfCoinCount(human.backpack.coins);
          playSfx("equip", 0.5, 1.1);
        }
      }
      // pings: fade and animate
      updatePings(pings, dt);
      // decoys: spin, bark fake shots, expire
      for (let i = decoys.length - 1; i >= 0; i--) {
        const d = decoys[i]!;
        d.ttl -= dt;
        d.nextBark -= dt;
        d.root.rotation.y += dt * 4;
        if (d.nextBark <= 0) {
          d.nextBark = DECOY_BARK_INTERVAL * (0.8 + Math.random() * 0.6);
          playSfxAt("rifle", d.root.position.distanceTo(camera.position), 0.55, (Math.random() - 0.5) * 0.15);
          // small muzzle flash
          const barkLight = new THREE.PointLight(0xffaa55, 6, 5, 1);
          barkLight.position.copy(d.root.position).add(new THREE.Vector3(0, 0.5, 0));
          root.add(barkLight);
          window.setTimeout(() => root.remove(barkLight), 60);
        }
        if (d.ttl <= 0) {
          decoyGroup.remove(d.root);
          decoys.splice(i, 1);
        }
      }
      // EP slowly converts into HP whenever the player is hurt
      if (human && human.alive && epRef.current > 0 && human.hp < MAX_HP) {
        const amount = Math.min(epRef.current, EP_TO_HP_RATE * dt);
        human.hp = Math.min(MAX_HP, human.hp + amount);
        epRef.current -= amount;
        setEp(epRef.current);
        syncHud();
      }
      for (const fx of impactPool) fx.update(dt);

      // character power: tick timers, apply regen, keep the aura on the player
      {
        const st = powerRef.current;
        const wasActive = st.active > 0;
        if (st.active > 0) {
          st.active = Math.max(0, st.active - dt);
          const regen = POWERS[characterRef.current.power].effects.regen ?? 0;
          if (regen > 0 && human && human.alive && human.hp < MAX_HP) {
            human.hp = Math.min(MAX_HP, human.hp + regen * dt);
            syncHud();
          }
          if (st.active === 0) {
            st.shield = 0;
            powerFx.stop();
            barrierDome.stop();
          }
        }
        if (st.cooldown > 0) st.cooldown = Math.max(0, st.cooldown - dt);
        if (human && !human.alive && wasActive) {
          st.active = 0;
          st.shield = 0;
          powerFx.stop();
          barrierDome.stop();
        }
        powerFx.update(dt, human ? human.pos : new THREE.Vector3());
        barrierDome.update(dt, human ? human.pos : new THREE.Vector3());
        const nextHud = {
          active: Math.ceil(st.active),
          cooldown: Math.ceil(st.cooldown),
          shield: Math.round(st.shield),
        };
        setPowerHud((prev) =>
          prev.active === nextHud.active && prev.cooldown === nextHud.cooldown && prev.shield === nextHud.shield
            ? prev
            : nextHud,
        );
      }

      // pre-round countdown
      if (spawnCageRef.current) {
        spawnCageRef.current.mesh.visible =
          matchRef.current.phase === "countdown" && modeRef.current === "walk";
      }

      if (introTime > 0) {
        introTime = Math.max(0, introTime - dt);
        introRef.current = introTime;
        if (introTime <= 0) setIntro(false);
      }

      if (matchRef.current.phase === "countdown" && introTime <= 0) {
        countdownRef.current = Math.max(0, countdownRef.current - dt);
        const rounded = Math.ceil(countdownRef.current);
        if (matchRef.current.countdown !== rounded) {
          matchRef.current.countdown = rounded;
          setMatch({ ...matchRef.current });
        }
        if (countdownRef.current <= 0) {
          matchRef.current.phase = "round";
          matchRef.current.countdown = 0;
          setMatch({ ...matchRef.current });
        }
      }

      // Reload always ticks, even while dead / between rounds / in orbit view.
      // Otherwise a reload interrupted by death stayed "in progress" forever and
      // silently blocked every future shot.
      // Fire cooldown must drain every frame too — if it froze while dead the
      // trigger looked pressed but nothing came out.
      weaponCooldownRef.current = Math.max(0, weaponCooldownRef.current - dt);

      if (isReloadingRef.current) {
        if (reloadTimerRef.current > 0) {
          reloadTimerRef.current = Math.max(0, reloadTimerRef.current - dt);
          const rounded = Math.ceil(reloadTimerRef.current * 10) / 10;
          // The animation loop closes over the initial React state. Comparing
          // against that stale value caused setState on every rendered frame
          // throughout reload, overwhelming phone touch/pointer processing.
          if (rounded !== reloadLeftRef.current) {
            reloadLeftRef.current = rounded;
            setReloadLeft(rounded);
          }
        }
        if (reloadTimerRef.current <= 0) finishReload(reloadingWeaponRef.current ?? weaponRef.current);
      }

      // automatic fire & burst handling
      if (human && human.alive && matchRef.current.phase === "round" && modeRef.current === "walk") {
        // firing itself happens after the camera update, further down the frame
        pendingFire = true;
      }

      if (humanBody) humanBody.group.visible = introTime > 0 && modeRef.current === "walk";


      if (introTime > 0 && human && modeRef.current === "walk") {
        // cinematic spawn intro: camera hovers in front of the player's face
        const p = human.pos;
        if (humanBody) {
          humanBody.group.position.copy(p);
          humanBody.group.rotation.y = yaw + Math.PI;
        }
        const face = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const t = 1 - introTime / 5;
        const dist = 4.6 - t * 2.1;
        const head = new THREE.Vector3(p.x, p.y + EYE_HEIGHT, p.z);
        const orbitSwing = Math.sin(t * Math.PI) * 0.5;
        camera.position.set(
          head.x + face.x * dist + Math.cos(yaw) * orbitSwing * dist * 0.4,
          head.y + 0.45 + (1 - t) * 0.8,
          head.z + face.z * dist - Math.sin(yaw) * orbitSwing * dist * 0.4,
        );
        camera.lookAt(head);
      } else if (modeRef.current === "orbit") {
        theta += dt * 0.03;
        camera.position.set(
          target.x + radius * Math.sin(phi) * Math.cos(theta),
          target.y + radius * Math.cos(phi),
          target.z + radius * Math.sin(phi) * Math.sin(theta),
        );
        camera.lookAt(target);
      } else if (human) {

        if (!human.alive) {
          // drop out of ADS/scope while dead so nothing lingers on respawn
          if (adsRef.current) {
            adsRef.current = false;
            setScoped(false);
          }
          if (adsProgressRef.current > 0) {
            adsProgressRef.current = Math.max(0, adsProgressRef.current - dt * 6);
            if (scopeRef.current) scopeRef.current.style.opacity = "0";
            if (crosshairRef.current) crosshairRef.current.style.opacity = "1";
            if (centerDotRef.current) centerDotRef.current.style.opacity = "1";
            camera.fov = BASE_FOV;
            camera.updateProjectionMatrix();
          }
          human.respawnIn -= dt;
          setPlayerRespawn(Math.max(0, Math.ceil(human.respawnIn)));
          if (human.respawnIn <= 0) respawn(human);
        } else {
          const binds = settingsRef.current.keybinds;
          const sprintHeld =
            settingsRef.current.sprintMode === "toggle" ? sprintToggleRef.current : keys.has(binds.sprint);
          const speed = (proneRef.current ? 3.4 : sprintHeld ? 16 : 8) * activeEffects().speed * dt;
          forward.set(Math.sin(yaw), 0, Math.cos(yaw));
          right.set(Math.cos(yaw), 0, -Math.sin(yaw));
          const move = new THREE.Vector3();
          if (keys.has(binds.forward) || keys.has("ArrowUp")) move.sub(forward);
          if (keys.has(binds.back) || keys.has("ArrowDown")) move.add(forward);
          if (keys.has(binds.left) || keys.has("ArrowLeft")) move.sub(right);
          if (keys.has(binds.right) || keys.has("ArrowRight")) move.add(right);

          // a channelled medkit is cancelled the moment the player moves
          tickHeal(dt, move.lengthSq() > 0 || !grounded);

          const colliders = localColliders(walkPos);

          if (move.lengthSq() > 0) {
            move.normalize().multiplyScalar(speed);

            const SKIN = 0.06;
            // Dense vertical sampling: three rays (knee/chest/head) slipped
            // straight through thin geometry that sits between them — railings,
            // fence rails, pipes. Anything the player can physically touch now
            // gets a ray within ~0.35m of it.
            const PROBE_HEIGHTS = [0.2, 0.55, 0.9, 1.25, 1.6, 1.85];
            // Map-edge / perimeter band: these barriers are hard walls, never
            // subject to the "shorter than the player" step-over leniency.
            const HARD_EDGE_BAND = 3;
            const nearHardEdge = (x: number, z: number) =>
              x - boundsMinX < HARD_EDGE_BAND ||
              boundsMaxX - x < HARD_EDGE_BAND ||
              z - boundsMinZ < HARD_EDGE_BAND ||
              boundsMaxZ - z < HARD_EDGE_BAND;

            const probe = (dir: THREE.Vector3, far: number) => {
              let best: THREE.Intersection | null = null;
              for (const h of PROBE_HEIGHTS) {
                const hit = castFirst(
                  scratch.copy(walkPos).setY(walkPos.y + h),
                  dir,
                  far,
                  colliders,
                );
                if (hit && (!best || hit.distance < best.distance)) best = hit;
                if (best && best.distance < 0.05) break;
              }
              return best;
            };

            /**
             * Horizontal blocking normal for a hit, or null when the surface is
             * genuinely walkable.
             *
             * Colliders are DoubleSide, so a flipped face can hand back a normal
             * pointing away from us — orient it against the ray first. Vertical
             * faces always block. A near-horizontal face (prop top, slope,
             * ledge) only blocks when it sits higher than the player can step,
             * or when it belongs to a hard perimeter barrier.
             */
            const blockingNormal = (
              hit: THREE.Intersection,
              dir: THREE.Vector3,
              hard: boolean,
            ) => {
              const raw = hit.face
                ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
                : dir.clone().negate();
              if (raw.dot(dir) > 0) raw.negate();
              const facing = dir.clone().negate().setY(0);
              if (Math.abs(raw.y) < 0.7) {
                const n = raw.setY(0);
                return n.lengthSq() > 0.01
                  ? n.normalize()
                  : facing.lengthSq() > 1e-6
                    ? facing.normalize()
                    : null;
              }
              if (hard || hit.point.y - walkPos.y > STEP_UP)
                return facing.lengthSq() > 1e-6 ? facing.normalize() : null;
              return null;
            };

            const resolve = (sub: THREE.Vector3) => {
              if (colliders.length === 0) return;
              const dir = sub.clone().normalize();
              const hit = probe(dir, PLAYER_RADIUS + sub.length() + SKIN);
              if (!hit) return;
              const hard = nearHardEdge(walkPos.x + sub.x, walkPos.z + sub.z);
              const n = blockingNormal(hit, dir, hard);
              if (!n) return;
              const into = sub.dot(n);
              if (into < 0) sub.addScaledVector(n, -into);
              const forward = Math.max(0, hit.distance - PLAYER_RADIUS - SKIN);
              if (into >= 0 && forward < sub.length()) sub.setLength(forward);
              // re-check the slide direction; if still blocked, stop short
              if (sub.lengthSq() > 1e-6) {
                const d2 = sub.clone().normalize();
                const hit2 = probe(d2, PLAYER_RADIUS + sub.length() + SKIN);
                if (hit2) {
                  const hard2 = nearHardEdge(walkPos.x + sub.x, walkPos.z + sub.z);
                  if (blockingNormal(hit2, d2, hard2)) {
                    const allowed = Math.max(0, hit2.distance - PLAYER_RADIUS - SKIN);
                    if (allowed < sub.length()) sub.setLength(allowed);
                  }
                }
              }
            };

            // Sub-stepping: at sprint speed a single frame's movement could be
            // longer than a wall is thick, so one probe-and-move tunnelled
            // straight through it. Advance in slices no longer than half the
            // player radius, re-probing from the new position each slice.
            const total = move.length();
            const slices = Math.max(1, Math.ceil(total / (PLAYER_RADIUS * 0.5)));
            const stepVec = move.clone().divideScalar(slices);
            for (let s = 0; s < slices; s++) {
              const sub = stepVec.clone();
              resolve(sub);
              if (sub.lengthSq() <= 1e-9) break;

              // step check: only small ledges are walkable, taller must be jumped
              if (grounded) {
                const nx = walkPos.x + sub.x;
                const nz = walkPos.z + sub.z;
                const nextGround = groundAt(nx, nz, walkPos.y, 2.5);
                if (nextGround !== null && nextGround - walkPos.y > STEP_UP) break;
              }

              walkPos.x += sub.x;
              walkPos.z += sub.z;
            }
          }

          // jump + gravity
          if ((keys.has("Space") || keys.has(binds.jump)) && grounded) {
            velY = JUMP_SPEED;
            grounded = false;
            playSfx("jump", 0.5);
          }
          velY -= GRAVITY * dt;
          walkPos.y += velY * dt;

          const gy = groundAt(walkPos.x, walkPos.z, walkPos.y);
          if (gy !== null) {
            const wasAirborne = !grounded;
            const impact = -velY;
            if (walkPos.y <= gy + 0.02) {
              walkPos.y = gy;
              velY = 0;
              grounded = true;
              if (wasAirborne && impact > 3) playSfx("land", Math.min(0.7, 0.25 + impact * 0.03));
            } else if (velY <= 0 && walkPos.y - gy < 0.35) {
              walkPos.y = gy;
              velY = 0;
              grounded = true;
              if (wasAirborne && impact > 3) playSfx("land", Math.min(0.7, 0.25 + impact * 0.03));
            } else {
              grounded = false;
            }
          }

          // safety net: if anything ever drops us through the level geometry,
          // put us back on our own spawn pad instead of falling forever
          if (walkPos.y < -25) {
            walkPos.copy(human.home.top);
            velY = 0;
            grounded = true;
          }


          const preClampX = walkPos.x;
          const preClampZ = walkPos.z;
          walkPos.x = Math.max(boundsMinX, Math.min(boundsMaxX, walkPos.x));
          walkPos.z = Math.max(boundsMinZ, Math.min(boundsMaxZ, walkPos.z));
          // absolute authored edge of the map — projected every frame, so it
          // holds regardless of speed, jump height or geometry glitches
          if (hardBarrier) {
            // 2 m inset (1 m authored + 1 m safety) so the compressed ground
            // rim can never open a gap the player falls through
            const inside = clampInsideBarrier(hardBarrier, walkPos.x, walkPos.z, 2);
            if (inside.clamped) {
              walkPos.x = inside.x;
              walkPos.z = inside.z;
            }
          }
          blockReasonRef.current =
            Math.abs(preClampX - walkPos.x) > 1e-4 || Math.abs(preClampZ - walkPos.z) > 1e-4
              ? "map bounds box"
              : "";

          // during the buy phase you are locked inside your spawn cage
          const cage = spawnCageRef.current;
          if (matchRef.current.phase === "countdown" && cage) {
            const cageX = walkPos.x;
            const cageZ = walkPos.z;
            walkPos.x = Math.max(cage.center.x - cage.halfX, Math.min(cage.center.x + cage.halfX, walkPos.x));
            walkPos.z = Math.max(cage.center.z - cage.halfZ, Math.min(cage.center.z + cage.halfZ, walkPos.z));
            if (Math.abs(cageX - walkPos.x) > 1e-4 || Math.abs(cageZ - walkPos.z) > 1e-4)
              blockReasonRef.current = "spawn cage (buy phase)";

            const ceil = cage.center.y + SPAWN_BOX_HEIGHT - eyeHeight();
            if (walkPos.y > ceil) {
              walkPos.y = ceil;
              velY = Math.min(velY, 0);
            }
          }
          human.pos.copy(walkPos);

          camera.position.set(walkPos.x, walkPos.y + eyeHeight(), walkPos.z);

          // screen shake decay
          if (shakeRef.current > 0) {
            const s = shakeRef.current * settingsRef.current.screenShake;
            camera.position.x += (Math.random() - 0.5) * s;
            camera.position.y += (Math.random() - 0.5) * s;
            camera.position.z += (Math.random() - 0.5) * s;
            shakeRef.current = Math.max(0, shakeRef.current - dt * 2.8);
          }

          // recoil recovery
          recoilRef.current = Math.max(0, recoilRef.current - dt * 0.45);
          recoilYawRef.current *= Math.max(0, 1 - dt * 5);

          // keep the scoped aim glued to the locked body part
          updateAimLock(dt);

          const effectiveYaw = yaw + recoilYawRef.current;
          const effectivePitch = pitch - recoilRef.current;
          const dir = new THREE.Vector3(
            Math.sin(effectiveYaw) * Math.cos(effectivePitch),
            Math.sin(effectivePitch),
            Math.cos(effectiveYaw) * Math.cos(effectivePitch),
          );
          camera.lookAt(camera.position.clone().add(dir.multiplyScalar(-1)));

          // ADS: ease a 0..1 progress value, then drive both the FOV and the
          // scope overlay from it so nothing ever snaps.
          const adsTarget = adsRef.current ? 1 : 0;
          const rate = adsTarget > adsProgressRef.current ? 8.5 : 11;
          adsProgressRef.current += (adsTarget - adsProgressRef.current) * (1 - Math.exp(-dt * rate));
          if (Math.abs(adsTarget - adsProgressRef.current) < 0.002) adsProgressRef.current = adsTarget;
          const raw = adsProgressRef.current;
          const ease = raw * raw * (3 - 2 * raw); // smoothstep
          const zoom = Math.max(1, getWeaponBehavior(weaponRef.current).zoom);
          const nextFov = BASE_FOV + (BASE_FOV / zoom - BASE_FOV) * ease;
          if (Math.abs(camera.fov - nextFov) > 0.01) {
            camera.fov = nextFov;
            camera.updateProjectionMatrix();
          }
          // the glass only slides in over the last part of the transition
          const scopeAlpha = scopedRef.current ? Math.max(0, (ease - 0.45) / 0.55) : 0;
          if (scopeRef.current) scopeRef.current.style.opacity = String(scopeAlpha);
          if (crosshairRef.current) crosshairRef.current.style.opacity = String(1 - scopeAlpha);
          if (centerDotRef.current) centerDotRef.current.style.opacity = String(1 - scopeAlpha);

          // footsteps: distance-driven so the cadence matches the actual speed
          const moved = Math.hypot(walkPos.x - lastStepPos.x, walkPos.z - lastStepPos.z);
          const sprinting = sprintHeld;
          if (grounded && move.lengthSq() > 0) {
            stepDist += moved;
            const stride = sprinting ? 1.75 : 1.5;
            if (stepDist >= stride) {
              stepDist = 0;
              if (sprinting) {
                runStepIndex = (runStepIndex + 1) % RUN_KINDS.length;
                playSfx(RUN_KINDS[runStepIndex] ?? "steprun", 0.6, (Math.random() - 0.5) * 0.14);
              } else {
                // shuffle-free rotation: never repeat the same heel sample twice
                stepIndex = (stepIndex + 1 + (Math.random() < 0.35 ? 1 : 0)) % STEP_KINDS.length;
                playSfx(STEP_KINDS[stepIndex] ?? "step1", 0.5, (Math.random() - 0.5) * 0.14);
              }
            }
          } else {
            stepDist = Math.min(stepDist, 1.2);
          }
          lastStepPos.set(walkPos.x, 0, walkPos.z);
        }
      }

      // automatic / burst fire, run only once the camera is in its final pose
      if (pendingFire) {
        const behavior = getWeaponBehavior(weaponRef.current);
        if (burstQueueRef.current) {
          burstQueueRef.current.nextIn -= dt;
          if (burstQueueRef.current.nextIn <= 0) {
            const q = burstQueueRef.current;
            shoot(true);
            q.shotsLeft -= 1;
            if (q.shotsLeft <= 0) {
              burstQueueRef.current = null;
            } else {
              q.nextIn = behavior.interval;
            }
          }
        }
        const canAutoFire =
          mouseHeldRef.current &&
          (behavior.mode === "auto" || (autoFireRef.current && behavior.mode === "single")) &&
          weaponCooldownRef.current <= 0 &&
          !isReloadingRef.current;
        if (canAutoFire) {
          shoot(true);
        }
      }

      if (weaponCooldownRef.current <= 0 && !weaponReady) {
        setWeaponReady(true);
      }


      walkMovingRef.current = prevWalkPos.distanceToSquared(walkPos) > 0.0025;
      prevWalkPos.copy(walkPos);

      for (const f of fighters) {
        if (!f.isHuman) botTick(f, dt);
        if (f.tracer && f.tracer.ttl > 0) {
          f.tracer.ttl -= dt;
          f.tracer.mat.opacity = Math.max(0, f.tracer.ttl / 0.1);
        }
      }

      const laser = laserRef.current;
      if (laser && laser.ttl > 0) {
        laser.ttl -= dt;
        const t = Math.max(0, laser.ttl / 0.12);
        laser.material.opacity = t;
        laser.spark.intensity = t * 5;
        (laser.sparkMesh.material as THREE.MeshBasicMaterial).opacity = t;
        if (laser.ttl <= 0) {
          laser.sparkMesh.visible = false;
          laser.spark.intensity = 0;
        }
      }

      const muzzle = muzzleRef.current;
      if (muzzle && muzzle.ttl > 0) {
        muzzle.ttl -= dt;
        const t = Math.max(0, muzzle.ttl / 0.06);
        (muzzle.mesh.material as THREE.MeshBasicMaterial).opacity = t;
        muzzle.light.intensity = t * 18;
        muzzle.mesh.scale.setScalar(1 + (1 - t) * 2.5);
        if (muzzle.ttl <= 0) {
          muzzle.mesh.visible = false;
          muzzle.light.intensity = 0;
        }
      }

      if (hitMarkerRef.current > 0) {
        hitMarkerRef.current = Math.max(0, hitMarkerRef.current - dt);
        if (hitMarkerRef.current <= 0) setHitMarker(0);
      }

      if (killFeedRef.current.length > 0) {
        let changed = false;
        for (const item of killFeedRef.current) {
          item.time -= dt;
          if (item.time <= 0) changed = true;
        }
        if (changed) {
          killFeedRef.current = killFeedRef.current.filter((i) => i.time > 0);
          setKillFeed([...killFeedRef.current]);
        }
      }

      if (intermissionRef.current > 0) {
        intermissionRef.current = Math.max(0, intermissionRef.current - dt);
        const rounded = Math.ceil(intermissionRef.current);
        if (matchRef.current.countdown !== rounded) {
          matchRef.current.countdown = rounded;
          setMatch({ ...matchRef.current });
        }
      }



      radarRef.current = {
        fighters: fighters.map((f) => ({
          x: f.pos.x,
          z: f.pos.z,
          team: f.team,
          alive: f.alive,
          isHuman: f.isHuman,
        })),
        player: human ? { x: walkPos.x, z: walkPos.z, yaw } : null,
        decoys: decoys.map((d) => ({ x: d.root.position.x, z: d.root.position.z, team: d.team, ttl: d.ttl })),
        pings: pings.map((p) => ({ x: p.pos.x, z: p.pos.z, kind: p.kind, ttl: p.life })),
      };

      if (damageFlashRef.current > 0) {
        damageFlashRef.current = Math.max(0, damageFlashRef.current - dt * 1.8);
        const v = vignetteRef.current;
        if (v) v.style.opacity = settingsRef.current.damageFlash ? String(damageFlashRef.current) : "0";
      }

      // --- enemy-under-crosshair probe (throttled to ~12 Hz, cheap raycast) ---
      targetProbeRef.current -= dt;
      if (targetProbeRef.current <= 0) {
        targetProbeRef.current = 0.08;
        let hot = false;
        if (human && human.alive && modeRef.current === "walk" && matchRef.current.phase === "round") {
          const targets = enemyMeshes(human.team);
          if (targets.length) {
            const dir = camera.getWorldDirection(scratch.set(0, 0, 0)).clone();
            raycaster.set(camera.position, dir);
            raycaster.far = 220;
            const enemyHit = raycaster.intersectObjects(targets, false)[0];
            if (enemyHit) {
              const wallHit = castFirst(camera.position, dir, enemyHit.distance);
              hot = !wallHit || wallHit.distance > enemyHit.distance;
            }

          }
        }
        if (hot !== onTargetRef.current) {
          onTargetRef.current = hot;
          setOnTarget(hot);
        }
      }

      const ch = crosshairRef.current;
      if (ch) {
        const cfg = settingsRef.current;
        const b = getWeaponBehavior(weaponRef.current);
        const dynamic = cfg.crosshairDynamic ? b.spread * 900 + Math.min(0.32, recoilRef.current) * 190 : 0;
        const size = (14 + dynamic) * cfg.crosshairSize;
        ch.style.width = `${size}px`;
        ch.style.height = `${size}px`;
      }


      // keep the tight shadow box centred on the camera, refreshed at ~30 Hz
      if (renderer.shadowMap.enabled) {
        shadowClock -= dt;
        if (shadowClock <= 0) {
          shadowClock = 1 / 30;
          sunTarget.position.set(camera.position.x, 0, camera.position.z);
          sun.position.copy(sunTarget.position).add(SUN_OFFSET);
          sunTarget.updateMatrixWorld();
          renderer.shadowMap.needsUpdate = true;
        }
      }

      if (weather) {
        weather.update(camera.position, dt);
        const wet = weather.kind() === "clear" ? 0 : 1;
        weatherWet += (wet - weatherWet) * Math.min(1, dt * 0.35);
        weatherApply?.(weather.flash(), weatherWet);
      }
      skybox?.update(camera.position, dt);
      smokeField.update(dt);
      if (flashRef.current > 0) {
        flashRef.current = Math.max(0, flashRef.current - dt * 0.42);
        if (flashElRef.current) flashElRef.current.style.opacity = String(Math.min(1, flashRef.current));
      } else if (flashElRef.current && flashElRef.current.style.opacity !== "0") {
        flashElRef.current.style.opacity = "0";
      }
      renderer.render(scene, camera);

    };
    animate();

    // warm the sample bytes into the HTTP cache so the first shot is instant
    warmSfx();
    const onVisibility = () => (document.hidden ? suspendSfx() : resumeSfx());
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      scene.remove(mushroomGroup);
      scene.remove(armorGroup);
      scene.remove(decoyGroup);
      for (const d of decoys) decoyGroup.remove(d.root);
      decoys.length = 0;
      disposeFfCoins(ffCoinsRef.current);
      smokeField.clear();
      skybox?.dispose();
      skybox = null;
      weather?.dispose();
      weather = null;
      weatherApply = null;
      stopWeatherAmbience();
      cancelWarm?.();
      cancelWarm = null;
      cancelAnimationFrame(raf);
      window.clearTimeout(leaderboardTimer);
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("keydown", onFirstInteraction);
      for (const t of popupTimersRef.current) window.clearTimeout(t);
      popupTimersRef.current = [];
      renderer.domElement.removeEventListener("pointerdown", onTouchLookStart);
      renderer.domElement.removeEventListener("pointermove", onCanvasPointerMove);

      window.removeEventListener("pointerdown", trackDown, true);
      window.removeEventListener("pointerup", trackUp, true);
      window.removeEventListener("pointercancel", trackUp, true);
      window.removeEventListener("pointerup", onTouchLookEnd);
      window.removeEventListener("pointercancel", onTouchLookEnd);
      renderer.domElement.removeEventListener("lostpointercapture", onLostLookCapture);
      window.removeEventListener("touchend", onAnyTouchEnd);
      window.removeEventListener("touchcancel", onAnyTouchEnd);

      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mouseup", onMouseUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("keydown", onReservedKey, { capture: true } as EventListenerOptions);
      suspendSfx();
      powerFx.dispose();
      barrierDome.dispose();
      ktx2Loader.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };



  }, []);

  useEffect(() => {
    showRoofRef.current = showRoof;
    const c = clipRef.current;
    if (c) c.renderer.clippingPlanes = showRoof ? [] : [c.plane];
  }, [showRoof, hud]);

  const enterWalk = () => {
    startMatchRef.current?.();
    setMode("walk");
    const canvas = mountRef.current?.querySelector("canvas");
    canvas?.requestPointerLock?.();
  };

  /** The shell (splash → lobby → deploy) shows a Start Match button once the map is ready. */
  const startedRef = useRef(false);
  const [readyToStart, setReadyToStart] = useState(false);
  useEffect(() => {
    if (status || startedRef.current) return;
    setReadyToStart(true);
    onReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const startMatchNow = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setReadyToStart(false);
    const cfg = settingsRef.current.quickMatch ? MATCH_CONFIG.quick : MATCH_CONFIG.standard;
    setMatchConfig(cfg);
    matchConfigRef.current = cfg;
    startMatchRef.current?.();
    setMode("walk");
    const canvas = mountRef.current?.querySelector("canvas");
    canvas?.requestPointerLock?.();
  }, []);


  useEffect(() => {
    if (match.phase === "countdown" && mode === "walk" && !intro) {
      setShopOpen(true);
      document.exitPointerLock?.();
    } else {
      setShopOpen(false);
    }
  }, [match.phase, mode, intro]);


  /** Equip a weapon respecting the loadout rule: 2 heavy + 1 sidearm. */
  const equipWeapon = (w: Weapon) => {
    setSlots((prev) => {
      const next = [...prev];
      if (!isHeavy(w)) {
        next[2] = w.id;
        return next;
      }
      const existing = next.indexOf(w.id);
      if (existing !== -1) return next;
      const empty = next[0] === null ? 0 : next[1] === null ? 1 : -1;
      const target = empty !== -1 ? empty : activeSlot < 2 ? activeSlot : 0;
      next[target] = w.id;
      return next;
    });
    setActiveSlot(() => {
      if (!isHeavy(w)) return 2;
      return slots.indexOf(w.id) !== -1
        ? slots.indexOf(w.id)
        : slots[0] === null
          ? 0
          : slots[1] === null
            ? 1
            : activeSlot < 2
              ? activeSlot
              : 0;
    });
  };

  const buyWeapon = (w: Weapon) => {
    if (owned.includes(w.id)) {
      equipWeapon(w);
      return;
    }
    if (credits < w.price) {
      playSfx("dryfire", 0.5);
      return;
    }
    playSfx("buy", 0.85);
    setCredits((c) => c - w.price);
    setOwned((o) => [...o, w.id]);
    setAmmo((prev) => ({
      ...prev,
      [w.id]: { mag: getMagazine(w.id), reserve: getReserveAmmo(w.id) },
    }));
    equipWeapon(w);
  };

  const sellAllWeapons = () => {
    const heavyIds = slots.slice(0, 2).filter(Boolean) as string[];
    if (heavyIds.length === 0) return;
    const refund = heavyIds.reduce((sum, id) => sum + (getWeapon(id)?.price ?? 0) * 0.5, 0);
    setCredits((c) => c + Math.floor(refund));
    setSlots((prev) => [null, null, prev[2] ?? null, prev[3] ?? "fists"]);
    setActiveSlot(2);
  };


  const selectSlot = (i: number) => {

    if (!slots[i]) return;
    setActiveSlot(i);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const binds = settingsRef.current.keybinds;
      const is = (a: BindAction) => binds[a] && e.code === binds[a];
      if (is("reload") && !isReloadingRef.current) {
        const weaponId = weaponRef.current;
        const cur = ammoRef.current[weaponId];
        if (cur && cur.mag < getMagazine(weaponId) && cur.reserve > 0) {
          startReloadRef.current(weaponId);
        }
      }
      if (is("wall")) throwShieldWallRef.current();
      if (is("bomb")) throwBombRef.current();
      if (is("heal")) useHealthKitRef.current();
      if (is("power")) activatePowerRef.current();
      if (is("prone")) setProne((v) => !v);
      if (is("crouch")) setProne((v) => !v);
      if (is("sprint") && settingsRef.current.sprintMode === "toggle") {
        sprintToggleRef.current = !sprintToggleRef.current;
      }
      if (e.code === "Escape") actionsRef.current?.cancelWall();
      if (is("shop") && matchRef.current.phase === "countdown") setShopOpen((v) => !v);
      if (is("ping")) placePingRef.current();
      if (e.code === "KeyG") cycleGrenadeRef.current();
      if (e.code === "KeyF") useInhalerRef.current();
      if (e.code === "Backquote") setShowDebug((v) => !v);
      if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3" || e.code === "Digit4") {
        const i = Number(e.code.slice(5)) - 1;
        setSlots((s) => {
          if (s[i]) setActiveSlot(i);
          return s;
        });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const useHealthKit = () => {
    if (kits <= 0) return;
    actionsRef.current?.startHeal(kitPartialRef.current);
  };

  const throwBomb = () => {
    if (bombs <= 0) return;
    setBombArmed(!!actionsRef.current?.armBomb());
  };
  onBombThrownRef.current = () => {
    const kind = grenadeKindRef.current;
    setGrenades((g) => ({ ...g, [kind]: Math.max(0, g[kind] - 1) }));
    setBombArmed(false);
  };
  /** step to the next throwable that still has charges */
  const cycleGrenade = () => {
    const from = GRENADE_KINDS.indexOf(grenadeKindRef.current);
    for (let i = 1; i <= GRENADE_KINDS.length; i += 1) {
      const next = GRENADE_KINDS[(from + i) % GRENADE_KINDS.length]!;
      if (grenades[next] > 0 || next === grenadeKindRef.current) {
        setGrenadeKind(next);
        return;
      }
    }
  };
  const cycleGrenadeRef = useRef(cycleGrenade);
  cycleGrenadeRef.current = cycleGrenade;
  throwBombRef.current = throwBomb;
  useHealthKitRef.current = useHealthKit;

  const throwShieldWall = () => {
    if (wallCharges <= 0) {
      actionsRef.current?.cancelWall();
      return;
    }
    if (actionsRef.current?.wallButton()) setWallCharges((w) => Math.max(0, w - 1));
  };
  throwShieldWallRef.current = throwShieldWall;

  const dropWeapon = (index: number) => {
    if (index === 3) return;
    setSlots((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setActiveSlot((cur) => (cur === index ? 3 : cur));
  };

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="h-full w-full touch-none select-none" />
      {/* flashbang whiteout — opacity driven straight from the render loop */}
      <div
        ref={flashElRef}
        className="pointer-events-none absolute inset-0 z-40 bg-white"
        style={{ opacity: 0, transition: "opacity 60ms linear" }}
      />
      <div
        ref={vignetteRef}
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0,
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(200,30,30,0.6) 100%)",
        }}
      />

      {placingWall && (
        <div className="pointer-events-none absolute left-1/2 top-[14%] z-30 -translate-x-1/2 rounded-full border border-sky-300/50 bg-sky-500/15 px-4 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.25em] text-sky-100 backdrop-blur">
          Aim the gloo wall — fire or tap the gloo button to place · Esc to cancel
        </div>
      )}

      {cursorFree && mode === "walk" && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-full border border-white/20 bg-black/55 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white/80 backdrop-blur">
          Mouse released · press ` or click the arena to aim again
        </div>
      )}

      {collisionDebug && mode === "walk" && (
        <div className="pointer-events-none absolute left-1/2 top-12 z-40 -translate-x-1/2 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200 backdrop-blur">
          Collision debug on (F9)
          {blockReason ? ` · blocked by ${blockReason}` : " · pink box = map bounds, yellow = spawn cage"}
        </div>
      )}


      {status && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{status}</p>
          <div className="h-1.5 w-56 overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full transition-[width] duration-200 ease-out"
              style={{ width: `${Math.round(mapLoadProgress * 100)}%`, background: "var(--gradient-hud)" }}
            />
          </div>
        </div>
      )}

      {readyToStart && !status && (
        <div className="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background/80 p-6 text-center backdrop-blur-md">
          <h2 className="text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-4xl">
            Arena ready
          </h2>
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            Warm up, check your loadout, then drop in when you're ready.
          </p>
          <button
            type="button"
            onClick={startMatchNow}
            className="min-w-[220px] rounded-xl bg-[var(--hud-accent)] px-8 py-3 text-xs font-black uppercase tracking-[0.2em] text-[var(--hud-accent-foreground)] shadow-[var(--shadow-hud)] transition hover:brightness-110 active:scale-95"
          >
            Start match
          </button>
          <button
            type="button"
            onClick={() => onExit?.()}
            className="min-w-[220px] rounded-xl border border-border bg-card/80 px-8 py-3 text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground transition hover:bg-secondary active:scale-95"
          >
            Back to lobby
          </button>
        </div>
      )}

      {mode === "walk" && (

        <>
          {paused && (
            <div className="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background/85 p-6 text-center backdrop-blur-md">
              <h2 className="text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-4xl">
                Paused
              </h2>
              <p className="max-w-xs text-xs text-muted-foreground">
                Tap resume to jump back in, or open settings to tweak sensitivity, quality and controls.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPaused(false);
                    resumeSfx();
                    mountRef.current?.querySelector("canvas")?.requestPointerLock?.();
                  }}
                  className="min-w-[200px] rounded-xl bg-[var(--hud-accent)] px-8 py-3 text-xs font-black uppercase tracking-[0.2em] text-[var(--hud-accent-foreground)] shadow-[var(--shadow-hud)] transition hover:brightness-110 active:scale-95"
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaused(false);
                    setSettingsOpen(true);
                    document.exitPointerLock?.();
                  }}
                  className="min-w-[200px] rounded-xl border border-border bg-card/80 px-8 py-3 text-xs font-bold uppercase tracking-[0.15em] text-foreground transition hover:bg-secondary active:scale-95"
                >
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => onExit?.()}
                  className="min-w-[200px] rounded-xl border border-border bg-card/80 px-8 py-3 text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground transition hover:bg-secondary active:scale-95"
                >
                  Main menu
                </button>
              </div>
            </div>
          )}
          {settings.showMinimap && (
            <div
              className="pointer-events-none absolute inset-0 z-10"
              style={{
                transform: `scale(${hudScale})`,
                transformOrigin: "top left",
                opacity: settings.hudOpacity,
              }}
            >
              <Minimap radarRef={radarRef} mapRef={mapGridRef} imageRef={mapImageRef} />
            </div>
          )}

          {/* status strip right of the minimap: settings, companion, ping, spectators */}
          <div className="absolute left-[148px] top-3 z-10 flex items-center gap-3 text-white/70 sm:left-[156px] sm:top-4">
            <button
              type="button"
              aria-label="Open settings"
              className="pointer-events-auto rounded-md p-0.5 transition hover:text-white"
              onClick={() => {
                setSettingsOpen(true);
                document.exitPointerLock?.();
              }}
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={cursorFree ? "Grab mouse" : "Release mouse"}
              title="Release / grab mouse (`)"
              className={`pointer-events-auto rounded-md p-0.5 transition hover:text-white ${
                cursorFree ? "text-[var(--hud-accent)]" : ""
              }`}
              onClick={() => toggleCursorRef.current()}
            >
              <MousePointer2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Toggle collision debug"
              title="Show collision geometry (F9)"
              className={`pointer-events-auto rounded-md p-0.5 transition hover:text-white ${
                collisionDebug ? "text-emerald-400" : ""
              }`}
              onClick={() => setCollisionDebug((v) => !v)}
            >
              <Boxes className="h-4 w-4" />
            </button>
            <PawPrint className="h-4 w-4" />
            <span className="flex items-center gap-1 text-[9px] font-semibold tabular-nums">
              <Wifi className="h-4 w-4" />
              92
            </span>
            <span className="flex items-center gap-1 text-[9px] font-semibold tabular-nums">
              <Eye className="h-4 w-4" />
              {hud.filter((f) => f.team === "blue" && f.alive).length}
            </span>
          </div>
          <div className="pointer-events-none absolute left-[152px] top-9 z-10 text-white/60 sm:left-[160px] sm:top-10">
            <Smile className="h-4 w-4" />
          </div>

          {/* Floating damage numbers at the hit point */}
          <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
            {damagePopups.map((d) => (
              <span
                key={d.id}
                className="absolute font-extrabold tabular-nums drop-shadow-[0_2px_3px_rgba(0,0,0,0.85)]"
                style={{
                  left: d.x,
                  top: d.y,
                  color: d.head ? "rgb(255,64,48)" : "rgb(255,214,64)",
                  fontSize: d.head ? 30 : 20,
                  transform: "translate(-50%, -50%)",
                  animation: "arena-dmg-float 900ms ease-out forwards",
                }}
              >
                {d.amount}
                {d.head && <span className="ml-1 align-middle text-[0.55em] tracking-widest">HS</span>}
              </span>
            ))}
          </div>

          {/* Scope overlay — Free Fire style. Sides stay transparent so the player keeps peripheral vision. */}
          <div ref={scopeRef} className="pointer-events-none absolute inset-0 z-20" style={{ opacity: 0 }}>
            {/* Subtle darkening only at the bezel edge, sides remain see-through */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(circle at center, rgba(0,0,0,0) 26%, rgba(0,0,0,0.35) 28%, rgba(0,0,0,0) 32%)",
              }}
            />
            {/* Chunky dark bezel ring with metallic inner highlight */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: "56vh",
                height: "56vh",
                boxShadow:
                  "0 0 0 10px rgba(10,12,14,0.98), 0 0 0 12px rgba(60,64,70,0.6), inset 0 0 0 6px rgba(18,20,24,0.95), inset 0 0 0 8px rgba(120,128,140,0.35), inset 0 0 40px rgba(0,0,0,0.9)",
              }}
            />
            {/* Inner lens recess shadow */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ width: "52vh", height: "52vh", boxShadow: "inset 0 0 28px rgba(0,0,0,0.85)" }}
            />
            {/* Reticle: short edge ticks + thin cross lines */}
            <div className="absolute left-1/2 top-1/2 h-px w-[44vh] -translate-x-1/2 -translate-y-1/2 bg-black/55" />
            <div className="absolute left-1/2 top-1/2 h-[44vh] w-px -translate-x-1/2 -translate-y-1/2 bg-black/55" />
            {/* Tick marks at the four edges */}
            <div className="absolute left-1/2 top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-[20vh] bg-black/85" />
            <div className="absolute left-1/2 top-1/2 h-2.5 w-0.5 -translate-x-1/2 translate-y-[20vh] bg-black/85" />
            <div className="absolute left-1/2 top-1/2 h-0.5 w-2.5 -translate-x-[20vh] -translate-y-1/2 bg-black/85" />
            <div className="absolute left-1/2 top-1/2 h-0.5 w-2.5 translate-x-[20vh] -translate-y-1/2 bg-black/85" />
            {/* Green center dot with glow */}
            <div
              className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: "#7CFC52", boxShadow: "0 0 6px 2px rgba(124,252,82,0.7)" }}
            />
            {/* Distance readout near top-right of the lens */}
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[16vh] text-[10px] font-semibold tabular-nums text-emerald-300/80">
              59m
            </span>
            {/* Thin scope-mount shapes at the bottom */}
            <div className="absolute left-1/2 top-1/2 h-2.5 w-10 -translate-x-1/2 translate-y-[25vh] rounded-sm bg-black/70" />
            <div className="absolute left-1/2 top-1/2 h-1.5 w-6 -translate-x-1/2 translate-y-[27.5vh] rounded-sm bg-black/60" />
          </div>

          {/* streak / multi-kill callout */}
          {streakBanner && !shopOpen && !paused && !settingsOpen && (
            <div
              key={streakBanner.id}
              className="pointer-events-none absolute left-1/2 top-[18%] z-10 -translate-x-1/2 text-center animate-in fade-in zoom-in-95 duration-200"
            >
              <p
                className="text-2xl font-black uppercase tracking-[0.32em] sm:text-3xl"
                style={{ color: "var(--hud-accent)", textShadow: "0 2px 18px rgba(0,0,0,0.85)" }}
              >
                {streakBanner.title}
              </p>
              <p className="mt-1 text-[9px] uppercase tracking-[0.4em] text-white/60">{streakBanner.sub}</p>
            </div>
          )}

          {/* thin bottom-centre vitals strip */}
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 w-[320px] -translate-x-1/2 sm:w-[380px]">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-widest text-white/70">
                HP {playerHp}/{MAX_HP}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-black/70 ring-1 ring-white/20">
                <div
                  className="h-full bg-white transition-all duration-150"
                  style={{ width: `${Math.max(0, Math.min(100, (playerHp / MAX_HP) * 100))}%` }}
                />
              </div>
              <span className="text-[9px] uppercase tracking-widest text-white/45 tabular-nums">
                {playerStatsHud.kills}K/{playerStatsHud.deaths}D
              </span>
              <span className="text-[9px] uppercase tracking-widest text-amber-300/80 tabular-nums">
                FF {ffCoinCount}
              </span>
              <span className="text-[9px] uppercase tracking-widest text-white/45 tabular-nums">
                BP{backpackLevel}
              </span>
            </div>
            {/* EP reserve — trickles into HP; inhalers (F) top it up */}
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-widest text-amber-300/80">
                EP {Math.round(ep)}
              </span>
              <div className="h-1 flex-1 overflow-hidden rounded-sm bg-black/70 ring-1 ring-white/10">
                <div
                  className="h-full bg-amber-300 transition-all duration-150"
                  style={{ width: `${Math.max(0, Math.min(100, (ep / MAX_EP) * 100))}%` }}
                />
              </div>
              <span className="text-[9px] uppercase tracking-widest text-white/45 tabular-nums">
                INH {inhalers}
              </span>
            </div>
            {/* Armor strip — vest + helmet level and durability */}
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-300/80">
                ARM
              </span>
              <div className="flex flex-1 gap-1">
                {[
                  { slot: "vest" as const, icon: "V", label: "VEST" },
                  { slot: "helmet" as const, icon: "H", label: "HELM" },
                ].map(({ slot, icon }) => {
                  const piece = armor[slot];
                  if (!piece) return (
                    <div key={slot} className="h-1 flex-1 overflow-hidden rounded-sm bg-black/50 ring-1 ring-white/10" />
                  );
                  const pct = (piece.durability / piece.maxDurability) * 100;
                  return (
                    <div key={slot} className="h-1 flex-1 overflow-hidden rounded-sm bg-black/70 ring-1 ring-white/10">
                      <div
                        className="h-full bg-cyan-300 transition-all duration-150"
                        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <span className="text-[9px] uppercase tracking-widest text-white/45 tabular-nums">
                {armor.vest ? `${armorIconLabel("vest", armor.vest.level)}` : "—"}
                {"/"}
                {armor.helmet ? `${armorIconLabel("helmet", armor.helmet.level)}` : "—"}
              </span>
            </div>
          </div>

          <div
            ref={crosshairRef}
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_0_4px_rgba(0,0,0,0.8)]"
            style={{
              width: 18,
              height: 18,
              opacity: settings.crosshairOpacity,
              display:
                settings.crosshairStyle === "dot" || settings.crosshairStyle === "none" ? "none" : undefined,
            }}
          >
            {settings.crosshairStyle === "circle" ? (
              <div
                className="h-full w-full rounded-full"
                style={{
                  border: `${settings.crosshairThickness}px solid ${onTarget ? "#ff3b30" : settings.crosshairColor}`,
                  transition: "border-color 90ms linear",
                }}
              />
            ) : (
              <div className="relative h-full w-full">
                {(["top", "bottom", "left", "right"] as const).map((side) => (
                  <span
                    key={side}
                    className="absolute"
                    style={{
                      background: onTarget ? "#ff3b30" : settings.crosshairColor,
                      transition: "background-color 90ms linear",
                      width: side === "left" || side === "right" ? "34%" : settings.crosshairThickness,
                      height: side === "top" || side === "bottom" ? "34%" : settings.crosshairThickness,
                      left: side === "left" ? 0 : side === "right" ? undefined : "50%",
                      right: side === "right" ? 0 : undefined,
                      top: side === "top" ? 0 : side === "bottom" ? undefined : "50%",
                      bottom: side === "bottom" ? 0 : undefined,
                      transform:
                        side === "left" || side === "right" ? "translateY(-50%)" : "translateX(-50%)",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <div
            ref={centerDotRef}
            className="pointer-events-none absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background: onTarget ? "#ff3b30" : settings.crosshairColor,
              transition: "background-color 90ms linear",
              opacity:
                settings.crosshairStyle === "none"
                  ? 0
                  : settings.crosshairStyle === "dot" || settings.crosshairStyle === "cross"
                    ? settings.crosshairOpacity
                    : 0,
            }}
          />
          {hitMarker > 0 && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="relative h-8 w-8">
                <div className="absolute left-1/2 top-0 h-3 w-0.5 -translate-x-1/2 bg-primary" />
                <div className="absolute bottom-0 left-1/2 h-3 w-0.5 -translate-x-1/2 bg-primary" />
                <div className="absolute left-0 top-1/2 h-0.5 w-3 -translate-y-1/2 bg-primary" />
                <div className="absolute right-0 top-1/2 h-0.5 w-3 -translate-y-1/2 bg-primary" />
              </div>
            </div>
          )}
          {!weaponReady && (
            <div className="pointer-events-none absolute bottom-28 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest text-muted-foreground">
              Recharging…
            </div>
          )}
          {match.phase === "countdown" && !shopOpen && (
            <div className="pointer-events-none absolute inset-x-0 top-24 flex flex-col items-center gap-1">
              <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">
                Round {match.round} · buy phase · press B for armory
              </p>
              <p className="text-5xl font-bold tabular-nums text-foreground">{match.countdown}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Locked inside your spawn cage
              </p>
            </div>
          )}

          {shopOpen && (
            <WeaponShop
              credits={credits}
              owned={owned}
              slots={slots}
              activeSlot={activeSlot}
              secondsLeft={match.countdown}
              totalSeconds={COUNTDOWN_SECONDS}
              onBuy={buyWeapon}
              onSelectSlot={selectSlot}
              onSellAll={sellAllWeapons}
              onClose={() => setShopOpen(false)}
            />
          )}

          {!shopOpen && (
            <div
              className="pointer-events-none absolute inset-0 z-10"
              style={{ transform: `scale(${hudScale})`, transformOrigin: "top right" }}
            >
              <WeaponSlots slots={slots} activeSlot={activeSlot} onSelect={selectSlot} ammo={ammo} />
            </div>
          )}

          {!shopOpen && !paused && !settingsOpen && (
            <TouchControls
              settings={settings}
              scale={hudScale}
              press={(code) => keysRef.current.add(code)}
              release={(code) => keysRef.current.delete(code)}
              onShootStart={() => actionsRef.current?.triggerDown()}
              onShootEnd={() => actionsRef.current?.triggerUp()}
              onScopeToggle={() => actionsRef.current?.toggleAds()}
              scoped={scoped}
              onJump={() => actionsRef.current?.jump()}
              onProneToggle={() => setProne((v) => !v)}
              prone={prone}
              kits={kits}
              onHeal={useHealthKit}
              inhalers={inhalers}
              onUseInhaler={() => useInhalerRef.current()}
              healProgress={healProgress}
              bombs={bombs}
              bombArmed={bombArmed}
              onThrowBomb={throwBomb}
              grenadeLabel={GRENADE_DEFS[grenadeKind].short}
              onCycleGrenade={cycleGrenade}
              walls={wallCharges}
              onThrowWall={throwShieldWall}
              onPing={() => placePingRef.current()}
              slots={slots}
              onDropWeapon={dropWeapon}
            />
          )}

          {!shopOpen && !paused && !settingsOpen && (() => {
            const hex = `#${power.color.toString(16).padStart(6, "0")}`;
            const ready = powerHud.cooldown === 0 && powerHud.active === 0;
            const charging = powerHud.active === 0 && powerHud.cooldown > 0;
            const pct = charging ? 1 - powerHud.cooldown / power.cooldown : 1;
            return (
              <div
                className="absolute bottom-[318px] left-7 z-20 flex flex-col items-center gap-1"
                style={{ transform: `scale(${hudScale})`, transformOrigin: "bottom left" }}
              >
                <button
                  type="button"
                  aria-label={`Use ${power.name}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    activatePowerRef.current();
                  }}
                  className="relative grid h-16 w-16 place-items-center rounded-full border backdrop-blur transition-transform active:scale-95"
                  style={{
                    borderColor: ready || powerHud.active > 0 ? hex : "var(--hud-line, rgba(255,255,255,0.25))",
                    background: `conic-gradient(${hex}55 ${pct * 360}deg, rgba(0,0,0,0.45) 0deg)`,
                    boxShadow: powerHud.active > 0 ? `0 0 18px ${hex}` : ready ? `0 0 10px ${hex}88` : "none",
                    opacity: charging ? 0.7 : 1,
                  }}
                >
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-black/70 text-center">
                    {powerHud.active > 0 ? (
                      <span className="text-lg font-bold" style={{ color: hex }}>
                        {powerHud.active}
                      </span>
                    ) : charging ? (
                      <span className="text-sm font-semibold text-white/80">{powerHud.cooldown}</span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: hex }}>
                        {power.name.slice(0, 5)}
                      </span>
                    )}
                  </span>
                </button>
                {powerHud.shield > 0 && (
                  <span className="rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white">
                    Shield {powerHud.shield}
                  </span>
                )}
              </div>
            );
          })()}

          {!shopOpen && (() => {
            const activeId = slots[activeSlot] ?? "deagle";
            const w = getWeapon(activeId);
            const cur = ammo[activeId];
            const mag = cur?.mag ?? 0;
            const reserve = cur?.reserve ?? 0;
            const magSize = getMagazine(activeId);
            const hasAmmo = magSize > 0;
            const empty = hasAmmo && mag === 0;
            const low = hasAmmo && mag > 0 && mag <= Math.max(1, Math.ceil(magSize * 0.25));
            return (
              <div className="pointer-events-none absolute bottom-[186px] right-5 flex flex-col items-end gap-1">
                <div
                  className={`flex items-baseline gap-2 rounded-md border px-3 py-1 backdrop-blur transition-colors ${
                    empty
                      ? "border-destructive bg-destructive/15"
                      : low
                        ? "border-[var(--hud-accent)]/70 bg-[var(--hud-panel)]/90"
                        : "border-border/60 bg-[var(--hud-panel)]/90"
                  }`}
                >
                  <span
                    className={`text-xl font-bold tabular-nums ${
                      empty ? "text-destructive animate-pulse" : low ? "text-[var(--hud-accent)]" : "text-foreground"
                    }`}
                  >
                    {mag}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">/ {reserve}</span>
                </div>
                {empty && !isReloading && (
                  <div className="animate-pulse rounded-md bg-destructive px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-destructive-foreground">
                    Reload
                  </div>
                )}
                {isReloading && (
                  <div className="rounded-md bg-[var(--hud-accent)]/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[var(--hud-accent-foreground)]">
                    Reloading… {reloadLeft.toFixed(1)}s
                  </div>
                )}
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  {w?.name ?? "Deagle"}
                </p>
              </div>
            );
          })()}


          {playerRespawn > 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/50">
              <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Eliminated</p>
              <p className="text-4xl font-bold text-foreground">Respawn in {playerRespawn}</p>
            </div>
          )}
          {match.phase !== "round" && match.phase !== "countdown" && match.phase !== "warmup" && (
            <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-background/70 p-4 backdrop-blur-md">
              <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-card/95 p-6 text-center shadow-[var(--shadow-hud)]">
                {(() => {
                  const winner = match.matchWinner ?? match.roundWinner;
                  const won = winner === "blue";
                  return (
                    <>
                      <p className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
                        {match.phase === "intermission" ? "Round over" : "Match over"}
                      </p>
                      {won ? (
                        <div className="mx-auto mt-3 w-fit rounded-md border-2 border-[#ffd76a] bg-gradient-to-b from-[#ffe9a8] to-[#e2a712] px-8 py-2.5 shadow-[0_0_40px_-8px_rgba(255,200,80,0.9)]">
                          <p className="text-3xl font-black uppercase tracking-[0.25em] text-[#4a2c00] sm:text-4xl">
                            Booyah
                          </p>
                        </div>
                      ) : (
                        <div className="mx-auto mt-3 w-fit rounded-md border-2 border-white/25 bg-gradient-to-b from-[#5b6068] to-[#2b2f35] px-8 py-2.5 shadow-[0_0_40px_-12px_rgba(0,0,0,0.9)]">
                          <p className="text-3xl font-black uppercase tracking-[0.25em] text-white/80 sm:text-4xl">
                            Defeat
                          </p>
                        </div>
                      )}
                      <p className="mt-4 text-2xl font-semibold tabular-nums text-foreground">
                        {match.blue} – {match.red}
                      </p>
                      <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl border border-border/60 bg-secondary/40 p-3">
                        <div>
                          <p className="text-xl font-bold tabular-nums text-foreground">{playerStatsHud.kills}</p>
                          <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Kills</p>
                        </div>
                        <div>
                          <p className="text-xl font-bold tabular-nums text-foreground">{playerStatsHud.deaths}</p>
                          <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Deaths</p>
                        </div>
                        <div>
                          <p className="text-xl font-bold tabular-nums text-foreground">{playerStatsHud.headshots}</p>
                          <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Headshots</p>
                        </div>
                        <div>
                          <p className="text-xl font-bold tabular-nums text-foreground">
                            {playerStatsHud.deaths === 0 ? playerStatsHud.kills : (playerStatsHud.kills / Math.max(1, playerStatsHud.deaths)).toFixed(2)}
                          </p>
                          <p className="text-[9px] uppercase tracking-widest text-muted-foreground">K/D</p>
                        </div>
                        <div>
                          <p className="text-xl font-bold tabular-nums text-foreground">{match.round}</p>
                          <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Rounds</p>
                        </div>
                      </div>
                      {match.countdown > 0 && (
                        <p className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">
                          {match.phase === "matchEnd" ? "Next match" : "Next round"} in {match.countdown}
                        </p>
                      )}
                      <button
                        onClick={enterWalk}
                        className="mt-5 w-full rounded-xl bg-[var(--hud-accent)] px-6 py-3 text-xs font-black uppercase tracking-[0.2em] text-[var(--hud-accent-foreground)] shadow-[var(--shadow-hud)] transition hover:brightness-110 active:scale-95"
                      >
                        Play again
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </>
      )}




      {/* killfeed */}
      {settings.showKillFeed && killFeed.length > 0 && (
        <div className="pointer-events-none absolute right-4 top-[152px] flex max-w-xs flex-col gap-1 sm:right-5 sm:top-[158px]">
          {killFeed.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-card/80 px-3 py-1.5 text-xs text-foreground backdrop-blur"
            >
              <Skull className="h-3 w-3 text-muted-foreground" />
              <span className={item.killerTeam === "blue" ? "text-[#3f8fff]" : "text-[#ff3b1f]"}>
                {item.killer}
              </span>
              <span className="text-muted-foreground">{item.weapon}</span>
              <span className={item.victimTeam === "blue" ? "text-[#3f8fff]" : "text-[#ff3b1f]"}>
                {item.victim}
              </span>
            </div>
          ))}
        </div>
      )}

      {(leaderboard || orbitLeaderboard) && (
        <div className="pointer-events-none absolute left-3 top-[130px] max-w-xs rounded-lg border border-border/60 bg-card/80 p-3 backdrop-blur sm:left-4 sm:top-[136px]">
          <p className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground">Leaderboard</p>
          <div className="mt-2 space-y-1 text-xs">
            {Object.entries((leaderboard ?? orbitLeaderboard)!.totals).map(([team, t]) => (
              <div key={team} className="flex justify-between gap-4">
                <span className={team === "blue" ? "text-[#3f8fff]" : "text-[#ff3b1f]"}>
                  {team === "blue" ? "Blue" : "Red"}
                </span>
                <span className="tabular-nums text-foreground">
                  {t.wins}W {t.losses}L · {t.kills}K {t.deaths}D
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* scoreboard */}
      {hud.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 sm:top-3">
          <div className="flex items-stretch overflow-hidden rounded-[3px] shadow-[0_0_18px_-6px_rgba(0,0,0,0.95)]">
            <div
              className="flex min-w-12 items-center justify-center bg-gradient-to-b from-[#2f7dfd] to-[#1147a8] px-3 py-0.5 text-base font-extrabold tabular-nums text-white"
              style={{ clipPath: "polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%)" }}
            >
              {score.blue}
            </div>
            <div className="flex flex-col items-center justify-center bg-black/80 px-4 py-0.5 text-center backdrop-blur">
              <span className="text-[11px] font-bold tabular-nums leading-tight text-[#ffd45e]">
                {String(Math.floor(match.countdown / 60)).padStart(2, "0")}:
                {String(match.countdown % 60).padStart(2, "0")}
              </span>
              <span className="text-[7px] uppercase tracking-[0.25em] text-white/55">
                R{match.round} · {hud.filter((f) => f.team === "blue" && f.alive).length}v
                {hud.filter((f) => f.team === "red" && f.alive).length}
              </span>
            </div>
            <div
              className="flex min-w-12 items-center justify-center bg-gradient-to-b from-[#ff8a3d] to-[#c93a10] px-3 py-0.5 text-base font-extrabold tabular-nums text-white"
              style={{ clipPath: "polygon(8px 0, 100% 0, 100% 100%, 0 100%)" }}
            >
              {score.red}
            </div>
          </div>

          {/* objective / progress ribbon under the score, as in the reference HUD */}
          <div className="relative mx-auto mt-1.5 h-4 w-[280px] overflow-hidden rounded-[2px] border border-[#e0b64a]/60 bg-black/70 sm:w-[340px]">
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#8c6a12] via-[#e9c34f] to-[#8c6a12] transition-all duration-300"
              style={{ width: `${Math.min(100, (score.blue / matchConfig.roundsToWinMatch) * 100)}%` }}
            />
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold uppercase tracking-[0.3em] text-white/90 drop-shadow">
              Victory
            </span>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute left-3 top-1/2 z-20 -translate-y-1/2">
        <div className="pointer-events-auto flex flex-col items-start gap-2">
          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                const next = !settings.muted;
                setSettings((prev) => ({ ...prev, muted: next }));
                setMuted(next);
              }}
              className="rounded-lg border border-border bg-card/70 p-2 text-muted-foreground backdrop-blur transition-colors hover:bg-secondary"
              aria-label={muted ? "Unmute audio" : "Mute audio"}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button
              onClick={() => {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen?.().catch(() => {});
                } else {
                  document.exitFullscreen?.().catch(() => {});
                }
              }}
              className="rounded-lg border border-border bg-card/70 p-2 text-muted-foreground backdrop-blur transition-colors hover:bg-secondary"
              aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
          {settings.showFps && <FpsCounter />}
          {showDebug && (
            <div className="flex flex-col items-stretch gap-2 rounded-lg border border-border/60 bg-card/85 p-3 backdrop-blur">

              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Debug</p>
              <button
                onClick={() => setShowRoof((v) => !v)}
                className="rounded-md border border-border bg-card/80 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-foreground transition-colors hover:bg-secondary"
              >
                {showRoof ? "Hide roof" : "Show roof"}
              </button>
              <button
                onClick={() => setMode((m) => (m === "orbit" ? "walk" : "orbit"))}
                className="rounded-md border border-border bg-card/80 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-foreground transition-colors hover:bg-secondary"
              >
                {mode === "orbit" ? "Ground view" : "Orbit view"}
              </button>
              <button
                onClick={enterWalk}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Restart match
              </button>
            </div>
          )}
          <button
            onClick={() => setShowDebug((v) => !v)}
            className="rounded-lg border border-border bg-card/70 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground backdrop-blur transition-colors hover:bg-secondary"
          >
            {showDebug ? "Close debug" : "Debug (`)"}
          </button>
        </div>
      </div>

      {settingsOpen && (
        <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

/** Lightweight FPS readout, mounted only when the player enables it in settings. */
function FpsCounter() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="pointer-events-none rounded-md border border-border/60 bg-card/85 px-2 py-1 text-[10px] font-bold tabular-nums text-foreground backdrop-blur">
      {fps} FPS
    </div>
  );
}
