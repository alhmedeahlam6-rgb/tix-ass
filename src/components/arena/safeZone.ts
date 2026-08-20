import * as THREE from "three";

export type SafeZone = {
  center: THREE.Vector3;
  currentRadius: number;
  targetRadius: number;
  nextRadius: number;
  shrinkStart: number;
  shrinkEnd: number;
  damagePerSecond: number;
  active: boolean;
};

export function createSafeZone(
  center: THREE.Vector3,
  startRadius: number,
  finalRadius: number,
  firstShrinkDelay: number,
  shrinkDuration: number,
  damagePerSecond: number,
): SafeZone {
  return {
    center: center.clone(),
    currentRadius: startRadius,
    targetRadius: finalRadius,
    nextRadius: startRadius,
    shrinkStart: performance.now() / 1000 + firstShrinkDelay,
    shrinkEnd: performance.now() / 1000 + firstShrinkDelay + shrinkDuration,
    damagePerSecond,
    active: true,
  };
}

export function updateSafeZone(zone: SafeZone, now: number, dt: number) {
  if (!zone.active) return;
  if (now >= zone.shrinkStart && zone.currentRadius > zone.targetRadius) {
    const t = Math.min(1, (now - zone.shrinkStart) / Math.max(0.001, zone.shrinkEnd - zone.shrinkStart));
    zone.currentRadius = zone.nextRadius + (zone.targetRadius - zone.nextRadius) * t;
  }
}

export function damageOutsideZone(zone: SafeZone, pos: THREE.Vector3, dt: number) {
  if (!zone.active) return 0;
  const dx = pos.x - zone.center.x;
  const dz = pos.z - zone.center.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist <= zone.currentRadius) return 0;
  return zone.damagePerSecond * dt;
}

export function createSafeZoneVisual(radius: number, color = 0x4ade80) {
  const geometry = new THREE.RingGeometry(radius - 0.5, radius + 0.5, 128);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.15;
  return { mesh, material };
}
