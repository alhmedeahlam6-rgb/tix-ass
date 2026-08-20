import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Play, Settings, Swords, Map as MapIcon, Zap, Users, UserCircle, Store, LayoutGrid, PawPrint, Shirt, Crosshair } from "lucide-react";

import BrandMark from "./BrandMark";
import SettingsPanel from "./SettingsPanel";
import ProfileCard from "./ProfileCard";
import StorePanel from "./StorePanel";
import CapsuleViewer from "./CapsuleViewer";
import CharacterPicker from "./CharacterPicker";
import LoadoutPanel from "./LoadoutPanel";
import PetPicker from "./PetPicker";
import VaultPanel from "./VaultPanel";
import ArmoryPanel from "./ArmoryPanel";
import { defaultCharacter, loadCharacter, saveCharacter, type ArenaCharacter } from "./characters";
import { defaultSettings, loadSettings, saveSettings, type ArenaSettings } from "./settings";
import { arenaAssets, preloadAll } from "./preload";
import { initKeyboardLayout } from "./keyboardLayout";
import ModeSelect from "./ModeSelect";
import { type MapId } from "./maps";
import { DEFAULT_MODE, DEFAULT_MATCH_TYPE, type GameMode, type MatchType } from "./modes";
import { loadProfile, saveProfile, levelFromProfile, type PlayerProfile } from "./playerProfile";
import { saveLoadout } from "./skills";
import { savePet } from "./pets";
import keyArt from "@/assets/splash-key-art.jpg";
import lobbyBackdrop from "@/assets/lobby-backdrop.jpg";

const LoneWolfArena = lazy(() => import("./LoneWolfArena"));

type Phase = "boot" | "lobby" | "deploy" | "play";

const DEPLOY_TIPS = [
  "Gloo walls buy you a second — place one, then reposition.",
  "Headshots hit for double. Slow down, then squeeze.",
  "Buy phase: press B to open the armory between rounds.",
  "Two heavies and a sidearm. Choose the pair that covers every range.",
  "Auto-fire is great on phones — turn it on in Settings > Gameplay.",
  "Low on frames? Switch Quality to Low in Settings > Video.",
];

function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="w-full">
      <div className="h-[4px] w-full overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%`, background: "var(--gradient-hud)" }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[9px] uppercase tracking-[0.35em] text-muted-foreground">
        <span>{value >= 1 ? "Assets cached" : "Streaming assets"}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
    </div>
  );
}

