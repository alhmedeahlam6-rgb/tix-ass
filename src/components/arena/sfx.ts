/**
 * Arena sound engine.
 *
 * Design goals:
 *  - **Zero lag.** Every sample is fetched once, decoded once into an
 *    AudioBuffer and then played through throw-away BufferSource nodes.
 *    Playing a sound costs a few microseconds and allocates nothing but a
 *    tiny node, so the render loop can never stall on audio.
 *  - **Never silent while loading.** A set of procedurally synthesised
 *    buffers is built instantly at init and used until the real samples
 *    finish downloading in the background.
 *  - **Bounded voices.** Hard caps on total concurrent voices and per-kind
 *    retrigger rate keep long full-auto bursts from stacking into mush or
 *    eating CPU.
 */

import rifleUrl from "@/assets/sfx/rifle.mp3?url";
import carbineUrl from "@/assets/sfx/carbine.mp3?url";
import smgUrl from "@/assets/sfx/smg.mp3?url";
import mgUrl from "@/assets/sfx/mg.mp3?url";
import shotgunUrl from "@/assets/sfx/shotgun.mp3?url";
import sniperUrl from "@/assets/sfx/sniper.mp3?url";
import pistolUrl from "@/assets/sfx/pistol.mp3?url";
import deagleUrl from "@/assets/sfx/deagle.mp3?url";
import knifeUrl from "@/assets/sfx/knife.mp3?url";
import hitUrl from "@/assets/sfx/hit.mp3?url";
import killUrl from "@/assets/sfx/kill.mp3?url";
import spawnUrl from "@/assets/sfx/spawn.mp3?url";
import reloadUrl from "@/assets/sfx/reload.mp3?url";
import pumpUrl from "@/assets/sfx/pump.mp3?url";
import dryfireUrl from "@/assets/sfx/dryfire.mp3?url";
import victoryUrl from "@/assets/sfx/victory.mp3?url";
import step1Url from "@/assets/sfx/step1.mp3?url";
import step2Url from "@/assets/sfx/step2.mp3?url";
import step3Url from "@/assets/sfx/step3.mp3?url";
import step4Url from "@/assets/sfx/step4.mp3?url";
import steprunUrl from "@/assets/sfx/steprun.mp3?url";
import steprun2Url from "@/assets/sfx/steprun2.mp3?url";
import buyUrl from "@/assets/sfx/buy.mp3?url";
import jumpUrl from "@/assets/sfx/jump.mp3?url";
import landUrl from "@/assets/sfx/land.mp3?url";
import hurtUrl from "@/assets/sfx/hurt.mp3?url";
import hurt2Url from "@/assets/sfx/hurt2.mp3?url";
import deathUrl from "@/assets/sfx/death.mp3?url";
import adsUrl from "@/assets/sfx/ads.mp3?url";
import equipUrl from "@/assets/sfx/equip.mp3?url";
import medkitUrl from "@/assets/sfx/medkit.mp3?url";

export type Kind =
  | "rifle"
  | "carbine"
  | "smg"
  | "shotgun"
  | "sniper"
  | "mg"
  | "pistol"
  | "deagle"
  | "knife"
  | "hit"
  | "kill"
  | "spawn"
  | "reload"
  | "pump"
  | "dryfire"
  | "victory"
  | "step1"
  | "step2"
  | "step3"
  | "step4"
  | "steprun"
  | "steprun2"
  | "buy"
  | "jump"
  | "land"
  | "hurt"
  | "hurt2"
  | "death"
  | "ads"
  | "equip"
  | "medkit";

const SOURCES: Record<Kind, string> = {
  rifle: rifleUrl,
  carbine: carbineUrl,
  smg: smgUrl,
  mg: mgUrl,
  shotgun: shotgunUrl,
  sniper: sniperUrl,
  pistol: pistolUrl,
  deagle: deagleUrl,
  knife: knifeUrl,
  hit: hitUrl,
  kill: killUrl,
  spawn: spawnUrl,
  reload: reloadUrl,
  pump: pumpUrl,
  dryfire: dryfireUrl,
  victory: victoryUrl,
  step1: step1Url,
  step2: step2Url,
  step3: step3Url,
  step4: step4Url,
  steprun: steprunUrl,
  steprun2: steprun2Url,
  buy: buyUrl,
  jump: jumpUrl,
  land: landUrl,
  hurt: hurtUrl,
  hurt2: hurt2Url,
  death: deathUrl,
  ads: adsUrl,
  equip: equipUrl,
  medkit: medkitUrl,
};

