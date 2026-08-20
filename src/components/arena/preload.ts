/**
 * Boot-time asset preloader. Everything the arena needs (map, gloo wall model,
 * lobby art) is fetched here with real byte progress so the first splash screen
 * can show an honest bar instead of a fake timer.
 */
const glooAsset = { url: "/models/ff_gloo_wall.glb" };

export type PreloadItem = { label: string; url: string; weight?: number };

const cache = new Map<string, ArrayBuffer | true>();

export function arenaAssets(extra: string[] = []): PreloadItem[] {
  return [
    { label: "Arena geometry", url: "/models/arena.glb", weight: 6 },
    { label: "Gloo wall", url: (glooAsset as { url: string }).url, weight: 1 },
    ...extra.map((url) => ({ label: "Interface art", url, weight: 2 })),
  ];
}

async function fetchWithProgress(url: string, onChunk: (bytes: number, total: number) => void) {
  if (cache.has(url)) return;
  const res = await fetch(url);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body) {
    await res.arrayBuffer();
    cache.set(url, true);
    onChunk(total || 1, total || 1);
    return;
  }
  const reader = res.body.getReader();
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value?.byteLength ?? 0;
    onChunk(loaded, total);
  }
  cache.set(url, true);
}

/**
 * Runs every download in parallel and reports a smoothed 0–1 progress plus the
 * label of whatever is currently streaming.
 */
export async function preloadAll(
  items: PreloadItem[],
  onProgress: (progress: number, label: string) => void,
) {
  const totalWeight = items.reduce((a, i) => a + (i.weight ?? 1), 0);
  const done = new Array(items.length).fill(0);
  const tick = (label: string) => {
    const p = done.reduce((a, v, i) => a + v * (items[i]!.weight ?? 1), 0) / totalWeight;
    onProgress(Math.min(1, p), label);
  };

  await Promise.all(
    items.map(async (item, i) => {
      try {
        await fetchWithProgress(item.url, (loaded, total) => {
          done[i] = total ? loaded / total : 0.5;
          tick(item.label);
        });
      } catch {
        /* a missing asset must never block boot — the arena has fallbacks */
      }
      done[i] = 1;
      tick(item.label);
    }),
  );
  onProgress(1, "Ready");
}
