import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { BRIDGE, BUILDING, ROCK, RUBBLE, TREES, WALL, WATER, type BattleMap, type Conditions } from '@brink/arena/v2';
import { QUALITY, type Quality } from '../quality';
import { paintAtlas } from './atlas';
import { Clutter, Forest, leafTexture, reeds, type WindUniforms } from './flora';
import { detailTexture, groundGeometry, groundMaterial, paintCrater, paintGround, paintScorch } from './ground';
import { addGrade, edgeHaze, type FieldUniform, type GradeUniform } from './haze';
import { Heightfield, Layout, MARGIN } from './height';
import { clamp, fbm, hash, lattice, stream } from './noise';
import { Props } from './props';
import { deckAt, findBridges, roadGeometry, roadNetwork, roadTexture } from './roads';
import { loadSky, lookFor, skyDome, skyRotation } from './sky';
import { Structures } from './structures';
import { thermalLike, thermalOverlay, ThermalSwap } from './thermal';
import { Water } from './water';
import { Mist, Precipitation } from './weather';
import { Zone } from './zone';

export { thermalMaterialFor } from './thermal';
export { addGrade, type GradeUniform } from './haze';

// The battlefield (docs/arena-v2.md, sections 2, 3.3, 3.7, 7 and 8): ground shaped from the map's
// levels and painted per biome, roads, rivers and bridges, woods, walls, rocks and buildings that
// crumble, under light, sky, haze and weather for the conditions, with a white-hot thermal view.
// One cell is one world unit; cell (x, y) is centred at (x + 0.5, y + 0.5) on x and z.

export interface World {
  group: THREE.Group;
  /** Ground height in world units at a world point (bridge decks and the river's surface count). */
  heightAt(x: number, z: number): number;
  /** The top of whatever stands in a cell (building roof, tree crown) for placing effects. */
  topAt(cx: number, cy: number): number;
  /** Re-draw a cell after it changed (building to rubble, tree knocked down, wall broken). */
  setCell(cx: number, cy: number, map: BattleMap): void;
  addCrater(cx: number, cy: number): void;
  /** A scorch mark under a wreck. */
  scorch(cx: number, cy: number): void;
  /** The zone circle for capture battles (amber), with a fill showing capture progress 0..1. */
  setZone(progress: number): void;
  readonly lights: { sun: THREE.DirectionalLight; ambient: THREE.Light };
  setThermal(on: boolean): void;
  update(dt: number, camera: THREE.Camera): void;
  dispose(): void;
  /** Resolves when the sky's image-based light has loaded (the world draws before it, with fill light only). */
  readonly ready: Promise<void>;
  /** Where the camera's view meets the ground (updated each frame). */
  readonly focus: THREE.Vector3;
  /** The world's colour grade, to share with unit materials: `addGrade(material, world.grade)`. */
  readonly grade: GradeUniform;
}

/** Tone mapping the world is graded for. */
const TONE = THREE.AgXToneMapping;

/**
 * Build the battlefield into `scene`: its group, sun and fill light, sky dome, haze (scene.fog and
 * background) and image-based light (scene.environment, once the sky image loads). It also sets
 * the renderer's tone mapping (AgX) and exposure for the hour; dispose() puts all of those back.
 * Shadows: the sun casts when the preset has a shadow map; the scene owns renderer.shadowMap.
 */
