import { useEffect, useRef } from "react";
import * as THREE from "three";

import type { ArenaCharacter } from "./characters";

type Props = {
  character: ArenaCharacter;
  /** allow drag-to-spin (yaw only) */
  interactive?: boolean;
  /** slow idle turntable when the player isn't dragging */
  autoSpin?: boolean;
  className?: string;
};

/**
 * Placeholder character preview: a coloured capsule on a lit pedestal.
 * Dragging turns it left/right only — pitch is locked so the pose stays
 * readable.
 */
export default function CapsuleViewer({ character, interactive = true, autoSpin = true, className }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const yawRef = useRef(0);
  const draggingRef = useRef(false);
  const colorRef = useRef(character);
  colorRef.current = character;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 1.35, 5.2);
    camera.lookAt(0, 1.05, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearAlpha(0);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = interactive ? "grab" : "default";

    scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x0a0f18, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fb6ff, 1.4);
    rim.position.set(-4, 2.5, -3);
    scene.add(rim);

    const rig = new THREE.Group();
    scene.add(rig);

    const bodyMat = new THREE.MeshStandardMaterial({ color: character.color, roughness: 0.45, metalness: 0.25 });
    const accentMat = new THREE.MeshStandardMaterial({ color: character.accent, roughness: 0.3, metalness: 0.5 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.05, 8, 28), bodyMat);
    body.position.y = 1.05;
    rig.add(body);

    // visor band so the facing direction is obvious while spinning
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.08), accentMat);
    visor.position.set(0, 1.45, 0.4);
    rig.add(visor);

    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.05, 10, 32), accentMat);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.82;
    rig.add(belt);

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.05, 0.12, 40),
      new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.6, metalness: 0.35 }),
    );
    pad.position.y = 0.06;
    scene.add(pad);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.98, 1.12, 48),
      new THREE.MeshBasicMaterial({ color: character.color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.13;
    scene.add(ring);

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let lastX = 0;
    const el = renderer.domElement;
    const down = (e: PointerEvent) => {
      if (!interactive) return;
      draggingRef.current = true;
      lastX = e.clientX;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      yawRef.current += (e.clientX - lastX) * 0.01; // yaw only — never pitch
      lastX = e.clientX;
    };
    const up = (e: PointerEvent) => {
      draggingRef.current = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      el.style.cursor = interactive ? "grab" : "default";
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);

    let raf = 0;
    let prev = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      if (autoSpin && !draggingRef.current) yawRef.current += dt * 0.35;
      rig.rotation.y = yawRef.current;
      rig.rotation.x = 0;
      rig.rotation.z = 0;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      el.remove();
    };
  }, [character, interactive, autoSpin]);

  return <div ref={hostRef} className={className} />;
}