export default function GameShell() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState("Contacting arena");
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<ArenaSettings>(() => defaultSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [character, setCharacter] = useState<ArenaCharacter>(() => defaultCharacter());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadoutOpen, setLoadoutOpen] = useState(false);
  const [petOpen, setPetOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [armoryOpen, setArmoryOpen] = useState(false);
  const [arenaReady, setArenaReady] = useState(false);
  const [tip, setTip] = useState(0);
  const [mapId, setMapId] = useState<MapId>("frostline");
  const [mapOpen, setMapOpen] = useState(false);
  const [profile, setProfile] = useState<PlayerProfile>(() => loadProfile());
  const [profileOpen, setProfileOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const deployStart = useRef(0);

  useEffect(() => setSettings(loadSettings()), []);
  useEffect(() => void initKeyboardLayout(), []);
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => setCharacter(loadCharacter()), []);
  useEffect(() => saveProfile(profile), [profile]);

  /** splash 1 — stream every asset before the lobby is offered */
  useEffect(() => {
    let alive = true;
    preloadAll(arenaAssets([keyArt, lobbyBackdrop]), (p, l) => {
      if (!alive) return;
      setProgress(p);
      setLabel(l);
    }).then(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== "deploy") return;
    const id = window.setInterval(() => setTip((t) => (t + 1) % DEPLOY_TIPS.length), 3200);
    return () => window.clearInterval(id);
  }, [phase]);

  /** splash 3 holds until the map is built, with a short minimum so it never flickers */
  useEffect(() => {
    if (phase !== "deploy" || !arenaReady) return;
    const wait = Math.max(0, 1400 - (performance.now() - deployStart.current));
    const id = window.setTimeout(() => setPhase("play"), wait);
    return () => window.clearTimeout(id);
  }, [phase, arenaReady]);

  const deploy = useCallback((id: MapId) => {
    setMapId(id);
    setMapOpen(false);
    deployStart.current = performance.now();
    setArenaReady(false);
    setPhase("deploy");
  }, []);

  const backToLobby = useCallback(() => {
    setArenaReady(false);
    setPhase("lobby");
  }, []);

  const mountArena = phase === "deploy" || phase === "play";

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {/* ---------- the game itself ---------- */}
      {mountArena && (
        <div className={phase === "play" ? "h-full w-full" : "h-full w-full opacity-0"}>
          <Suspense fallback={null}>
            <LoneWolfArena key={deployStart.current} mapId={mapId} profile={profile} onProfileChange={setProfile} onReady={() => setArenaReady(true)} onExit={backToLobby} />
          </Suspense>
        </div>
      )}

      {/* ---------- splash 1 : boot ---------- */}
      {phase === "boot" && (
        <div className="absolute inset-0 z-50">
          <img
            src={keyArt}
            alt="Ironhowl arena key art"
            width={1920}
            height={1088}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(4,7,12,0.15)_20%,rgba(4,7,12,0.92)_92%)]" />
          <div className="absolute inset-0 flex flex-col items-center justify-between px-8 py-10 text-center sm:py-14">
            <div />
            <div className="flex flex-col items-center gap-8">
              <BrandMark />
              {loaded ? (
                <button
                  type="button"
                  onClick={() => setPhase("lobby")}
                  className="rounded-full border border-[var(--hud-accent)]/60 bg-background/40 px-12 py-3 text-[11px] font-bold uppercase tracking-[0.5em] text-foreground backdrop-blur transition hover:bg-[var(--hud-accent)] hover:text-[var(--hud-accent-foreground)] active:scale-95"
                >
                  Enter arena
                </button>
              ) : (
                <p className="animate-pulse text-[10px] uppercase tracking-[0.5em] text-muted-foreground">
                  {label}
                </p>
              )}
            </div>
            <div className="w-full max-w-md">
              <ProgressBar value={progress} />
              {loaded && (
                <p className="mt-3 text-center text-[10px] uppercase tracking-[0.35em] text-[var(--hud-accent)]">
                  Tap Enter to start
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------- lobby ---------- */}
      {phase === "lobby" && (
        <div className="absolute inset-0 z-40 overflow-hidden">
          <img
            src={lobbyBackdrop}
            alt="Ironhowl lobby hangar"
            width={1920}
            height={1088}
            className="h-full w-full scale-105 object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(4,7,12,0.96)_3%,rgba(4,7,12,0.15)_55%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,color-mix(in_oklab,var(--hud-accent)_18%,transparent),transparent_60%)]" />

          {/* character — placeholder capsule, drag left/right to turn */}
          <CapsuleViewer
            character={character}
            className="absolute bottom-[4%] left-1/2 h-[80%] w-[min(34rem,80vw)] -translate-x-1/2"
          />
          <div className="pointer-events-none absolute bottom-[4%] left-1/2 -translate-x-1/2 text-center">
            <p className="text-sm font-black uppercase tracking-[0.35em] text-foreground">{character.name}</p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.3em] text-muted-foreground">{character.tagline}</p>
          </div>
          <div className="pointer-events-none absolute bottom-[6%] left-1/2 h-24 w-[26rem] max-w-[70vw] -translate-x-1/2 rounded-[50%] bg-[var(--hud-accent)]/15 blur-3xl" />

          {/* brand, top-left */}
          <div className="absolute left-6 top-6 text-left sm:left-10 sm:top-8">
            <p className="text-2xl font-black uppercase tracking-[0.3em] text-foreground sm:text-3xl">
              Iron<span className="text-[var(--hud-accent)]">howl</span>
            </p>
            <div className="mt-2 h-px w-40" style={{ background: "var(--gradient-hud)" }} />
            <p className="mt-2 text-[9px] uppercase tracking-[0.45em] text-muted-foreground">
              Frostline Arena · Season 01
            </p>
          </div>

          {/* profile widget, top-right */}
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="absolute right-6 top-6 flex items-center gap-3 rounded-2xl border border-border/50 bg-card/60 px-4 py-3 text-left backdrop-blur-md transition hover:bg-card active:scale-95 sm:right-10 sm:top-8"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--hud-accent)]/15 text-[var(--hud-accent)]">
              <UserCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-foreground">{profile.name}</p>
              <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.2em] text-[var(--hud-accent)]">
                Lvl {levelFromProfile(profile)} · {profile.gold} Gold · {profile.diamonds} Diamonds
              </p>
            </div>
          </button>

          {/* left rail: what's live / what's coming */}
          <div className="absolute left-6 top-1/2 hidden w-56 -translate-y-1/2 flex-col gap-3 sm:left-10 sm:flex">
            {[
              { icon: Swords, title: "2v2 Duel", sub: "Live" },
              { icon: MapIcon, title: "4v4 Squad", sub: "Live" },
              { icon: Zap, title: "New modes", sub: "Coming soon" },
            ].map(({ icon: Icon, title, sub }) => (
              <div
                key={title}
                className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/40 px-4 py-3 backdrop-blur-md"
              >
                <Icon className="h-4 w-4 text-[var(--hud-accent)]" />
                <div className="text-left">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-foreground">{title}</p>
                  <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground">{sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* bottom-right: settings + play */}
          <div className="absolute bottom-8 right-6 flex flex-col items-end gap-4 sm:bottom-10 sm:right-10">
            <label className="flex cursor-pointer items-center gap-3 rounded-full border border-border/50 bg-card/50 px-4 py-2 backdrop-blur-md transition hover:bg-card/70">
              <input
                type="checkbox"
                checked={settings.quickMatch}
                onChange={(e) => setSettings((s) => ({ ...s, quickMatch: e.target.checked }))}
                className="h-3.5 w-3.5 accent-[var(--hud-accent)]"
              />
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground">Quick match</span>
            </label>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setLoadoutOpen(true)}
                className="flex h-12 items-center gap-2 rounded-2xl border border-border/60 bg-card/60 px-4 text-foreground backdrop-blur-md transition hover:bg-card active:scale-95"
              >
                <LayoutGrid className="h-4 w-4 text-[var(--hud-accent)]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.25em]">Loadout</span>
              </button>
              <button
                type="button"
                onClick={() => setPetOpen(true)}
                className="flex h-12 items-center gap-2 rounded-2xl border border-border/60 bg-card/60 px-4 text-foreground backdrop-blur-md transition hover:bg-card active:scale-95"
              >
                <PawPrint className="h-4 w-4 text-[var(--hud-accent)]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.25em]">Pet</span>
              </button>
              <button
                type="button"
                onClick={() => setVaultOpen(true)}
                className="flex h-12 items-center gap-2 rounded-2xl border border-border/60 bg-card/60 px-4 text-foreground backdrop-blur-md transition hover:bg-card active:scale-95"
              >
                <Shirt className="h-4 w-4 text-[var(--hud-accent)]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.25em]">Vault</span>
              </button>
              <button
                type="button"
                onClick={() => setArmoryOpen(true)}
                className="flex h-12 items-center gap-2 rounded-2xl border border-border/60 bg-card/60 px-4 text-foreground backdrop-blur-md transition hover:bg-card active:scale-95"
              >
                <Crosshair className="h-4 w-4 text-[var(--hud-accent)]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.25em]">Armory</span>
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                className="flex h-14 items-center gap-3 rounded-2xl border border-border/60 bg-card/60 px-5 text-foreground backdrop-blur-md transition hover:bg-card active:scale-95"
              >
                <UserCircle className="h-5 w-5 text-[var(--hud-accent)]" />
                <span className="text-[11px] font-bold uppercase tracking-[0.3em]">Profile</span>
              </button>
              <button
                type="button"
                onClick={() => setStoreOpen(true)}
                className="flex h-14 items-center gap-3 rounded-2xl border border-border/60 bg-card/60 px-5 text-foreground backdrop-blur-md transition hover:bg-card active:scale-95"
              >
                <Store className="h-5 w-5 text-[var(--hud-accent)]" />
                <span className="text-[11px] font-bold uppercase tracking-[0.3em]">Store</span>
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex h-14 items-center gap-3 rounded-2xl border border-border/60 bg-card/60 px-5 text-foreground backdrop-blur-md transition hover:bg-card active:scale-95"
              >
                <Users className="h-5 w-5 text-[var(--hud-accent)]" />
                <span className="text-[11px] font-bold uppercase tracking-[0.3em]">Characters</span>
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-card/60 text-foreground backdrop-blur-md transition hover:bg-card active:scale-95"
              >
                <Settings className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setMapOpen(true)}
                className="group flex h-14 items-center gap-4 rounded-2xl bg-[var(--hud-accent)] pl-8 pr-6 text-[var(--hud-accent-foreground)] shadow-[var(--shadow-hud)] transition hover:brightness-110 active:scale-95"
              >
                <span className="text-sm font-black uppercase tracking-[0.4em]">Play</span>
                <Play className="h-5 w-5 fill-current transition group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- splash 3 : deploying ---------- */}
      {phase === "deploy" && (
        <div className="absolute inset-0 z-50">
          <img
            src={keyArt}
            alt=""
            width={1920}
            height={1088}
            className="h-full w-full scale-110 object-cover opacity-60 blur-[2px]"
          />
          <div className="absolute inset-0 bg-[rgba(4,7,12,0.82)]" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-10 px-8 text-center">
            <BrandMark size="sm" />
            <div className="w-full max-w-sm">
              <p className="text-[10px] uppercase tracking-[0.5em] text-[var(--hud-accent)]">
                {arenaReady ? "Arena ready" : "Building the arena"}
              </p>
              <div className="mt-5">
                <ProgressBar value={arenaReady ? 1 : 0.72} />
              </div>
              <p className="mt-6 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
                {DEPLOY_TIPS[tip]}
              </p>
              {arenaReady && (
                <p className="mt-3 text-[10px] uppercase tracking-[0.35em] text-[var(--hud-accent)]">
                  Dropping in…
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {mapOpen && phase === "lobby" && (
        <MapSelect onSelect={deploy} onClose={() => setMapOpen(false)} />
      )}

      {settingsOpen && (
        <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
      )}

      {profileOpen && (
        <ProfileCard profile={profile} onChange={setProfile} onClose={() => setProfileOpen(false)} />
      )}

      {storeOpen && (
        <StorePanel profile={profile} onChange={setProfile} onClose={() => setStoreOpen(false)} />
      )}

      {pickerOpen && (
        <CharacterPicker
          selected={character}
          profile={profile}
          onSelect={(c) => {
            setCharacter(c);
            saveCharacter(c.id);
            const nextLoadout = { ...profile.loadout, active: c.power };
            setProfile((p) => ({ ...p, loadout: nextLoadout }));
            saveLoadout(nextLoadout);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {loadoutOpen && (
        <LoadoutPanel
          loadout={profile.loadout}
          characterPowerId={character.power}
          onChange={(l) => {
            setProfile((p) => ({ ...p, loadout: l }));
            saveLoadout(l);
          }}
          onClose={() => setLoadoutOpen(false)}
        />
      )}

      {petOpen && (
        <PetPicker
          selected={profile.pet}
          profile={profile}
          onSelect={(id) => {
            setProfile((p) => ({ ...p, pet: id }));
            savePet(id);
          }}
          onClose={() => setPetOpen(false)}
        />
      )}

      {vaultOpen && <VaultPanel profile={profile} onClose={() => setVaultOpen(false)} />}
      {armoryOpen && <ArmoryPanel profile={profile} onClose={() => setArmoryOpen(false)} onChange={(next) => { setProfile(next); saveProfile(next); }} />}
    </div>
  );
}
