/**
 * In-match backpack and FF Coin loot economy.
 *
 * Backpacks limit how many items a fighter carries. FF Coins are yellow
 * tokens looted from the ground and spent at vending machines (future).
 * The Leg Pockets tactical starts the holder with a larger backpack.
 */

import * as THREE from "three";

export type BackpackLevel = 1 | 2 | 3;

export const BACKPACK_CAPACITY: Record<BackpackLevel, number> = {
  1: 6,
  2: 8,
  3: 12,
};

export type Backpack = {
  level: BackpackLevel;
  capacity: number;
  /** FF Coins currently held */
  coins: number;
  /** item ids carried (medkits, inhalers, grenades, ammo boxes) */
  items: string[];
};

export function defaultBackpack(level: BackpackLevel = 1): Backpack {
  return {
    level,
    capacity: BACKPACK_CAPACITY[level],
    coins: 0,
    items: [],
  };
}

export function backpackHasSpace(bp: Backpack, weight = 1) {
  return bp.items.length + weight <= bp.capacity;
}

export function addItem(bp: Backpack, itemId: string, weight = 1): boolean {
  if (!backpackHasSpace(bp, weight)) return false;
  bp.items.push(itemId);
  return true;
}

export function removeItem(bp: Backpack, itemId: string) {
  const idx = bp.items.indexOf(itemId);
  if (idx >= 0) bp.items.splice(idx, 1);
}

export type FfCoinPickup = {
  id: string;
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  value: number;
  alive: boolean;
  spawnAt: number;
};

const COIN_PICKUP_RADIUS = 2.2;
const COIN_VALUE = 50;
const COIN_RESCAN_INTERVAL = 0.25;

export function createFfCoinMesh(): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 16);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffd23f,
    emissive: 0xffa500,
    emissiveIntensity: 0.35,
    roughness: 0.3,
    metalness: 0.8,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.z = Math.PI / 2;
  mesh.userData["ffCoin"] = true;
  return mesh;
}

export function spawnFfCoins(
  scene: THREE.Object3D,
  count: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  groundAt: (x: number, z: number) => number | null,
): FfCoinPickup[] {
  const pickups: FfCoinPickup[] = [];
  const meshTemplate = createFfCoinMesh();
  for (let i = 0; i < count; i++) {
    const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);
    const y = groundAt(x, z);
    if (y == null) continue;
    const pos = new THREE.Vector3(x, y + 0.35, z);
    const mesh = meshTemplate.clone();
    mesh.position.copy(pos);
    scene.add(mesh);
    pickups.push({
      id: `coin_${Math.random().toString(36).slice(2)}`,
      pos,
      mesh,
      value: COIN_VALUE,
      alive: true,
      spawnAt: performance.now(),
    });
  }
  meshTemplate.geometry.dispose();
  (meshTemplate.material as THREE.Material).dispose();
  return pickups;
}

let lastScan = 0;

/**
 * Auto-pickup coins that are close enough to the player. Returns the total
 * value collected this frame and mutates the pickup list.
 */
export function scanFfCoinPickups(
  pickups: FfCoinPickup[],
  playerPos: THREE.Vector3,
  backpack: Backpack,
  now: number,
): number {
  if (now - lastScan < COIN_RESCAN_INTERVAL * 1000) return 0;
  lastScan = now;
  let collected = 0;
  for (const coin of pickups) {
    if (!coin.alive) continue;
    if (coin.pos.distanceTo(playerPos) <= COIN_PICKUP_RADIUS) {
      coin.alive = false;
      coin.mesh.visible = false;
      backpack.coins += coin.value;
      collected += coin.value;
    }
  }
  return collected;
}

export function disposeFfCoins(pickups: FfCoinPickup[]) {
  for (const coin of pickups) {
    coin.mesh.geometry.dispose();
    (coin.mesh.material as THREE.Material).dispose();
    coin.mesh.parent?.remove(coin.mesh);
  }
  pickups.length = 0;
}