export function buildWorld(renderer: THREE.WebGLRenderer, scene: THREE.Scene, map: BattleMap, conditions: Conditions, quality: Quality, seed: number, lib?: { hesco?: GLTF; container?: GLTF; tower?: GLTF }): World {
  const preset = QUALITY[quality] ?? QUALITY.balanced;
  const high = quality === 'high';
  const low = quality === 'low';
  const texSize = high ? 2048 : 1024;
  const group = new THREE.Group();
  group.name = 'world';
  scene.add(group);
  const look = lookFor(conditions);
  const biome = map.biome;
  const shadows = preset.shadowMap > 0;

  // --- Shape ----------------------------------------------------------------------------------
  const layout = new Layout(map, seed);
  // Towns are graded nearly flat: a coarser grid does there.
  const hf = new Heightfield(layout, Math.max(2, (high ? 4 : low ? 2 : 3) - (biome === 'urban' ? 1 : 0)), seed);
  const net = roadNetwork(map, layout);
  const bridges = findBridges(map, hf);

  // --- Ground ---------------------------------------------------------------------------------
  const paint = paintGround(map, layout, hf, net.lines, seed, texSize, high ? 12 : low ? 6 : 8);
  // Craters already on the map are painted before the first upload.
  const preCraters: [number, number][] = [];
  const drawnCraters = new Set<number>();
  const craterRnd = stream(seed ^ 0xc4a7);
  const pg = paint.color.getContext('2d')!;
  for (let i = 0; i < map.cells.length; i++) {
    if (!map.crater[i]) continue;
    const cx = i % map.w;
    const cy = Math.floor(i / map.w);
    const x = cx + 0.5 + (hash(seed, cx, cy, 21) - 0.5) * 0.35;
    const z = cy + 0.5 + (hash(seed, cx, cy, 22) - 0.5) * 0.35;
    preCraters.push([x, z]);
    drawnCraters.add(i);
    paintCrater(pg, (x + MARGIN) * paint.px, (z + MARGIN) * paint.px, paint.px * 0.26, biome, craterRnd);
  }
  const groundTex = new THREE.CanvasTexture(paint.color);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.flipY = false;
  groundTex.anisotropy = 8;
  const maskTex = new THREE.CanvasTexture(paint.mask);
  maskTex.flipY = false;
  const detail = detailTexture(biome, low ? 256 : 512, seed);
  const field: FieldUniform = { uField: { value: new THREE.Vector4(0, 0, map.w, map.h) } };
  const ground = groundMaterial(groundTex, maskTex, detail, biome, field.uField.value);
  ground.uniforms.uWet.value = look.wet;
  const groundMesh = new THREE.Mesh(groundGeometry(hf), ground.material);
  groundMesh.receiveShadow = true;
  groundMesh.castShadow = high && shadows;
  groundMesh.name = 'ground';
  group.add(groundMesh);
  // The plain beyond, under the haze.
  const far = new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(look.fog.r, look.fog.g, look.fog.b, THREE.SRGBColorSpace), toneMapped: false, fog: false }));
  far.position.set(map.w / 2, layout.baseLevel - 0.04, map.h / 2);
  far.name = 'far';
  group.add(far);

  // --- Roads ----------------------------------------------------------------------------------
  const roadTex = roadTexture(biome, low ? 256 : 512, seed);
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, transparent: true, depthWrite: false, roughness: 0.9 - look.wet * 0.45, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  if (look.wet) roadMat.color.setScalar(0.72);
  roadMat.onBeforeCompile = (shader) => edgeHaze(shader, field);
  roadMat.customProgramCacheKey = () => 'brink-roads';
  const roadMesh = new THREE.Mesh(roadGeometry(net, hf, bridges, seed), roadMat);
  roadMesh.receiveShadow = true;
  roadMesh.renderOrder = 1;
  roadMesh.name = 'roads';
  group.add(roadMesh);

  // --- Water ----------------------------------------------------------------------------------
  const water = new Water(hf, biome, seed, field);
  water.uniforms.uRain.value = look.wet;
  if (water.mesh) group.add(water.mesh);

  // --- Structures -----------------------------------------------------------------------------
  const atlas = paintAtlas(texSize, seed);
  const structures = new Structures(map, hf, bridges, atlas, seed, shadows, !low);
  structures.uniforms.uLit.value = look.windowsLit;
  structures.uniforms.uGlow.value = look.windowGlow;
  group.add(structures.group);

  // --- Flora ----------------------------------------------------------------------------------
  const wind: WindUniforms = { uTime: { value: 0 }, uWind: { value: conditions.weather === 'rain' || conditions.weather === 'snow' ? 1.6 : conditions.weather === 'fog' ? 0.4 : 1 } };
  const leaf = leafTexture(high ? 512 : 256, seed);
  const forest = new Forest(map, layout, hf, net.lines, leaf, wind, field, seed, high && shadows, low ? 6 : high ? 10 : 8, low ? 1 : 2, low ? 2.5 : high ? 5.5 : 4);
  group.add(forest.group);
  const clutter = new Clutter(map, layout, hf, paint, seed, preset.clutter, forest.material, wind, field, high ? 128 : 64, high);
  group.add(clutter.group);
  const reedMesh = reeds(map, layout, hf, clutter.meshes[0]!, seed);
  if (reedMesh) group.add(reedMesh);

  // --- Walls, rocks, craters ------------------------------------------------------------------
  const props = new Props(map, hf, forest.material, seed, shadows, lib?.hesco);
  group.add(props.group);
  for (const [x, z] of preCraters) props.addCrater(x, z, 0.2);

  // The grade on every surface the world owns.
  const grade: GradeUniform = { uDesat: { value: look.desat }, uGradeTint: { value: conditions.time === 'night' ? new THREE.Vector3(0.78, 0.9, 1.18) : new THREE.Vector3(1.02, 1.0, 0.97) } };
  const owned = new Set<THREE.Material>([ground.material, roadMat, water.material, structures.material, forest.material, props.material]);
  for (const m of clutter.meshes) owned.add(m.material as THREE.Material);
  for (const m of owned) addGrade(m, grade);

  // --- Light, sky, air ------------------------------------------------------------------------
  const prev = { fog: scene.fog, background: scene.background, environment: scene.environment, envIntensity: scene.environmentIntensity, envRot: scene.environmentRotation.clone(), tone: renderer.toneMapping, exposure: renderer.toneMappingExposure };
  renderer.toneMapping = TONE;
  renderer.toneMappingExposure = look.exposure;
  const fogLinear = new THREE.Color().setRGB(look.fog.r, look.fog.g, look.fog.b, THREE.SRGBColorSpace);
  const fog = new THREE.Fog(fogLinear.clone(), 30, 90);
  scene.fog = fog;
  scene.background = fogLinear.clone();
  const sky = skyDome(look);
  group.add(sky.mesh);
  const sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity);
  sun.name = 'sun';
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(preset.shadowMap, preset.shadowMap);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 3;
    sun.shadow.intensity = look.shadowIntensity;
    Object.assign(sun.shadow.camera, { near: 1, far: 140, left: -20, right: 20, top: 20, bottom: -20 });
  }
  const ambient = new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity);
  ambient.name = 'ambient';
  scene.add(sun, sun.target, ambient);
  let pmremTarget: THREE.WebGLRenderTarget | null = null;
  let disposed = false;
  const ready = loadSky(look.env)
    .then((tex) => {
      if (disposed) return;
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmremTarget = pmrem.fromEquirectangular(tex);
      pmrem.dispose();
      scene.environment = pmremTarget.texture;
      scene.environmentIntensity = look.envIntensity;
      scene.environmentRotation.set(0, skyRotation(look), 0);
    })
    .catch(() => {
      // Without the sky image the fill light still lights the field.
    });

  // --- Weather --------------------------------------------------------------------------------
  const precip = conditions.weather === 'rain' || conditions.weather === 'snow' ? new Precipitation(conditions.weather, quality, seed, conditions.time === 'night') : null;
  if (precip) group.add(precip.mesh);
  const mistAmount = conditions.weather === 'fog' ? 0.55 : conditions.time === 'dawn' && conditions.weather !== 'rain' ? 0.22 : 0;
  const mist = mistAmount > 0 ? new Mist(hf, map.w, map.h, seed, mistAmount, look.fog) : null;
  if (mist) group.add(mist.mesh);

  // --- Zone -----------------------------------------------------------------------------------
  const zone = map.mode === 'capture' && map.zone ? new Zone(hf, map.zone.x + 0.5, map.zone.y + 0.5, map.zone.r) : null;
  if (zone) group.add(zone.group);

  // --- Thermal --------------------------------------------------------------------------------
  const overlay = thermalOverlay();
  group.add(overlay.mesh);
  const swap = new ThermalSwap();
  const thermalCache = new Map<THREE.Material, THREE.Material>();
  let thermalGround: THREE.CanvasTexture | null = null;
  let thermalAtlas: THREE.CanvasTexture | null = null;
  const grey = (v: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(v, v, v, THREE.SRGBColorSpace), toneMapped: false });
  const thermalFor = (mesh: THREE.Mesh): THREE.Material => {
    const src = mesh.material as THREE.Material;
    const hit = thermalCache.get(src);
    if (hit) return hit;
    let t: THREE.Material;
    if (mesh === groundMesh) {
      thermalGround ??= paintThermalGround(map, layout, hf, seed);
      t = new THREE.MeshBasicMaterial({ map: thermalGround, toneMapped: false });
    } else if (src === structures.material) {
      thermalAtlas ??= paintThermalAtlas(atlas.canvas, atlas.emissiveCanvas);
      t = new THREE.MeshBasicMaterial({ map: thermalAtlas, toneMapped: false });
    } else if (mesh === far) t = grey(0.36);
    else if (mesh === water.mesh) t = grey(0.07);
    else if (src === roadMat) t = thermalLike(roadMat, 0.47, 0.04);
    else if (src === forest.material) t = thermalLike(src, 0.21, 0.18);
    else if (src === props.material) t = grey(mesh.name === 'rocks' ? 0.36 : mesh.name === 'craters' ? 0.4 : 0.31);
    else t = thermalLike(src, mesh.name.startsWith('wall') ? 0.32 : 0.26, 0.12);
    thermalCache.set(src, t);
    return t;
  };
  const worldMeshes = (): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    for (const root of [groundMesh, far, roadMesh, water.mesh, structures.group, forest.group, clutter.group, reedMesh, props.group]) {
      if (!root) continue;
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
      });
    }
    return out;
  };

  // --- Ground patches at runtime --------------------------------------------------------------
  const PATCH = Math.min(256, Math.ceil(paint.px * 3.2));
  const patch = document.createElement('canvas');
  patch.width = patch.height = PATCH;
  const patchCtx = patch.getContext('2d')!;
  const patchTex = new THREE.CanvasTexture(patch);
  patchTex.flipY = false;
  patchTex.colorSpace = THREE.SRGBColorSpace;
  const patchAt = new THREE.Vector2();
  const paintPatch = (x: number, z: number, draw: (g: CanvasRenderingContext2D, px: number, py: number) => void) => {
    const W = paint.color.width;
    const H = paint.color.height;
    const cxp = (x + MARGIN) * paint.px;
    const czp = (z + MARGIN) * paint.px;
    const x0 = clamp(Math.round(cxp - PATCH / 2), 0, W - PATCH);
    const y0 = clamp(Math.round(czp - PATCH / 2), 0, H - PATCH);
    pg.save();
    pg.beginPath();
    pg.rect(x0, y0, PATCH, PATCH);
    pg.clip();
    draw(pg, cxp, czp);
    pg.restore();
    patchCtx.clearRect(0, 0, PATCH, PATCH);
    patchCtx.drawImage(paint.color, x0, y0, PATCH, PATCH, 0, 0, PATCH, PATCH);
    patchTex.needsUpdate = true;
    try {
      renderer.copyTextureToTexture(patchTex, groundTex, null, patchAt.set(x0, y0));
    } catch {
      groundTex.needsUpdate = true;
    }
    if (thermalGround) {
      const tg = (thermalGround.image as HTMLCanvasElement).getContext('2d')!;
      const k = thermalGround.image.width / W;
      tg.fillStyle = 'rgba(150,150,150,0.5)';
      tg.beginPath();
      tg.arc(cxp * k, czp * k, paint.px * k * 0.35, 0, Math.PI * 2);
      tg.fill();
      thermalGround.needsUpdate = true;
    }
  };

  // --- State ----------------------------------------------------------------------------------
  const rendered = map.cells.slice();
  const focus = new THREE.Vector3(map.w / 2, 0, map.h / 2);
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const toSun = look.toSun.clone();
  let time = 0;
  let meanH = 0;
  for (let i = 0; i < hf.h.length; i += 7) meanH += hf.h[i]!;
  meanH /= Math.ceil(hf.h.length / 7);
  const thermalFog = new THREE.Color().setRGB(0.36, 0.36, 0.36, THREE.SRGBColorSpace);
  const skySaved = { top: (sky.uniforms.uTop!.value as THREE.Vector3).clone(), horizon: (sky.uniforms.uHorizon!.value as THREE.Vector3).clone(), fog: (sky.uniforms.uFog!.value as THREE.Vector3).clone(), sun: sky.uniforms.uSunAmount!.value as number };
  const fx = new Set<number>();

  const heightAt = (x: number, z: number): number => {
    let h = hf.at(x, z);
    const deck = deckAt(bridges, x, z);
    if (deck !== null) h = Math.max(h, deck);
    if (layout.sample(layout.distWater, x, z) < 1.5) h = Math.max(h, hf.surfaceAt(x, z));
    return h;
  };

  const world: World = {
    group,
    lights: { sun, ambient },
    ready,
    focus,
    grade,
    heightAt,
    topAt(cx, cy) {
      const i = cy * map.w + cx;
      const c = rendered[i];
      const ground = heightAt(cx + 0.5, cy + 0.5);
      if (c === BUILDING || c === RUBBLE) return Math.max(ground, structures.tops[i]!);
      if (c === TREES) return forest.tops.get(i) ?? ground;
      if (c === WALL || c === ROCK) return props.tops.get(i) ?? ground;
      return ground;
    },
    setCell(cx, cy, m) {
      const i = cy * m.w + cx;
      const was = rendered[i]!;
      const now = m.cells[i]!;
      if (was === BUILDING && now !== BUILDING) structures.setCell(i, now);
      else if (now === RUBBLE && was !== RUBBLE) structures.setCell(i, now);
      else if (was === RUBBLE && now !== RUBBLE) structures.setCell(i, now);
      else if (was === BRIDGE && now !== BRIDGE) structures.setCell(i, now);
      if (was === TREES && now !== TREES) forest.knock(i, 0, seed);
      else if (now === TREES && (m.hp[i] ?? 2) < 2) forest.knock(i, (m.hp[i] ?? 0) > 0 ? 2 : 0, seed);
      if (was === WALL && now !== WALL) props.breakWall(i);
      if (was === ROCK && now !== ROCK) props.clearRock(i);
      rendered[i] = now;
      if (m.crater[i] && !drawnCraters.has(i)) world.addCrater(cx, cy);
      if (was !== now) clutter.refresh();
    },
    addCrater(cx, cy) {
      const i = cy * map.w + cx;
      drawnCraters.add(i);
      const [x, z] = props.craterAt(cx, cy);
      const r = 0.17 + hash(seed, cx, cy, 33) * 0.07;
      const rnd = stream(hash(seed, cx, cy, 34) * 4294967296);
      paintPatch(x, z, (g, px, py) => paintCrater(g, px, py, paint.px * r, biome, rnd));
      props.addCrater(x, z, r);
    },
    scorch(cx, cy) {
      const key = cy * map.w + cx;
      if (fx.has(key)) return;
      fx.add(key);
      const rnd = stream(hash(seed, cx, cy, 55) * 4294967296);
      paintPatch(cx + 0.5, cy + 0.5, (g, px, py) => paintScorch(g, px, py, paint.px * 0.55, rnd));
    },
    setZone(progress) {
      zone?.set(progress);
    },
    setThermal(on) {
      if (on === swap.on) return;
      if (on) {
        swap.apply(worldMeshes(), thermalFor);
        fog.color.copy(thermalFog);
        (scene.background as THREE.Color | null)?.copy?.(thermalFog);
        (sky.uniforms.uTop!.value as THREE.Vector3).set(0.16, 0.16, 0.16);
        (sky.uniforms.uHorizon!.value as THREE.Vector3).set(0.34, 0.34, 0.34);
        (sky.uniforms.uFog!.value as THREE.Vector3).set(0.36, 0.36, 0.36);
        sky.uniforms.uSunAmount!.value = 0;
        overlay.mesh.visible = true;
        if (mist) mist.mesh.visible = false;
      } else {
        swap.restore();
        fog.color.copy(fogLinear);
        (scene.background as THREE.Color | null)?.copy?.(fogLinear);
        (sky.uniforms.uTop!.value as THREE.Vector3).copy(skySaved.top);
        (sky.uniforms.uHorizon!.value as THREE.Vector3).copy(skySaved.horizon);
        (sky.uniforms.uFog!.value as THREE.Vector3).copy(skySaved.fog);
        sky.uniforms.uSunAmount!.value = skySaved.sun;
        overlay.mesh.visible = false;
        if (mist) mist.mesh.visible = true;
      }
      // Grass and scrub take their colours again (or drop them) on the next fill.
      clutter.refresh();
    },
    update(dt, camera) {
      time += dt;
      // Where the view meets the ground.
      camera.getWorldPosition(camPos);
      camera.getWorldDirection(camDir);
      let t = camDir.y < -0.01 ? (meanH - camPos.y) / camDir.y : 30;
      if (!(t > 0) || !Number.isFinite(t)) t = 30;
      for (let k = 0; k < 2; k++) {
        const px = camPos.x + camDir.x * t;
        const pz = camPos.z + camDir.z * t;
        const h = hf.at(px, pz);
        if (camDir.y < -0.01) t = Math.max(0.5, (h - camPos.y) / camDir.y);
      }
      focus.set(clamp(camPos.x + camDir.x * t, -MARGIN, map.w + MARGIN), 0, clamp(camPos.z + camDir.z * t, -MARGIN, map.h + MARGIN));
      focus.y = hf.at(focus.x, focus.z);
      const D = camPos.distanceTo(focus);
      // Haze closes in with distance; real fog takes the view a few cells past the focus.
      if (look.fogCells > 0) {
        fog.near = Math.max(0.5, D - 3);
        fog.far = D + look.fogCells;
      } else {
        fog.near = D * look.fogNear;
        fog.far = D * look.fogFar;
      }
      // Shadows cover what is in view, sharp near, and stay steady as the view pans.
      if (sun.castShadow) {
        const R = clamp(D * 0.7, 7, 36);
        const cam = sun.shadow.camera;
        if (cam.right !== R) {
          cam.left = -R;
          cam.right = R;
          cam.top = R;
          cam.bottom = -R;
          cam.updateProjectionMatrix();
        }
        const texel = (2 * R) / preset.shadowMap;
        const sx = Math.round(focus.x / texel) * texel;
        const sz = Math.round(focus.z / texel) * texel;
        sun.target.position.set(sx, focus.y, sz);
        sun.position.set(sx + toSun.x * 60, focus.y + toSun.y * 60, sz + toSun.z * 60);
      } else {
        sun.target.position.copy(focus);
        sun.position.copy(focus).addScaledVector(toSun, 60);
      }
      sun.target.updateMatrixWorld();
      // Moving things.
      wind.uTime.value = time;
      water.update(time);
      structures.update(dt);
      forest.update(dt);
      clutter.update(focus.x, focus.z);
      zone?.update(time);
      mist?.update(time);
      if (precip) {
        const persp = camera as THREE.PerspectiveCamera;
        const h = renderer.domElement.height;
        const scale = persp.isPerspectiveCamera ? h / (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2))) : h;
        precip.update(time, focus, scale);
      }
      if (overlay.mesh.visible) overlay.uniforms.uTime!.value = time;
    },
    dispose() {
      disposed = true;
      swap.dispose();
      scene.remove(sun, sun.target, ambient);
      sun.dispose();
      ambient.dispose();
      scene.fog = prev.fog;
      scene.background = prev.background;
      scene.environment = prev.environment;
      scene.environmentIntensity = prev.envIntensity;
      scene.environmentRotation.copy(prev.envRot);
      renderer.toneMapping = prev.tone;
      renderer.toneMappingExposure = prev.exposure;
      (pmremTarget as THREE.WebGLRenderTarget | null)?.dispose();
      group.removeFromParent();
      groundMesh.geometry.dispose();
      ground.material.dispose();
      far.geometry.dispose();
      (far.material as THREE.Material).dispose();
      roadMesh.geometry.dispose();
      roadMat.dispose();
      water.dispose();
      structures.dispose();
      forest.dispose();
      clutter.dispose();
      props.dispose();
      precip?.dispose();
      mist?.dispose();
      zone?.dispose();
      sky.mesh.geometry.dispose();
      (sky.mesh.material as THREE.Material).dispose();
      overlay.mesh.geometry.dispose();
      (overlay.mesh.material as THREE.Material).dispose();
      for (const t of [groundTex, maskTex, detail, roadTex, atlas.map, atlas.emissive, leaf, patchTex, thermalGround, thermalAtlas]) t?.dispose();
      far.removeFromParent();
      for (const m of thermalCache.values()) m.dispose();
    },
  };
  return world;
}