/** Minimum gap between two plays of the same kind (seconds of wall time, ms). */
const RETRIGGER_MS: Partial<Record<Kind, number>> = {
  rifle: 45,
  carbine: 40,
  smg: 32,
  mg: 34,
  shotgun: 120,
  sniper: 180,
  pistol: 60,
  deagle: 90,
  hit: 40,
  dryfire: 90,
  victory: 4000,
  step1: 130,
  step2: 130,
  step3: 130,
  step4: 130,
  steprun: 110,
  steprun2: 110,
  buy: 60,
  jump: 180,
  land: 200,
  hurt: 260,
  hurt2: 260,
  death: 500,
  ads: 120,
  equip: 120,
};

const MAX_VOICES = 22;
/** user-adjustable master level (0..1), see settings.ts */
let MASTER_GAIN = 0.5;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let comp: DynamicsCompressorNode | null = null;
let muted = false;
let loadStarted = false;
let voices = 0;
const buffers = new Map<Kind, AudioBuffer>();
const lastPlayed = new Map<Kind, number>();

/* ------------------------------------------------------------------ */
/* Instant procedural fallbacks (used until the samples land)          */
/* ------------------------------------------------------------------ */

function noiseShot(
  c: AudioContext,
  o: { dur: number; decay: number; lowStart: number; lowEnd: number; tone: number; toneEnd: number; gain: number },
) {
  const rate = c.sampleRate;
  const len = Math.max(1, Math.floor(o.dur * rate));
  const buf = c.createBuffer(1, len, rate);
  const data = buf.getChannelData(0);
  let lp = 0;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const env = Math.pow(1 - t, o.decay);
    const n = Math.random() * 2 - 1;
    lp += (n - lp) * (o.lowStart + (o.lowEnd - o.lowStart) * t);
    phase += ((o.tone + (o.toneEnd - o.tone) * t) * Math.PI * 2) / rate;
    data[i] = Math.tanh((lp * 1.6 + Math.sin(phase) * 0.55) * env * o.gain * 1.4);
  }
  return buf;
}

function metallic(c: AudioContext, dur: number, f0: number, f1: number, gain: number) {
  const rate = c.sampleRate;
  const len = Math.floor(dur * rate);
  const buf = c.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  let p0 = 0;
  let p1 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const env = Math.pow(1 - t, 3);
    p0 += (f0 * Math.PI * 2) / rate;
    p1 += (f1 * Math.PI * 2) / rate;
    d[i] = (Math.sin(p0) * 0.6 + Math.sin(p1) * 0.4 + (Math.random() * 2 - 1) * 0.15) * env * gain;
  }
  return buf;
}

