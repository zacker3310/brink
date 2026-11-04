import * as THREE from 'three';
import { AIR_LENGTH, NOZZLES, SHIP_GUNS, SHIP_LENGTH, WINGTIP, buildAircraft, shipGeometry, type AirKind, type ShipKind } from '../models3d/aircraft';
import type { BattleAudio } from '../audio';
import type { Effects } from './effects';
import type { Side } from './palette';

// Off-map support as the film flies it (docs/arena-v2.md, section 14): strike jets that run in from
// their side's edge, drop two bombs and pull away (or take a missile, burn and fall away off the
// field), cruise missiles that skim in low and pop up to dive, a ship on the horizon walking 5-inch
// shells over the target, a kamikaze swarm of three one-way drones weaving in, each one shot at on
// its own, and the rocket artillery: GMLRS climbing out from beyond the edge and diving onto the cell,
// or a Tornado-G ripple of 122 mm rockets arcing over and drenching the area. The stage gives each
// mission its timeline: when each blast or interception happens, measured from the start of the run,
// so what flies arrives exactly when the film's blast plays. Everything here is presentation: it
// reads the plan and decides nothing.

export type Faction = 'west' | 'east';

/** One thing that happens to a mission: a blast at a cell, or the mission (or one drone) brought down. */
export interface Outcome {
  /** Seconds from the start of the run. */
  at: number;
  kind: 'boom' | 'intercept';
  /** World point on the ground (cell centre). */
  x: number;
  z: number;
  /** The gun that brought it down, when blue can see it: its muzzle, and whether it is a gun (tracers) or a missile. */
  by?: { from: THREE.Vector3; guns: boolean; calibre: string } | null;
}

export interface Plan {
  side: Side;
  faction: Faction;
  outcomes: Outcome[];
  /** Seconds the film gives the run before the first outcome. */
  approach: number;
}

/** A mission in the air, as the action cam follows it. */
export interface Flight {
  /** Where the camera should look now, and which way it flies (unit), or null once it is gone. */
  readonly pos: THREE.Vector3;
  readonly dir: THREE.Vector3;
  readonly alive: boolean;
}

/** Field size in world units (cells), for the edges they fly in from. */
export interface Field {
  w: number;
  h: number;
}

/**
 * Sizes on the field. Units are drawn at figure scale (1 cell = 10 m, docs/arena-v2.md section 2);
 * what flies in is drawn a little larger so it reads at the battle camera's distance, the jet only
 * a quarter over (an F-35A is two cells long, about two and a half tanks).
 */
const JET_SCALE = 1.25;
const MISSILE_SCALE = 1.9;
const BOMB_SCALE = 1.7;
const DRONE_SCALE = 2.1;
const ROCKET_SCALE = 2.3;
/** Ships are shown at their real size, far out. */
const SHIP_OFF = 26;
const UP = new THREE.Vector3(0, 1, 0);
const JET_SPEED = 13;
/** The jet's bombing run: its height over the target (24 m at figure scale, low enough to stay in the battle camera's frame) and how much higher it starts. */
const RUN_ALT = 2.4;
const RUN_DESCENT = 0.35;
/** How close to the camera the jet's path may come before it fills the lens. */
const CLEAR = 6;
/** Seconds a bomb falls from release to its blast. */
const BOMB_FALL = 0.85;
/** The motion blur behind the jet: how far back each ghost trails (seconds of flight) and how faint. */
const GHOSTS: [number, number][] = [
  [0.018, 0.34],
  [0.036, 0.16],
];

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Act {
  update(dt: number): boolean;
  dispose(): void;
}

/** Orient `o` nose along `dir` with a bank of `roll` radians. */
function orient(o: THREE.Object3D, pos: THREE.Vector3, dir: THREE.Vector3, roll: number, m4: THREE.Matrix4, tmp: THREE.Vector3): void {
  o.position.copy(pos);
  tmp.copy(pos).add(dir);
  m4.lookAt(tmp, pos, UP);
  o.quaternion.setFromRotationMatrix(m4);
  if (roll) o.rotateZ(roll);
}

/** A cubic Bezier point. */
function bezier(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, u: number, out: THREE.Vector3): THREE.Vector3 {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return out.set(a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y, a * p0.z + b * p1.z + c * p2.z + d * p3.z);
}

/** A soft round alpha spot (white in the middle, clear at the rim) for the sea under a ship and its wake. */
function spotTexture(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.round(255 * (1 - r * r) ** 1.6);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = a;
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, n, n);
  t.needsUpdate = true;
  return t;
}