/** Heat of the ground at night: cool fields with noise, warmer roads and yards, cold water. */
function paintThermalGround(map: BattleMap, layout: Layout, hf: Heightfield, seed: number): THREE.CanvasTexture {
  const px = 10;
  const W = layout.ew * px;
  const H = layout.eh * px;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const t = lattice(seed ^ 0x7e7);
  const n = { x: 0, y: 0, z: 0 };
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) / px - MARGIN;
      const z = (j + 0.5) / px - MARGIN;
      let v = 0.27 + (fbm(t, x * 0.6, z * 0.6, 3) - 0.5) * 0.1;
      hf.normalAt(x, z, n);
      v += (n.x * 0.3 + n.z * 0.4) * 0.12;
      const road = layout.sample(layout.distRoad, x, z);
      if (road < 0.45) v = v + (0.34 - v) * (1 - road / 0.45);
      const built = layout.sample(layout.distBuilding, x, z);
      if (built < 0.6) v = v + (0.37 - v) * (1 - built / 0.6);
      const trees = layout.sample(layout.distTrees, x, z);
      if (trees < 0.5) v -= 0.04 * (1 - trees / 0.5);
      if (layout.sample(layout.distWater, x, z) < 2 && hf.surfaceAt(x, z) > hf.at(x, z)) v = 0.08;
      // The margin melts into the grey haze, as in the colour view.
      const out = Math.max(-x, x - map.w, -z, z - map.h);
      v += (0.36 - v) * Math.min(1, Math.max(0, (out - 1.5) / (MARGIN - 2)));
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      if (cx >= 0 && cz >= 0 && cx < map.w && cz < map.h) {
        const cell = map.cells[cz * map.w + cx];
        if (cell === WATER) v = Math.min(v, 0.1);
        if (cell === RUBBLE || cell === ROCK) v = Math.max(v, 0.34);
      }
      const k = (j * W + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = clamp(v) * 255;
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  return tex;
}

/** The building atlas as heat: walls a little above the ground, windows leaking warmth. */
function paintThermalAtlas(colour: HTMLCanvasElement, emissive: HTMLCanvasElement): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(colour, 0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  const e = document.createElement('canvas');
  e.width = e.height = S;
  const eg = e.getContext('2d', { willReadFrequently: true })!;
  eg.drawImage(emissive, 0, 0, S, S);
  const em = eg.getImageData(0, 0, S, S).data;
  const d = img.data;
  for (let k = 0; k < d.length; k += 4) {
    const lum = (d[k]! * 0.3 + d[k + 1]! * 0.59 + d[k + 2]! * 0.11) / 255;
    const row = Math.floor(k / 4 / S / (S / 4));
    const roof = row === 2 || row === 3 ? 0.02 : 0;
    let v = 0.33 + (lum - 0.5) * 0.1 + roof;
    const win = em[k + 1]! / 255;
    if (win > 0.2) v = 0.48 + (em[k]! / 255) * 0.2;
    d[k] = d[k + 1] = d[k + 2] = clamp(v) * 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  return tex;
}