function buildFallbacks(c: AudioContext) {
  const set = (k: Kind, b: AudioBuffer) => {
    if (!buffers.has(k)) buffers.set(k, b);
  };
  set("pistol", noiseShot(c, { dur: 0.2, decay: 4, lowStart: 0.55, lowEnd: 0.1, tone: 220, toneEnd: 70, gain: 0.9 }));
  set("deagle", noiseShot(c, { dur: 0.28, decay: 3, lowStart: 0.45, lowEnd: 0.08, tone: 170, toneEnd: 55, gain: 1 }));
  set("rifle", noiseShot(c, { dur: 0.24, decay: 3.4, lowStart: 0.7, lowEnd: 0.12, tone: 180, toneEnd: 55, gain: 1 }));
  set("carbine", noiseShot(c, { dur: 0.2, decay: 3.8, lowStart: 0.75, lowEnd: 0.16, tone: 210, toneEnd: 70, gain: 0.95 }));
  set("smg", noiseShot(c, { dur: 0.14, decay: 5, lowStart: 0.85, lowEnd: 0.25, tone: 300, toneEnd: 110, gain: 0.75 }));
  set("mg", noiseShot(c, { dur: 0.2, decay: 3.2, lowStart: 0.6, lowEnd: 0.14, tone: 150, toneEnd: 48, gain: 1 }));
  set("shotgun", noiseShot(c, { dur: 0.42, decay: 2.4, lowStart: 0.4, lowEnd: 0.06, tone: 120, toneEnd: 38, gain: 1.05 }));
  set("sniper", noiseShot(c, { dur: 0.6, decay: 2, lowStart: 0.5, lowEnd: 0.05, tone: 140, toneEnd: 42, gain: 1.1 }));
  set("knife", metallic(c, 0.18, 1400, 2300, 0.35));
  set("hit", metallic(c, 0.09, 900, 1600, 0.3));
  set("kill", metallic(c, 0.3, 520, 780, 0.3));
  set("reload", metallic(c, 0.16, 620, 1100, 0.3));
  set("pump", metallic(c, 0.2, 700, 1500, 0.3));
  set("dryfire", metallic(c, 0.07, 1200, 2100, 0.25));
  set("victory", metallic(c, 1.2, 330, 494, 0.25));
  set("spawn", noiseShot(c, { dur: 0.9, decay: 1.6, lowStart: 0.08, lowEnd: 0.5, tone: 90, toneEnd: 420, gain: 0.6 }));
  // movement / body fallbacks — replaced by the real samples once they land
  const step = (f: number) => noiseShot(c, { dur: 0.12, decay: 5, lowStart: 0.5, lowEnd: 0.9, tone: f, toneEnd: f * 0.5, gain: 0.35 });
  set("step1", step(150));
  set("step2", step(170));
  set("step3", step(135));
  set("step4", step(185));
  set("steprun", step(120));
  set("steprun2", step(112));
  set("buy", metallic(c, 0.3, 880, 1320, 0.3));
  set("jump", noiseShot(c, { dur: 0.16, decay: 4, lowStart: 0.3, lowEnd: 0.8, tone: 200, toneEnd: 90, gain: 0.4 }));
  set("land", noiseShot(c, { dur: 0.22, decay: 3, lowStart: 0.2, lowEnd: 0.6, tone: 110, toneEnd: 45, gain: 0.5 }));
  set("hurt", noiseShot(c, { dur: 0.3, decay: 3, lowStart: 0.25, lowEnd: 0.35, tone: 165, toneEnd: 120, gain: 0.4 }));
  set("hurt2", noiseShot(c, { dur: 0.34, decay: 2.6, lowStart: 0.22, lowEnd: 0.3, tone: 140, toneEnd: 100, gain: 0.45 }));
  set("death", noiseShot(c, { dur: 0.7, decay: 2.2, lowStart: 0.2, lowEnd: 0.28, tone: 130, toneEnd: 70, gain: 0.5 }));
  set("ads", metallic(c, 0.07, 1800, 2600, 0.2));
  set("equip", metallic(c, 0.22, 800, 1500, 0.28));
}

/* ------------------------------------------------------------------ */
/* Sample loading                                                      */
/* ------------------------------------------------------------------ */

async function loadOne(c: AudioContext, kind: Kind, url: string) {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return;
    const data = await res.arrayBuffer();
    const buf = await c.decodeAudioData(data);
    buffers.set(kind, buf); // replaces the fallback
  } catch {
    /* keep the procedural fallback */
  }
}

function loadSamples(c: AudioContext) {
  if (loadStarted) return;
  loadStarted = true;
  // Guns first so the very first trigger is already the real thing, then the
  // rest. Requests are tiny (~10 KB each) and fully parallel.
  const order: Kind[] = [
    "rifle",
    "pistol",
    "deagle",
    "smg",
    "mg",
    "shotgun",
    "sniper",
    "carbine",
    "knife",
    "hit",
    "kill",
    "reload",
    "pump",
    "dryfire",
    "spawn",
    "victory",
    "step1",
    "step2",
    "step3",
    "step4",
    "steprun",
    "steprun2",
    "buy",
    "jump",
    "land",
    "hurt",
    "hurt2",
    "death",
    "ads",
    "equip",
  ];
  for (const k of order) void loadOne(c, k, SOURCES[k]);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Must be called from a user gesture (click / keypress). Safe to call often. */
export function initSfx() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  const Ctor: typeof AudioContext | undefined =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor({ latencyHint: "interactive" });
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_GAIN;
  // Glue compressor: keeps overlapping full-auto shots punchy instead of clipping.
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 22;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.16;
  master.connect(comp);
  comp.connect(ctx.destination);
  buildFallbacks(ctx);
  loadSamples(ctx);
}