export class Sorties {
  private readonly acts: Act[] = [];
  private readonly shipMat: THREE.MeshBasicMaterial;
  private readonly shipUniforms = { uSea: { value: new THREE.Color() }, uSeat: { value: 0.2 } };
  private readonly seaMat: THREE.MeshBasicMaterial;
  private readonly wakeMat: THREE.MeshBasicMaterial;
  /** The churn at a ship's stern: its own material, as it pulses. */
  private readonly foamMat: THREE.MeshBasicMaterial;
  /** White water standing off the sea round a ship (billboards). */
  private readonly sprayMat: THREE.SpriteMaterial;
  private readonly spot: THREE.DataTexture;
  private readonly seaGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  /** The jet's motion-blur ghosts: lit like it, see-through. */
  private readonly ghostMats: THREE.MeshStandardMaterial[];
  private seq = 0;
  private seed = 1;
  /** Missions flown so far (tests wait on it). */
  launched = 0;
  /**
   * The battle camera as it will stand while it watches a point (a posed camera, used at once): the
   * jet's run is laid so it crosses the frame where it can be seen and never fills the lens. Null
   * flies the plain slant.
   */
  viewAt: ((x: number, z: number) => THREE.Camera) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly fx: Effects,
    private readonly audio: BattleAudio,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly field: Field,
    /** The level of the plain beyond the field under the haze: the sea the ships sit in. */
    private readonly seaLevel: () => number = () => 0,
  ) {
    this.shipMat = new THREE.MeshBasicMaterial({ color: 0x3d4247, fog: false });
    // The hull's foot melts into the sea it sits in, so the waterline is soft, not a cut-out's edge.
    this.shipMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.shipUniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vShipY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvShipY = position.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vShipY;\nuniform vec3 uSea;\nuniform float uSeat;')
        .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, uSea, smoothstep(uSeat, 0.0, vShipY) * 0.85);\n#include <opaque_fragment>');
    };
    this.shipMat.customProgramCacheKey = () => 'brink-ship';
    this.spot = spotTexture();
    this.seaMat = new THREE.MeshBasicMaterial({ color: 0x3d4247, alphaMap: this.spot, transparent: true, depthWrite: false, fog: false });
    this.wakeMat = new THREE.MeshBasicMaterial({ color: 0xf2f3f0, alphaMap: this.spot, transparent: true, depthWrite: false, fog: false, opacity: 0.95 });
    this.foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: this.spot, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
    this.sprayMat = new THREE.SpriteMaterial({ color: 0xf6f7f5, alphaMap: this.spot, transparent: true, depthWrite: false, fog: false, opacity: 1 });
    this.ghostMats = GHOSTS.map(([, a]) => new THREE.MeshStandardMaterial({ color: 0x737b82, roughness: 0.5, metalness: 0.2, transparent: true, opacity: a, depthWrite: false }));
  }

  /** Anything still flying, sailing or falling. */
  get busy(): boolean {
    return this.acts.length > 0;
  }

  /** Little random numbers for the look (never the battle's stream). */
  private r(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Which way a side's missions fly: blue from the south edge north, red the other way. */
  private heading(side: Side): number {
    return side === 'blue' ? -1 : 1;
  }

  /** The z of a side's own edge. */
  private edge(side: Side): number {
    return side === 'blue' ? this.field.h : 0;
  }

  private add(a: Act): void {
    this.acts.push(a);
  }

  update(dt: number): void {
    for (let i = this.acts.length - 1; i >= 0; i--) {
      const a = this.acts[i]!;
      let alive = false;
      try {
        alive = a.update(dt);
      } catch (e) {
        console.warn('sorties: a flight failed and was dropped', e);
      }
      if (!alive) {
        a.dispose();
        this.acts.splice(i, 1);
      }
    }
  }

  /** Everything gone at once (the film skipped, the stage disposed). */
  clear(): void {
    for (const a of this.acts) a.dispose();
    this.acts.length = 0;
  }

  dispose(): void {
    this.clear();
    this.shipMat.dispose();
    this.seaMat.dispose();
    this.wakeMat.dispose();
    this.foamMat.dispose();
    this.sprayMat.dispose();
    this.spot.dispose();
    this.seaGeo.dispose();
    for (const m of this.ghostMats) m.dispose();
  }

  // --- Strike jet --------------------------------------------------------------------------------

  /**
   * The run as flown: in level (easing down onto its bombing height) along `h`, through `ref` at
   * `tRef`; after `tOut` it pulls up into a climbing turn of `bank`. Stepped, so the film and the
   * planning walk the same path.
   */
  private jetPath(ref: THREE.Vector3, tRef: number, alt: number, slant: number, hz: number, bank: number, tOut: number) {
    const h = new THREE.Vector3(Math.sin(slant), 0, hz * Math.cos(slant));
    const runIn = (t: number, out: THREE.Vector3) => {
      out.copy(ref).addScaledVector(h, JET_SPEED * (t - tRef));
      out.y = alt + Math.max(0, tRef - t) * RUN_DESCENT;
      return out;
    };
    /** One step of the pull-out from `pos` with heading state `turn`; returns the new turn. */
    const pull = (t: number, dt: number, turn: number, pos: THREE.Vector3, dir: THREE.Vector3) => {
      const k = t - tOut;
      const next = turn + bank * dt * 0.95;
      dir.set(Math.sin(slant + next), Math.min(0.5, k * 0.6), hz * Math.cos(slant + next)).normalize();
      pos.addScaledVector(dir, JET_SPEED * 1.08 * dt);
      return next;
    };
    /** One step of the fall once hit: the way it had, bleeding off, nosing down ever steeper, turning away. */
    const fall = (dt: number, turn: number, pos: THREE.Vector3, vel: THREE.Vector3) => {
      const next = turn + bank * dt * 1.5;
      const flat = Math.hypot(vel.x, vel.z) * (1 - dt * 0.9);
      vel.x = Math.sin(slant + next) * flat;
      vel.z = hz * Math.cos(slant + next) * flat;
      vel.y -= 8 * dt;
      pos.addScaledVector(vel, dt);
      return next;
    };
    return { h, runIn, pull, fall };
  }

  /** The slant and turn that keep the run clear of the camera watching `aim` (and a little random). */
  private layRun(aim: THREE.Vector3, ref: (slant: number) => THREE.Vector3, tRef: number, alt: number, hz: number, tOut: number, shot: boolean): { slant: number; bank: number } {
    const plain = { slant: (this.r() - 0.5) * 0.7, bank: this.r() < 0.5 ? 1 : -1 };
    const cam = this.viewAt?.(aim.x, aim.z);
    if (!cam) return plain;
    const eye = cam.position;
    let best = plain;
    let score = -Infinity;
    const p = new THREE.Vector3();
    const d = new THREE.Vector3();
    const ndc = new THREE.Vector3();
    for (let s = -0.8; s <= 0.801; s += 0.1) {
      for (const bank of [1, -1]) {
        const path = this.jetPath(ref(s), tRef, alt, s, hz, bank, tOut);
        // How close it comes to the lens while in frame, and how long it is in frame.
        let near = Infinity;
        let seen = 0;
        const look = (q: THREE.Vector3, count = true) => {
          ndc.copy(q).project(cam);
          if (ndc.z > 1 || Math.abs(ndc.x) > 1.15 || Math.abs(ndc.y) > 1.15) return;
          if (count) seen += 0.05;
          near = Math.min(near, q.distanceTo(eye));
        };
        for (let t = 0; t <= tOut; t += 0.05) look(path.runIn(t, p));
        path.runIn(tOut, p);
        let turn = 0;
        if (!shot) {
          for (let t = tOut; t < tOut + 2.2; t += 0.05) {
            turn = path.pull(t, 0.05, turn, p, d);
            look(p);
          }
        } else {
          d.copy(path.h).multiplyScalar(JET_SPEED * 0.85).setY(-0.6);
          for (let t = 0; t < 1.6 && p.y > aim.y; t += 0.05) {
            turn = path.fall(0.05, turn, p, d);
            look(p, false);
          }
        }
        // In frame as long as it can be, never closer than the clearance; a little noise between equals.
        const v = Math.min(near, CLEAR) * 1.5 + Math.min(seen, 1.2) * 4 + this.r() * 0.4 - Math.abs(s) * 0.2;
        if (v > score) {
          score = v;
          best = { slant: s, bank };
        }
      }
    }
    return best;
  }

  /** A strike sortie: F-35A or Su-34 running in at low level from its side's edge. */
  jet(plan: Plan): Flight {
    this.launched++;
    const kind: AirKind = plan.faction === 'west' ? 'f35' : 'su34';
    const bomb: AirKind = plan.faction === 'west' ? 'gbu31' : 'kab500';
    const id = `jet${this.seq++}`;
    const hz = this.heading(plan.side);
    const shot = plan.outcomes.find((o) => o.kind === 'intercept') ?? null;
    const booms = plan.outcomes.filter((o) => o.kind === 'boom');
    const aim = booms[0] ?? shot ?? plan.outcomes[0]!;
    const gy = this.heightAt(aim.x, aim.z);
    const alt = gy + RUN_ALT;
    // Bombs keep most of the jet's way: release short of the target.
    const tRelease = booms.length ? booms[0]!.at - BOMB_FALL : Infinity;
    const lead = JET_SPEED * 0.55 * BOMB_FALL;
    const tRef = Number.isFinite(tRelease) ? tRelease : shot!.at;
    const refFor = (slant: number) => {
      const h = new THREE.Vector3(Math.sin(slant), 0, hz * Math.cos(slant));
      // Brought down just short of its target, where the guns defending it reach and the camera looks.
      return new THREE.Vector3(aim.x, alt, aim.z).addScaledVector(h, Number.isFinite(tRelease) ? -lead : -JET_SPEED * 0.12);
    };
    const tOut = Number.isFinite(tRelease) ? tRelease + 0.15 : tRef;
    // Run in on a slant, not straight down the field, and never through the lens.
    const { slant, bank } = this.layRun(new THREE.Vector3(aim.x, gy, aim.z), refFor, tRef, alt, hz, tOut, !!shot);
    const path = this.jetPath(refFor(slant), tRef, alt, slant, hz, bank, tOut);
    const h = path.h;
    const root = buildAircraft(kind);
    root.scale.setScalar(JET_SCALE);
    this.scene.add(root);
    // Motion blur: faint copies trailing it (not on Low).
    const body = root.children[0] as THREE.Mesh;
    const ghosts = this.fx.density >= 0.5 ? GHOSTS.map(([lag], i) => {
      const g = new THREE.Mesh(body.geometry, this.ghostMats[i]!);
      g.scale.setScalar(JET_SCALE);
      g.renderOrder = 2;
      this.scene.add(g);
      return { g, lag };
    }) : [];
    const s = JET_SCALE * 0.1;
    const nozzles = NOZZLES[kind].map(([x, y, z]) => new THREE.Vector3(x * s, y * s, z * s));
    const tip = WINGTIP[kind];
    const tips = tip ? [new THREE.Vector3(tip[0] * s, tip[1] * s, tip[2] * s), new THREE.Vector3(-tip[0] * s, tip[1] * s, tip[2] * s)] : [];
    const pos = new THREE.Vector3();
    const vel = new THREE.Vector3();
    const dir = new THREE.Vector3().copy(h);
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    const bdir = new THREE.Vector3();
    const bscratch = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    path.runIn(0, pos);
    let t = 0;
    let phase: 'in' | 'out' | 'hit' = 'in';
    let roll = 0;
    let rollV = 0;
    let turn = 0;
    let trail = 0;
    let samSent = false;
    let sonic = false;
    let dropped = 0;
    let gone = false;
    const fx = this.fx;
    const audio = this.audio;
    const flight: Flight = { pos, dir, get alive() { return !gone; } };
    const bombs: { o: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; t0: number; t1: number }[] = [];
    const dropBomb = (o: Outcome, k: number) => {
      const b = buildAircraft(bomb);
      b.scale.setScalar(BOMB_SCALE);
      this.scene.add(b);
      // Off the jet's belly, a little to the side for the second.
      const from = pos.clone().addScaledVector(UP, -0.18).add(tmp.set(k ? 0.2 : -0.2, 0, 0));
      bombs.push({ o: b, from, to: new THREE.Vector3(o.x, this.heightAt(o.x, o.z) + 0.05, o.z), t0: t, t1: Math.max(t + 0.15, o.at) });
    };
    const act: Act = {
      update: (dt) => {
        t += dt;
        const prev = tmp2.copy(pos);
        if (phase === 'in') {
          path.runIn(t, pos);
          // A shallow bank into the run, levelling for the drop.
          roll = -bank * 0.35 * smooth(tRef, tRef - 1.2, t);
          if (shot && !samSent && t >= shot.at - 0.95) {
            samSent = true;
            // The interceptor's missile (or a stream of shells) meets the jet where it will be.
            const meet = path.runIn(shot.at, new THREE.Vector3());
            this.engage(shot, meet, 0.95, 'jet', plan.side);
          }
          if (shot && t >= shot.at) {
            phase = 'hit';
            fx.shatter(pos, vel.copy(h).multiplyScalar(JET_SPEED), 1.3);
            fx.explosion(pos, 0.55, 'airburst');
            audio.impact('he', pos.x - 0.5, pos.z - 0.5);
            vel.copy(h).multiplyScalar(JET_SPEED * 0.85).setY(-0.6);
            rollV = bank * 2.6;
          }
          for (; dropped < booms.length && t >= tRelease + dropped * 0.12; dropped++) dropBomb(booms[dropped]!, dropped);
          if (t >= tOut && !shot) phase = 'out';
          dir.copy(h);
        } else if (phase === 'out') {
          // Pull up and break away, banked hard, on afterburner.
          turn = path.pull(t, dt, turn, pos, dir);
          roll = -bank * Math.min(1.25, (t - tOut) * 2.4);
        } else {
          // Hit: it rolls over, noses down trailing fire and smoke, and goes into the ground.
          turn = path.fall(dt, turn, pos, vel);
          dir.copy(vel).normalize();
          roll += rollV * dt;
          const ground = this.heightAt(pos.x, pos.z);
          if (pos.y <= ground + 0.1) {
            pos.y = ground + 0.05;
            fx.explosion(pos, 1.1, 'he');
            for (let i = 0; i < 6; i++) fx.trailPuff(pos.x + (this.r() - 0.5) * 0.8, pos.y + 0.2, pos.z + (this.r() - 0.5) * 0.8, 'burning', 1.6);
            audio.impact('bombs', pos.x - 0.5, pos.z - 0.5);
            gone = true;
            this.scene.remove(root);
            audio.stop(id);
            return false;
          }
        }
        if (!sonic && Number.isFinite(tRelease) && t >= tRelease + BOMB_FALL * 0.5) {
          sonic = true;
          audio.sonic(pos.x - 0.5, pos.z - 0.5);
        }
        orient(root, pos, dir, roll, m4, tmp);
        for (const { g, lag } of ghosts) {
          g.position.copy(pos).addScaledVector(dir, -JET_SPEED * lag);
          g.quaternion.copy(root.quaternion);
          g.visible = phase !== 'hit';
        }
        // Engines: afterburner in the run and the climb, a dying glow once hit.
        root.updateMatrixWorld(true);
        const step = prev.distanceTo(pos);
        if (phase !== 'hit') {
          for (const n of nozzles) fx.exhaust(root.localToWorld(tmp.copy(n).divideScalar(JET_SCALE)), dir, 1, phase === 'out' ? 'afterburner' : 'jet');
          // Speed lines off the wingtips and down the spine.
          const len = Math.min(1.6, step * 5);
          for (const w of tips) fx.speedStreak(root.localToWorld(tmp.copy(w).divideScalar(JET_SCALE)), dir, len, 0.014);
          fx.speedStreak(root.localToWorld(tmp.set(0, 0.12, -0.4)), dir, len * 0.8, 0.02, 0.6);
        }
        trail += step;
        const spacing = (phase === 'hit' ? 0.35 : 0.55) / Math.max(0.3, fx.density);
        while (trail >= spacing) {
          trail -= spacing;
          if (phase === 'hit') {
            fx.trailPuff(pos.x, pos.y, pos.z, 'burning', 1.4);
          } else {
            const n = nozzles[0];
            if (n) {
              root.localToWorld(tmp.copy(n).divideScalar(JET_SCALE));
              fx.trailPuff(tmp.x, tmp.y, tmp.z, 'contrail', 0.6);
            }
            // Vapour off the wingtips in the pull.
            if (phase === 'out') for (const w of tips) {
              root.localToWorld(tmp.copy(w).divideScalar(JET_SCALE));
              fx.trailPuff(tmp.x, tmp.y, tmp.z, 'contrail', 0.35);
            }
          }
        }
        for (let i = bombs.length - 1; i >= 0; i--) {
          const b = bombs[i]!;
          const u = Math.min(1, (t - b.t0) / (b.t1 - b.t0));
          // Way kept, falling ever faster: the nose drops as it goes.
          tmp.lerpVectors(b.from, b.to, u);
          tmp.y = b.from.y + (b.to.y - b.from.y) * u * u;
          bdir.set(b.to.x - b.from.x, (b.to.y - b.from.y) * 2 * Math.max(0.05, u), b.to.z - b.from.z).normalize();
          orient(b.o, tmp, bdir, 0, m4, bscratch);
          if (u >= 1) {
            this.scene.remove(b.o);
            bombs.splice(i, 1);
          }
        }
        audio.flyer(id, 'jet', pos.x - 0.5, pos.z - 0.5);
        const off = pos.x < -12 || pos.x > this.field.w + 12 || pos.z < -14 || pos.z > this.field.h + 14 || pos.y > 40 || pos.y < this.heightAt(pos.x, pos.z) - 1;
        if ((t > 1 && off && !bombs.length) || t > 9) {
          gone = true;
          return false;
        }
        return true;
      },
      dispose: () => {
        gone = true;
        this.scene.remove(root);
        for (const { g } of ghosts) this.scene.remove(g);
        for (const b of bombs) this.scene.remove(b.o);
        audio.stop(id);
      },
    };
    this.add(act);
    return flight;
  }

  /**
   * Air defence engaging something in the air: a stream of tracers from a gun, or a missile from a
   * launcher, arriving at `meet` in `lead` seconds. Unseen guns show nothing of where they are: the
   * kill comes out of the sky.
   */
  private engage(o: Outcome, meet: THREE.Vector3, lead: number, target: 'jet' | 'missile' | 'drone', mission: Side): void {
    const by = o.by;
    if (!by) return;
    if (by.guns) {
      // Bursts walking onto it over the last half second.
      const shots = Math.round(4 + 6 * this.fx.density);
      for (let i = 0; i < shots; i++) {
        const k = i / shots;
        const to = meet.clone().add(new THREE.Vector3((this.r() - 0.5) * (1 - k) * 1.6, (this.r() - 0.5) * (1 - k) * 1.2, (this.r() - 0.5) * (1 - k) * 1.6));
        this.later(Math.max(0, lead - 0.55) + k * 0.45, () => this.fx.tracer(by.from, to, by.calibre, mission === 'blue' ? 'red' : 'blue', 0.12 + by.from.distanceTo(to) * 0.012));
      }
      this.audio.shot(by.calibre, by.from.x - 0.5, by.from.z - 0.5, { burst: target === 'drone' ? 10 : 16 });
    } else {
      this.fx.missile(by.from, meet, 'manpads', lead);
      this.audio.shot('manpads', by.from.x - 0.5, by.from.z - 0.5);
    }
  }

  /** Run `fn` after `seconds` on the film's clock (`always`: also when everything is cleared first, for clean-up). */
  after(seconds: number, fn: () => void, always = false): void {
    let t = 0;
    let ran = false;
    this.add({
      update: (dt) => {
        t += dt;
        if (t < seconds) return true;
        ran = true;
        fn();
        return false;
      },
      dispose: () => {
        if (!ran && always) fn();
      },
    });
  }

  private later(seconds: number, fn: () => void): void {
    this.after(seconds, fn);
  }

  // --- Cruise missile ----------------------------------------------------------------------------

  /** A Tomahawk or Kalibr: off the booster, skimming in low, popping up and diving on the cell. */
  cruise(plan: Plan): Flight {
    this.launched++;
    const kind: AirKind = plan.faction === 'west' ? 'tomahawk' : 'kalibr';
    const id = `cm${this.seq++}`;
    const o = plan.outcomes[0]!;
    const shot = o.kind === 'intercept';
    // Shot down at the top of its climb, where the guns see it best.
    const T = shot ? o.at / 0.93 : o.at;
    const hz = this.heading(plan.side);
    const slant = (this.r() - 0.5) * 0.6;
    const span = 26;
    const start = new THREE.Vector3(o.x - Math.sin(slant) * span, 0, o.z - hz * Math.cos(slant) * span);
    const end = new THREE.Vector3(o.x, this.heightAt(o.x, o.z) + 0.05, o.z);
    const at = (u: number, out: THREE.Vector3) => {
      out.lerpVectors(start, end, u);
      const g = this.heightAt(out.x, out.z);
      // Sea-skimming over the ground, the pop-up, then the dive onto the cell.
      const skim = g + 0.45;
      const top = Math.max(g, end.y) + 2.6;
      if (u < 0.78) out.y = skim;
      else if (u < 0.9) out.y = skim + (top - skim) * smooth(0.78, 0.9, u);
      else out.y = top + (end.y - top) * ((u - 0.9) / 0.1) ** 1.6;
      return out;
    };
    const root = buildAircraft(kind);
    root.scale.setScalar(MISSILE_SCALE);
    this.scene.add(root);
    const booster = kind === 'tomahawk' ? buildAircraft('booster') : null;
    if (booster) {
      booster.position.z = -(AIR_LENGTH[kind] / 2 + 0.35) * 0.1;
      root.add(booster);
    }
    const nozzle = new THREE.Vector3(...NOZZLES[kind][0]!).multiplyScalar(0.1);
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    at(0, pos);
    let t = 0;
    let trail = 0;
    let gone = false;
    let engaged = false;
    let falling: { o: THREE.Group; v: THREE.Vector3; t: number } | null = null;
    const BOOST = 0.55;
    const flight: Flight = { pos, dir, get alive() { return !gone; } };
    this.audio.incoming(o.x - 0.5, o.z - 0.5, Math.max(0.2, o.at));
    const act: Act = {
      update: (dt) => {
        t += dt;
        if (!gone) {
          const u = Math.min(1, t / T);
          tmp2.copy(pos);
          at(u, pos);
          at(Math.min(1, u + 0.01), dir).sub(pos);
          if (dir.lengthSq() < 1e-8) dir.set(0, -1, 0);
          dir.normalize();
          orient(root, pos, dir, 0, m4, tmp);
          root.updateMatrixWorld(true);
          // The booster burns out and falls away.
          if (booster && t >= BOOST && booster.parent === root) {
            root.remove(booster);
            booster.scale.setScalar(MISSILE_SCALE);
            this.scene.add(booster);
            booster.position.copy(pos).addScaledVector(dir, -0.35);
            falling = { o: booster, v: dir.clone().multiplyScalar(4), t: 0 };
          }
          const boosting = t < BOOST && !!booster;
          const n = boosting ? tmp.set(0, 0, -(AIR_LENGTH[kind] / 2 + 0.75) * 0.1) : tmp.copy(nozzle);
          root.localToWorld(n);
          this.fx.exhaust(n, dir, boosting ? 1.2 : 0.7, boosting ? 'booster' : 'motor');
          const step = tmp2.distanceTo(pos);
          this.fx.speedStreak(n, dir, Math.min(1.2, step * 5), 0.012, 0.7);
          trail += step;
          const spacing = 0.32 / Math.max(0.3, this.fx.density);
          while (trail >= spacing) {
            trail -= spacing;
            this.fx.trailPuff(n.x, n.y, n.z, 'missile', boosting ? 1.1 : 0.6);
          }
          this.audio.flyer(id, 'cruise', pos.x - 0.5, pos.z - 0.5);
          if (shot && !engaged && t >= o.at - 0.8) {
            engaged = true;
            this.engage(o, at(Math.min(1, o.at / T), new THREE.Vector3()), 0.8, 'missile', plan.side);
          }
          if (shot && t >= o.at) {
            this.fx.shatter(pos, tmp.copy(dir).multiplyScalar(18), 1.1);
            this.audio.impact('he', pos.x - 0.5, pos.z - 0.5);
            gone = true;
            this.scene.remove(root);
            this.audio.stop(id);
          } else if (!shot && u >= 1) {
            gone = true;
            this.scene.remove(root);
            this.audio.stop(id);
          }
        }
        if (falling) {
          const f = falling;
          f.t += dt;
          f.v.y -= 4.5 * dt;
          f.o.position.addScaledVector(f.v, dt);
          f.o.rotateX(dt * 3);
          if (f.t > 1.4) {
            this.scene.remove(f.o);
            falling = null;
          }
        }
        return !gone || !!falling;
      },
      dispose: () => {
        gone = true;
        this.scene.remove(root);
        if (falling) this.scene.remove(falling.o);
        this.audio.stop(id);
      },
    };
    this.add(act);
    return flight;
  }

  // --- Naval gunfire -----------------------------------------------------------------------------

  /** A destroyer (or cruiser) far off its side's edge, its gun walking shells over the target. */
  naval(plan: Plan, fog: THREE.Color | null): { ship: THREE.Vector3; gun: THREE.Vector3 } {
    this.launched++;
    const kind: ShipKind = plan.faction === 'west' ? 'burke' : 'slava';
    const hz = this.heading(plan.side);
    const mesh = new THREE.Mesh(shipGeometry(kind), this.shipMat);
    // Grey on grey in the haze: the ship is a silhouette on the horizon, sitting in a darker sea.
    this.shipMat.color.setHex(0x434a50);
    const sea = this.shipUniforms.uSea.value.setHex(0x4c5559);
    if (fog) {
      this.shipMat.color.lerp(fog, 0.42);
      sea.lerp(fog, 0.55);
    }
    this.seaMat.color.copy(sea).multiplyScalar(0.94);
    const cx = this.field.w / 2 + (this.r() - 0.5) * 14;
    const cz = this.edge(plan.side) - hz * SHIP_OFF;
    // Broadside on, bow toward one side, its gun trained on the field.
    const bow = this.r() < 0.5 ? 1 : -1;
    // Seated in the sea: the waterline a little under the level of the plain beyond the field (the
    // haze's floor), never above it, so the hull stands out of the water rather than over it.
    const level = Math.min(this.seaLevel(), this.heightAt(Math.min(this.field.w, Math.max(0, cx)), this.edge(plan.side)));
    mesh.position.set(cx, level - 0.12, cz);
    mesh.rotation.y = bow > 0 ? Math.PI / 2 : -Math.PI / 2;
    mesh.updateMatrixWorld(true);
    this.scene.add(mesh);
    // The sea round it (a darker patch fading into the haze), a bow wave, the white water along its
    // side, a long wake streaming from the stern with the two arms of its V spreading behind, and
    // the churn at the screws: a ship under way, read from 26 cells off.
    const len = SHIP_LENGTH[kind] * 0.1;
    const water = new THREE.Mesh(this.seaGeo, this.seaMat);
    water.scale.set(len * 4.2, 1, len * 1.3);
    water.position.set(cx - bow * len * 0.6, level + 0.01, cz);
    water.renderOrder = -1;
    const wake = new THREE.Mesh(this.seaGeo, this.wakeMat);
    wake.scale.set(len * 1.25, 1, 2.6);
    wake.position.set(cx - bow * len * 0.08, level + 0.02, cz);
    const trail = new THREE.Mesh(this.seaGeo, this.wakeMat);
    trail.scale.set(len * 2.6, 1, 2.2);
    trail.position.set(cx - bow * len * 1.55, level + 0.018, cz);
    const arms = [1, -1].map((k) => {
      const arm = new THREE.Mesh(this.seaGeo, this.wakeMat);
      arm.scale.set(len * 2.1, 1, 0.9);
      arm.rotation.y = k * bow * 0.3;
      arm.position.set(cx - bow * len * 1.45, level + 0.016, cz + k * len * 0.32);
      return arm;
    });
    const bowWave = new THREE.Mesh(this.seaGeo, this.wakeMat);
    bowWave.scale.set(len * 0.26, 1, 3.4);
    bowWave.position.set(cx + bow * len * 0.47, level + 0.025, cz);
    const churn = new THREE.Mesh(this.seaGeo, this.foamMat);
    churn.scale.set(len * 0.4, 1, 3);
    churn.position.set(cx - bow * len * 0.55, level + 0.03, cz);
    // White water standing up off the sea at the bow, the stern and down the wake, on the near side
    // of the hull: billboards, so they read from the low cut at the field's edge too, where the flat
    // wake is edge-on.
    const near = cz + hz * 1.1;
    const foam = [
      [cx + bow * len * 0.46, 0.3],
      [cx - bow * len * 0.52, 0.25],
      [cx - bow * len * 1.3, 0.12],
      [cx - bow * len * 0.04, 0.1],
    ].map(([x, h], i) => {
      const f = new THREE.Sprite(this.sprayMat);
      f.position.set(x!, level + h!, near);
      // Bow and stern: a burst; astern: a long low band; along the side: the wash at the waterline.
      f.scale.set(len * (i === 2 ? 1.5 : i === 3 ? 1.0 : 0.4), i === 2 ? 0.35 : i === 3 ? 0.5 : 0.8, 1);
      return f;
    });
    this.scene.add(water, trail, ...arms, wake, bowWave, churn, ...foam);
    const guns = SHIP_GUNS[kind].map(([x, y, z]) => mesh.localToWorld(new THREE.Vector3(x * 0.1, y * 0.1, z * 0.1)));
    const gun = guns[0]!;
    const toField = new THREE.Vector3(0, 0, -hz);
    const fx = this.fx;
    const audio = this.audio;
    let t = 0;
    const last = Math.max(...plan.outcomes.map((o) => o.at));
    const shells = plan.outcomes
      .filter((o) => o.kind === 'boom')
      .map((o) => {
        const flight = Math.min(o.at, 2.1);
        return { o, launch: o.at - flight, flight, fired: false };
      });
    this.add({
      update: (dt) => {
        t += dt;
        // The screws' white water boils: a slow swell of its size and brightness.
        const boil = Math.sin(t * 5.3) * 0.5 + Math.sin(t * 8.9 + 1.3) * 0.5;
        churn.scale.set(len * (0.4 + boil * 0.04), 1, 3 + boil * 0.35);
        this.foamMat.opacity = 0.85 + boil * 0.15;
        foam[0]!.scale.set(len * (0.3 + boil * 0.02), 0.9 + boil * 0.15, 1);
        foam[1]!.scale.set(len * (0.5 + boil * 0.03), 0.75 + boil * 0.1, 1);
        for (const s of shells) {
          if (s.fired || t < s.launch) continue;
          s.fired = true;
          const from = gun.clone().add(new THREE.Vector3(0, 0.8, 0));
          fx.farFlash(gun, toField, kind === 'slava' ? 1.2 : 1);
          fx.shell(from, new THREE.Vector3(s.o.x, this.heightAt(s.o.x, s.o.z), s.o.z), s.flight);
          audio.shot('155', gun.x - 0.5, gun.z - 0.5);
          audio.incoming(s.o.x - 0.5, s.o.z - 0.5, s.flight);
        }
        return t < last + 2.5;
      },
      dispose: () => {
        this.scene.remove(mesh, water, trail, ...arms, wake, bowWave, churn, ...foam);
      },
    });
    return { ship: mesh.position.clone(), gun };
  }

  // --- Kamikaze swarm ----------------------------------------------------------------------------

  /** Three one-way drones from their side's edge, weaving in at low level; each dives or is shot down. */
  swarm(plan: Plan): Flight {
    this.launched++;
    const kind: AirKind = plan.faction === 'west' ? 'lucas' : 'shahed';
    const hz = this.heading(plan.side);
    const FLY = 2.8;
    const lead: Flight = { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, hz), alive: true };
    plan.outcomes.forEach((o, i) => {
      const id = `kz${this.seq++}`;
      const shot = o.kind === 'intercept';
      const s0 = Math.max(0, o.at - FLY);
      const dur = Math.max(0.4, o.at - s0);
      // Shot down in the run, before it tips into its dive.
      const T = shot ? dur / 0.82 : dur;
      const target = new THREE.Vector3(o.x, this.heightAt(o.x, o.z) + 0.05, o.z);
      const span = 20 + i * 2;
      const side = (i - 1) * 1.3 + (this.r() - 0.5) * 0.6;
      const start = new THREE.Vector3(o.x + side, 0, o.z - hz * span);
      const dive = target.clone().add(new THREE.Vector3(0, 0, -hz * 1.6));
      const phase = this.r() * Math.PI * 2;
      const weave = 0.3 + this.r() * 0.25;
      const DIVE = Math.min(0.42, T * 0.2) / T;
      const at = (u: number, out: THREE.Vector3) => {
        if (u < 1 - DIVE) {
          const k = u / (1 - DIVE);
          out.lerpVectors(start, dive, k);
          // Weaving across the line and bobbing, settling as it nears.
          const w = Math.sin(k * Math.PI * 3.2 + phase) * weave * (1 - k * 0.8);
          out.x += w;
          out.y = Math.max(this.heightAt(out.x, out.z), target.y) + 2.3 + Math.sin(k * 9 + phase) * 0.12;
        } else {
          const k = (u - (1 - DIVE)) / DIVE;
          const top = Math.max(this.heightAt(dive.x, dive.z), target.y) + 2.3;
          out.lerpVectors(dive, target, k);
          out.y = top + (target.y - top) * k * k;
        }
        return out;
      };
      const root = buildAircraft(kind);
      root.scale.setScalar(DRONE_SCALE);
      root.visible = false;
      this.scene.add(root);
      const prop = root.getObjectByName('prop') ?? null;
      const pos = new THREE.Vector3();
      const dir = new THREE.Vector3(0, 0, hz);
      const tmp = new THREE.Vector3();
      const m4 = new THREE.Matrix4();
      let t = 0;
      let engaged = false;
      this.add({
        update: (dt) => {
          t += dt;
          if (t < s0) return true;
          const u = Math.min(1, (t - s0) / T);
          at(u, pos);
          at(Math.min(1, u + 0.01), dir).sub(pos);
          if (dir.lengthSq() < 1e-8) dir.set(0, -1, 0);
          dir.normalize();
          root.visible = true;
          const bankNow = -Math.cos(((u / (1 - DIVE)) * Math.PI * 3.2 + phase)) * 0.5;
          orient(root, pos, dir, u < 1 - DIVE ? bankNow : 0, m4, tmp);
          if (prop) prop.rotation.z += dt * 70;
          if (i === 0) {
            lead.pos.copy(pos);
            lead.dir.copy(dir);
          }
          this.audio.flyer(id, 'moped', pos.x - 0.5, pos.z - 0.5);
          if (shot && !engaged && t >= o.at - 0.7) {
            engaged = true;
            this.engage(o, at(Math.min(1, (o.at - s0) / T), new THREE.Vector3()), 0.7, 'drone', plan.side);
          }
          if (shot && t >= o.at) {
            this.fx.shatter(pos, tmp.copy(dir).multiplyScalar(5), 0.8);
            this.audio.impact('small', pos.x - 0.5, pos.z - 0.5);
            return false;
          }
          if (!shot && u >= 1) return false;
          return true;
        },
        dispose: () => {
          this.scene.remove(root);
          this.audio.stop(id);
        },
      });
    });
    return lead;
  }

  // --- Rocket artillery --------------------------------------------------------------------------

  /**
   * HIMARS (west) or Tornado-G (east) from off the map. The launcher stands well beyond its side's
   * edge: each rocket climbs out of the haze there as a bright streak, arcs over and comes down on
   * time. GMLRS flies a pair, high, then pitches over into its near-vertical terminal dive onto the
   * cell; the Tornado-G ripples a salvo of 122 mm rockets on lower arcs, spread over the blasts.
   */
  rockets(plan: Plan, launcher: 'himars' | 'tornado'): { flight: Flight; from: THREE.Vector3 } {
    this.launched++;
    const kind: AirKind = launcher === 'himars' ? 'gmlrs' : 'grad';
    const hz = this.heading(plan.side);
    const booms = plan.outcomes.filter((o) => o.kind === 'boom');
    const first = booms[0] ?? plan.outcomes[0]!;
    const lead: Flight = { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), alive: true };
    // The launcher: off the edge behind its own side, a little to one side of the target.
    const lx = Math.min(this.field.w + 6, Math.max(-6, first.x + (this.r() - 0.5) * 16));
    const lz = this.edge(plan.side) - hz * 22;
    const base = Math.min(this.seaLevel(), this.heightAt(Math.min(this.field.w, Math.max(0, lx)), this.edge(plan.side)));
    const salvo: { to: THREE.Vector3; arrive: number; fly: number }[] = [];
    if (launcher === 'himars') {
      for (let i = 0; i < 2; i++) {
        const o = booms[Math.min(i, booms.length - 1)] ?? first;
        salvo.push({ to: new THREE.Vector3(o.x + (i ? 0.25 : 0), 0, o.z + (i ? -0.2 : 0)), arrive: o.at + i * 0.1, fly: Math.min(o.at, 2.2) });
      }
    } else {
      // A ripple: one rocket every few hundredths of a second, fewer drawn on Low.
      const n = Math.round(10 + 10 * this.fx.density);
      for (let i = 0; i < n; i++) {
        const o = booms[i % Math.max(1, booms.length)] ?? first;
        const a = this.r() * Math.PI * 2;
        const d = Math.sqrt(this.r()) * 1.1;
        const arrive = Math.max(0.6, o.at - 0.12 + (this.r() - 0.5) * 0.3);
        salvo.push({ to: new THREE.Vector3(o.x + Math.cos(a) * d, 0, o.z + Math.sin(a) * d), arrive, fly: Math.min(arrive, 1.9) });
      }
      salvo.sort((a, b) => a.arrive - b.arrive);
    }
    this.audio.incoming(first.x - 0.5, first.z - 0.5, Math.max(0.2, first.at));
    const nozzle = new THREE.Vector3(...NOZZLES[kind][0]!).multiplyScalar(0.1);
    salvo.forEach((r, i) => {
      r.to.y = this.heightAt(r.to.x, r.to.z) + 0.03;
      const launch = r.arrive - r.fly;
      const from = new THREE.Vector3(lx + (this.r() - 0.5) * 0.8, base + 0.3, lz);
      const dist = Math.hypot(r.to.x - from.x, r.to.z - from.z);
      const p0 = from;
      let p1: THREE.Vector3;
      let p2: THREE.Vector3;
      if (kind === 'gmlrs') {
        // Steep out of the pod, high over, then straight down onto the cell.
        const apex = Math.min(16, Math.max(10, dist * 0.3));
        p1 = from.clone().add(new THREE.Vector3((r.to.x - from.x) * 0.15, apex, (r.to.z - from.z) * 0.15));
        p2 = r.to.clone().add(new THREE.Vector3(0, apex * 0.95, 0));
      } else {
        const apex = Math.min(9, Math.max(5, dist * 0.18));
        p1 = from.clone().add(new THREE.Vector3((r.to.x - from.x) * 0.3, apex, (r.to.z - from.z) * 0.3));
        p2 = from.clone().add(new THREE.Vector3((r.to.x - from.x) * 0.8, apex * 0.7, (r.to.z - from.z) * 0.8));
      }
      const root = buildAircraft(kind);
      root.scale.setScalar(ROCKET_SCALE);
      root.visible = false;
      this.scene.add(root);
      const pos = new THREE.Vector3();
      const prev = new THREE.Vector3();
      const dir = new THREE.Vector3();
      const tmp = new THREE.Vector3();
      const m4 = new THREE.Matrix4();
      let t = 0;
      let trail = 0;
      // Not every 122 mm rocket smokes on Low: every rocket's trail would be the whole budget.
      const smokes = kind === 'gmlrs' || i % (this.fx.density >= 0.7 ? 1 : 2) === 0;
      this.add({
        update: (dt) => {
          t += dt;
          if (t < launch) return true;
          // The curve's own spacing gives the pace: slow over the top, fast down onto the cell.
          const k = Math.min(1, (t - launch) / r.fly);
          const u = k;
          prev.copy(pos);
          bezier(p0, p1, p2, r.to, Math.min(1, u), pos);
          bezier(p0, p1, p2, r.to, Math.min(1, u + 0.01), dir).sub(pos);
          if (dir.lengthSq() < 1e-8) dir.set(0, -1, 0);
          dir.normalize();
          if (!root.visible) {
            root.visible = true;
            prev.copy(pos);
            // The launch: a flash and a puff of the motor's smoke at the rail.
            if (i === 0 || kind === 'gmlrs' || i % 4 === 0) this.fx.farFlash(from, dir, kind === 'gmlrs' ? 0.5 : 0.3);
          }
          orient(root, pos, dir, 0, m4, tmp);
          root.updateMatrixWorld(true);
          root.localToWorld(tmp.copy(nozzle));
          const step = prev.distanceTo(pos);
          this.fx.exhaust(tmp, dir, kind === 'gmlrs' ? 0.9 : 0.65, k < 0.25 ? 'booster' : 'motor');
          // A motor's glare reads as a bright point however far the camera stands (a lit tail is
          // what the eye picks out of the sky); every rocket of a ripple on High, every other on Low.
          if (kind === 'gmlrs' || smokes) this.fx.motorGlow(tmp, kind === 'gmlrs' ? 1.1 : 0.75);
          this.fx.speedStreak(tmp, dir, Math.min(2.2, step * 4), kind === 'gmlrs' ? 0.03 : 0.02);
          if (smokes) {
            trail += step;
            const spacing = (kind === 'gmlrs' ? 0.38 : 0.6) / Math.max(0.3, this.fx.density);
            while (trail >= spacing) {
              trail -= spacing;
              this.fx.trailPuff(tmp.x, tmp.y, tmp.z, 'missile', kind === 'gmlrs' ? 0.9 : 0.55);
            }
          }
          if (i === 0) {
            lead.pos.copy(pos);
            lead.dir.copy(dir);
          }
          if (k >= 1) return false;
          return true;
        },
        dispose: () => {
          this.scene.remove(root);
        },
      });
    });
    return { flight: lead, from: new THREE.Vector3(lx, base, lz) };
  }
}
