import * as THREE from 'three';
import { AIR_LENGTH, NOZZLES, SHIP_GUNS, WINGTIP, buildAircraft, shipGeometry, type AirKind, type ShipKind } from '../models3d/aircraft';
import type { BattleAudio } from '../audio';
import type { Effects } from './effects';
import type { Side } from './palette';

// Off-map support as the film flies it (docs/arena-v2.md, section 14): strike jets that run in from
// their side's edge, drop two bombs and pull away (or take a missile, burn and fall away off the
// field), cruise missiles that skim in low and pop up to dive, a ship on the horizon walking 5-inch
// shells over the target, and a kamikaze swarm of three one-way drones weaving in, each one shot at
// on its own. The stage gives each mission its timeline: when each blast or interception happens,
// measured from the start of the run, so what flies arrives exactly when the film's blast plays.
// Everything here is presentation: it reads the plan and decides nothing.

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

const JET_SCALE = 2.2;
const MISSILE_SCALE = 3;
const BOMB_SCALE = 2.6;
const DRONE_SCALE = 3.4;
/** Ships are shown at their real size, far out. */
const SHIP_OFF = 26;
const UP = new THREE.Vector3(0, 1, 0);
const JET_SPEED = 15;
/** Seconds a bomb falls from release to its blast. */
const BOMB_FALL = 0.8;

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