/** Preload+decode without a gesture is not possible, but the bytes can be warmed. */
export function warmSfx() {
  if (typeof window === "undefined") return;
  for (const url of Object.values(SOURCES)) void fetch(url, { cache: "force-cache" }).catch(() => {});
}

/**
 * @param volume  0..1 linear gain
 * @param detune  playback-rate offset, e.g. 0.03 = +3% pitch
 */
export function playSfx(kind: Kind, volume = 1, detune = 0) {
  if (!ctx || !master || muted || volume <= 0.004) return;
  const buf = buffers.get(kind);
  if (!buf) return;

  const now = performance.now();
  const gap = RETRIGGER_MS[kind] ?? 0;
  if (gap > 0 && now - (lastPlayed.get(kind) ?? -1e9) < gap) return;
  if (voices >= MAX_VOICES) return;
  lastPlayed.set(kind, now);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.max(0.5, 1 + detune);
  const g = ctx.createGain();
  g.gain.value = Math.min(1, volume);
  src.connect(g);
  g.connect(master);
  voices++;
  src.onended = () => {
    voices--;
    src.disconnect();
    g.disconnect();
  };
  src.start();
}

/**
 * One-shot that can be stopped early (channelled actions such as the medkit).
 * Bypasses the retrigger gate and returns a stop function, or null when the
 * sample is not ready yet.
 */
export function playSfxStoppable(kind: Kind, volume = 1): (() => void) | null {
  if (!ctx || !master || muted) return null;
  const buf = buffers.get(kind);
  if (!buf) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = Math.min(1, volume);
  src.connect(g);
  g.connect(master);
  voices++;
  let done = false;
  src.onended = () => {
    if (done) return;
    done = true;
    voices--;
    src.disconnect();
    g.disconnect();
  };
  src.start();
  return () => {
    if (done) return;
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
  };
}

/**
 * Distance-attenuated one-shot — used for other fighters' guns so the arena
 * has depth without a full 3D panner graph per shot.
 */
export function playSfxAt(kind: Kind, distance: number, baseVolume = 1, detune = 0) {
  const falloff = 1 / (1 + (distance / 14) ** 1.6);
  const v = baseVolume * falloff;
  if (v < 0.02) return; // inaudible — skip the work entirely
  playSfx(kind, v, detune + (distance > 40 ? -0.03 : 0));
}

/**
 * Victory stinger. It must be heard, so it bypasses the voice cap and the
 * retrigger gate, resumes a suspended context first, and falls back to a plain
 * <audio> element if the sample has not been decoded yet.
 */
export function playVictory(volume = 0.9) {
  if (muted) return;
  if (ctx && ctx.state === "suspended") void ctx.resume();
  const buf = buffers.get("victory");
  if (ctx && master && buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = Math.min(1, volume);
    src.connect(g);
    g.connect(master);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
    src.start();
    return;
  }
  try {
    const el = new Audio(SOURCES.victory);
    el.volume = Math.min(1, volume * MASTER_GAIN);
    void el.play().catch(() => {});
  } catch {
    /* no audio available */
  }
}


/** Set the master output level (0..1). Applies instantly, survives mute. */
export function setSfxVolume(volume: number) {
  MASTER_GAIN = Math.max(0, Math.min(1, volume));
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, ctx.currentTime, 0.02);
}

export function getSfxVolume() {
  return MASTER_GAIN;
}

export function setSfxMuted(next: boolean) {
  muted = next;
  if (master && ctx) master.gain.setTargetAtTime(next ? 0 : MASTER_GAIN, ctx.currentTime, 0.02);
}

export function isSfxMuted() {
  return muted;
}

/** Call when the tab loses focus to stop burning CPU on audio. */
export function suspendSfx() {
  if (ctx && ctx.state === "running") void ctx.suspend();
}

export function resumeSfx() {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

/* ------------------------------------------------------------------ */
/* Weather ambience (procedural — no extra downloads, no per-frame JS) */
/* ------------------------------------------------------------------ */

/**
 * Rain / wind beds are a single looping noise buffer through a filter, so the
 * cost is one source node for as long as the weather lasts. Thunder is a
 * short synthesised burst — nothing is fetched or decoded at runtime.
 */

let ambienceSrc: AudioBufferSourceNode | null = null;
let ambienceGain: GainNode | null = null;
let ambienceKind: "rain" | "snow" | null = null;
let noiseBed: AudioBuffer | null = null;

function bedBuffer(c: AudioContext) {
  if (noiseBed) return noiseBed;
  const len = Math.floor(c.sampleRate * 4);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.86 + white * 0.14; // pink-ish
    d[i] = last * 2.2 + white * 0.35;
  }
  // crossfade the seam so the loop is inaudible
  const fade = Math.floor(c.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    d[i] = d[i]! * t + d[len - fade + i]! * (1 - t);
  }
  noiseBed = buf;
  return buf;
}

/** Start/stop the weather bed. Pass null to fade the current one out. */
export function setWeatherAmbience(kind: "rain" | "snow" | null, volume = 0.35) {
  if (!ctx || !master) return;
  if (kind === ambienceKind) {
    if (ambienceGain) ambienceGain.gain.setTargetAtTime(kind ? volume : 0, ctx.currentTime, 1.2);
    return;
  }
  const now = ctx.currentTime;
  if (ambienceSrc && ambienceGain) {
    const oldSrc = ambienceSrc;
    const oldGain = ambienceGain;
    oldGain.gain.cancelScheduledValues(now);
    oldGain.gain.setTargetAtTime(0, now, 0.8);
    window.setTimeout(() => {
      try {
        oldSrc.stop();
      } catch {
        /* already stopped */
      }
      oldSrc.disconnect();
      oldGain.disconnect();
    }, 3500);
  }
  ambienceSrc = null;
  ambienceGain = null;
  ambienceKind = kind;
  if (!kind) return;

  const src = ctx.createBufferSource();
  src.buffer = bedBuffer(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  if (kind === "rain") {
    filter.type = "bandpass";
    filter.frequency.value = 1400;
    filter.Q.value = 0.5;
  } else {
    filter.type = "lowpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.7;
  }
  const g = ctx.createGain();
  g.gain.value = 0;
  g.gain.setTargetAtTime(volume, now, 2.0); // weather rolls in slowly
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start();
  ambienceSrc = src;
  ambienceGain = g;
}

/** Thunder clap — synthesised rumble, scheduled `delay` seconds from now. */
export function playThunder(delay = 0, volume = 0.7) {
  if (!ctx || !master || muted) return;
  const start = ctx.currentTime + Math.max(0, delay);
  const dur = 2.4 + Math.random() * 1.6;

  const src = ctx.createBufferSource();
  src.buffer = bedBuffer(ctx);
  src.loop = true;
  src.playbackRate.value = 0.6 + Math.random() * 0.25;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(1600, start);
  lp.frequency.exponentialRampToValueAtTime(110, start + dur);
  lp.Q.value = 0.6;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.02, volume), start + 0.05);
  g.gain.exponentialRampToValueAtTime(0.22 * volume, start + 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  // sub rumble under the crack
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(58, start);
  osc.frequency.exponentialRampToValueAtTime(26, start + dur);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, start);
  og.gain.exponentialRampToValueAtTime(0.35 * volume, start + 0.12);
  og.gain.exponentialRampToValueAtTime(0.0001, start + dur * 0.8);

  src.connect(lp);
  lp.connect(g);
  g.connect(master);
  osc.connect(og);
  og.connect(master);
  src.start(start);
  src.stop(start + dur + 0.1);
  osc.start(start);
  osc.stop(start + dur + 0.1);
  src.onended = () => {
    src.disconnect();
    lp.disconnect();
    g.disconnect();
  };
  osc.onended = () => {
    osc.disconnect();
    og.disconnect();
  };
}

/** Hard stop (map unload / unmount). */
export function stopWeatherAmbience() {
  setWeatherAmbience(null);
}