export class Sorties {
  private readonly acts: Act[] = [];
  private readonly shipMat: THREE.MeshBasicMaterial;
  private seq = 0;
  private seed = 1;
  /** Missions flown so far (tests wait on it). */
  launched = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly fx: Effects,
    private readonly audio: BattleAudio,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly field: Field,
  ) {
    this.shipMat = new THREE.MeshBasicMaterial({ color: 0x3d4247, fog: false });
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
  }

  // --- Strike jet --------------------------------------------------------------------------------

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
    // Run in on a slant, not straight down the field.
    const slant = (this.r() - 0.5) * 0.7;
    const h = new THREE.Vector3(Math.sin(slant), 0, hz * Math.cos(slant)).normalize();
    const gy = this.heightAt(aim.x, aim.z);
    const alt = gy + 4.6;
    // Bombs keep most of the jet's way: release short of the target.
    const tRelease = booms.length ? booms[0]!.at - BOMB_FALL : Infinity;
    const lead = JET_SPEED * 0.55 * BOMB_FALL;
    const release = new THREE.Vector3(aim.x, alt, aim.z).addScaledVector(h, -lead);
    // Where it is at time t while it runs in (level, easing down onto its bombing height).
    const tRef = Number.isFinite(tRelease) ? tRelease : shot!.at;
    const refPoint = Number.isFinite(tRelease) ? release : new THREE.Vector3(aim.x, alt, aim.z).addScaledVector(h, -JET_SPEED * 0.4);
    const runIn = (t: number, out: THREE.Vector3) => {
      out.copy(refPoint).addScaledVector(h, JET_SPEED * (t - tRef));
      out.y = alt + Math.max(0, tRef - t) * 0.9;
      return out;
    };
    const root = buildAircraft(kind);
    root.scale.setScalar(JET_SCALE);
    this.scene.add(root);
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
    runIn(0, pos);
    let t = 0;
    let phase: 'in' | 'out' | 'hit' = 'in';
    let roll = 0;
    let rollV = 0;
    let turn = 0;
    const bank = this.r() < 0.5 ? 1 : -1;
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
          runIn(t, pos);
          if (shot && !samSent && t >= shot.at - 0.95) {
            samSent = true;
            // The interceptor's missile (or a stream of shells) meets the jet where it will be.
            const meet = runIn(shot.at, new THREE.Vector3());
            this.engage(shot, meet, 0.95, 'jet', plan.side);
          }
          if (shot && t >= shot.at) {
            phase = 'hit';
            fx.shatter(pos, vel.copy(h).multiplyScalar(JET_SPEED), 1.3);
            fx.explosion(pos, 0.55, 'airburst');
            audio.impact('he', pos.x - 0.5, pos.z - 0.5);
            rollV = bank * 2.6;
          }
          for (; dropped < booms.length && t >= tRelease + dropped * 0.12; dropped++) dropBomb(booms[dropped]!, dropped);
          if (t >= tRelease + 0.15 && !shot) phase = 'out';
          dir.copy(h);
        } else if (phase === 'out') {
          // Pull up and break away, banked hard.
          const k = t - tRelease;
          turn += bank * dt * 0.55;
          dir.set(Math.sin(slant + turn), Math.min(0.55, k * 0.5), hz * Math.cos(slant + turn)).normalize();
          pos.addScaledVector(dir, JET_SPEED * 1.08 * dt);
          roll = -bank * Math.min(1.25, k * 2.2);
        } else {
          // Hit: it rolls over, noses down and trails fire and smoke off the field.
          vel.y -= 1.1 * dt;
          turn += bank * dt * 0.4;
          vel.x = Math.sin(slant + turn) * JET_SPEED * 0.85;
          vel.z = hz * Math.cos(slant + turn) * JET_SPEED * 0.85;
          pos.addScaledVector(vel, dt);
          dir.copy(vel).normalize();
          roll += rollV * dt;
        }
        if (!sonic && Number.isFinite(tRelease) && t >= tRelease + BOMB_FALL * 0.5) {
          sonic = true;
          audio.sonic(pos.x - 0.5, pos.z - 0.5);
        }
        orient(root, pos, dir, roll, m4, tmp);
        // Engines: afterburner in the run and the climb, a dying glow once hit.
        root.updateMatrixWorld(true);
        const step = prev.distanceTo(pos);
        if (phase !== 'hit') for (const n of nozzles) fx.exhaust(root.localToWorld(tmp.copy(n).divideScalar(JET_SCALE)), dir, 1.25, phase === 'out' ? 'afterburner' : 'jet');
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
              fx.trailPuff(tmp.x, tmp.y, tmp.z, 'contrail', 0.8);
            }
            // Vapour off the wingtips in the pull.
            if (phase === 'out') for (const w of tips) {
              root.localToWorld(tmp.copy(w).divideScalar(JET_SCALE));
              fx.trailPuff(tmp.x, tmp.y, tmp.z, 'contrail', 0.45);
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
    const T = shot ? o.at / 0.86 : o.at;
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
      const top = Math.max(g, end.y) + 3.4;
      if (u < 0.7) out.y = skim;
      else if (u < 0.88) out.y = skim + (top - skim) * smooth(0.7, 0.88, u);
      else out.y = top + (end.y - top) * ((u - 0.88) / 0.12) ** 1.6;
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
          this.fx.exhaust(n, dir, boosting ? 1.4 : 0.8, boosting ? 'booster' : 'motor');
          trail += tmp2.distanceTo(pos);
          const spacing = 0.32 / Math.max(0.3, this.fx.density);
          while (trail >= spacing) {
            trail -= spacing;
            this.fx.trailPuff(n.x, n.y, n.z, 'missile', boosting ? 1.2 : 0.7);
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
    // Grey on grey in the haze: the ship is a silhouette on the horizon.
    this.shipMat.color.setHex(0x434a50);
    if (fog) this.shipMat.color.lerp(fog, 0.42);
    const cx = this.field.w / 2 + (this.r() - 0.5) * 14;
    const cz = this.edge(plan.side) - hz * SHIP_OFF;
    // Broadside on, bow toward one side, its gun trained on the field.
    const bow = this.r() < 0.5 ? 1 : -1;
    // Its waterline a little under the plain beyond the field (the ground at the field's edge).
    mesh.position.set(cx, this.heightAt(Math.min(this.field.w, Math.max(0, cx)), this.edge(plan.side)) - 0.6, cz);
    mesh.rotation.y = bow > 0 ? Math.PI / 2 : -Math.PI / 2;
    mesh.updateMatrixWorld(true);
    this.scene.add(mesh);
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
        this.scene.remove(mesh);
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
      const side = (i - 1) * 3.5 + (this.r() - 0.5) * 2;
      const start = new THREE.Vector3(o.x + side, 0, o.z - hz * span);
      const dive = target.clone().add(new THREE.Vector3(0, 0, -hz * 1.6));
      const phase = this.r() * Math.PI * 2;
      const weave = 0.5 + this.r() * 0.4;
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
}
