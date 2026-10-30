import * as THREE from 'three';
import { H, W, typeOf, type Battle, type BattleEvent, type Effect, type Point, type Side, type TypeId, type Unit, type UnitType } from '@brink/arena';
import { BattleAudio } from './audio';
import { Effects } from './fx';
import { buildModel, buildProjectile, kitFor, paintFor, SoldierCrowd, type UnitModel } from './models3d';
import { LEVEL, METRE, QUALITY, type ArenaSettings, type Motion, type Quality } from './quality';
import { buildWorld, thermalMaterialFor, type World } from './world';
import type { Library } from './assets';
import { FieldHud, type BadgeState, type EdgePointer, type Tone, type Weight } from './hud';
import { BREW_UP_STOP, HIT_STOP, TRAUMA, beatsOf, keysOf, lastKills, levelWord, rungOf, shakes, type Beat, type FireEvent, type Rung, type Volley } from './film';
import { badgeStatus, classOf, health } from './units';

// The battle drawn in three.js: the world (ground, buildings, weather, light), the units (built in
// code; soldiers drawn one by one), the effects and the sound, all driven by the engine's event log
// played back as a film (beats that touch different units share time; see film.ts). The film shows
// only what the player's side saw and decides nothing. The camera is a tactical orbit (pan, pinch,
// twist, tilt) with short action cams on brew-ups, the kill that closes a turn and captures. Units are drawn larger than
// life so they read on a phone, and a layer of DOM badges and words rides over the field.

/** Vehicles and aircraft are drawn this much larger than life, soldiers more; cells are unchanged. */
const VEHICLE_SCALE = 1.4;
const SOLDIER_SCALE = 2.2;
/** How far apart a squad's soldiers stand, for their larger figures. */
const SPREAD = 1.35;
/** Closest and default camera distances (world units). */
const MIN_DIST = 3.5;
const PLAY_DIST = 11.5;

/** What a penetrating hit did, in a word or two. */
const EFFECT_TEXT: Partial<Record<Effect, string>> = {
  catastrophic: 'Destroyed',
  knocked_out: 'Knocked Out',
  mobility: 'Immobilised',
  tracks: 'Tracks Hit',
  firepower: 'Gun Out',
  optics: 'Optics Out',
  crew: 'Crew Hit',
  forced_landing: 'Forced Down',
  shot_down: 'Shot Down',
};

export interface Overlay {
  selected: string | null;
  /** Cells the selected unit can move to. */
  reach: number[];
  /** Cells it can reach only by dashing. */
  dash: number[];
  /** The route to the cell under the pointer, the move being looked at, or the advised move. */
  path: Point[] | null;
  /** The cell a move is being looked at for (marked until it is made or cancelled). */
  dest: Point | null;
  /** Enemies the selected unit can fire at. */
  targets: string[];
  /** An area strike being aimed: its centre cell and radius. */
  area: { at: Point; r: number } | null;
  /** Last known enemy positions. */
  ghosts: { x: number; y: number; type: TypeId; age: number }[];
  /** Danger Area: shade every seen enemy's reach. */
  danger: boolean;
  /** Shade this one enemy's reach (a long-press on it), or null. */
  reachOf: string | null;
}

interface Step {
  dur: number;
  t: number;
  started: boolean;
  start?: () => void;
  tick?: (k: number, dt: number) => void;
  end?: () => void;
}

/** One beat of the film on screen: its steps, played in order. */
interface Clip {
  steps: Step[];
  /** Units it shows. */
  keys: string[];
  /** Plays alone: what is before it ends first, and nothing after it starts until it ends. */
  alone: boolean;
  /** It may bring the camera to itself (zip mode: only when it touches your units). */
  cam: boolean;
  /** Where it happens, read as it is about to start (is it on screen?). */
  where: () => { x: number; z: number } | null;
  /** Their turn in zip mode: dead time trimmed. */
  zip: boolean;
  /** It started while others were playing: it leaves the camera where it is unless it is off screen. */
  joined: boolean;
  /** Real seconds its current step has played (a step that will not end is cut). */
  age: number;
}

/** How the battle feels to watch: the battle menu's Motion, Shake, Action Cams and Fast Enemy Turns. */
export interface Feel {
  motion: Motion;
  /** Shake strength, 0..100. */
  shake: number;
  actionCams: boolean;
  /** Zip their turn: dead time capped, the camera only for what touches your units. */
  zip: boolean;
}

export function feelOf(s: ArenaSettings): Feel {
  return { motion: s.motion, shake: s.shake, actionCams: s.actionCams, zip: s.fastEnemy };
}

/** Beats on screen at once, how far ahead the film looks for one that can join them, and the film time between their starts. */
const AT_ONCE = 3;
const LOOK_AHEAD = 6;
const STAGGER = 0.12;
/** Zip mode: seconds of nothing to see in a row, at most. */
const DEAD_CAP = 0.6;
/** Camera trauma drained per second (a hit's shake dies away in about a second). */
const TRAUMA_DRAIN = 1;
/** Full trauma turns the view up to 6 degrees (a brew-up's 0.5 is 1.5) and sways it a little, by distance. */
const SHAKE_TURN = THREE.MathUtils.degToRad(6);
const SHAKE_SWAY = 0.012;
/** Smooth noise in -1..1 for the shake: three waves that never line up, not a new random number each frame. */
const wave = (t: number, seed: number) => (Math.sin(t * 37.7 + seed) + 0.6 * Math.sin(t * 61.3 + seed * 2.3) + 0.3 * Math.sin(t * 91.1 + seed * 4.1)) / 1.9;
const shares = (a: { keys: string[] }, b: { keys: string[] }) => a.keys.some((k) => b.keys.includes(k));

interface View {
  id: string;
  side: Side;
  type: TypeId;
  t: UnitType;
  holder: THREE.Group;
  models: [UnitModel | null, UnitModel | null];
  lod: 0 | 1;
  /** Soldiers in the crowd, by index into the unit's men. */
  men: string[];
  ring: THREE.Mesh;
  x: number;
  z: number;
  facing: number;
  aim: number;
  alive: boolean;
  /** Shown to the player (always for blue; red while seen). */
  shown: boolean;
  /** Inside a carrier. */
  aboard: boolean;
  wreck: boolean;
  speed: number;
  flash: number;
  fall: number;
  hunker: boolean;
  /** Strength shown on its badge, 0..1: it drops as the film shows the hits, then matches the battle. */
  hp: number;
  /** Last pose given to its soldiers, so idle frames do not churn. */
  pose: 'stand' | 'walk' | 'run' | 'kneel' | 'prone' | 'aim' | 'fire';
  /** Where it was last frame, to roll its wheels and tracks by the distance driven. */
  lastX: number;
  lastZ: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a: number, b: number, k: number) => a + wrap(b - a) * k;
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
/** Casualties in words: "2 Down, 1 Wounded". */
function downText(killed: number, wounded: number): string {
  return [killed ? `${killed} Down` : '', wounded ? `${wounded} Wounded` : ''].filter(Boolean).join(', ');
}
/** Grid heading to a three.js yaw for a model that faces +z. */
const yawOf = (facing: number) => Math.PI / 2 - facing;

/** Main rotor blades and rpm, for the blade slap. */
const ROTOR: Partial<Record<TypeId, [number, number]>> = { ah64e: [4, 289], ka52: [3, 257], mi35: [5, 240], ah6: [6, 475], uh60: [4, 258], mi8: [5, 192] };

const BLUE_RING = 0x7fb2e5;
const RED_RING = 0xe0705e;

/** Where each soldier of a unit stands in its cell: a loose wedge facing its heading. */
function slot(i: number, n: number, facing: number, spread: number): [number, number] {
  if (n <= 1) return [0, 0];
  const row = Math.floor((i + 1) / 2);
  const side = i === 0 ? 0 : i % 2 ? -1 : 1;
  const fwd = -row * 0.13 * spread;
  const lat = side * row * 0.12 * spread;
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return [fwd * c - lat * s, fwd * s + lat * c];
}

export interface StageOptions {
  quality: Quality;
  settings: ArenaSettings;
  lib: Library | null;
  arsenal: { blue: 'us' | 'europe' | 'russia' | 'legacy'; red: 'us' | 'europe' | 'russia' | 'legacy' };
  /** A line for the kill feed, as the film shows it. */
  onFeed?: (text: string, tone: Tone) => void;
}

export class BattleStage {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  private readonly world: World;
  private readonly fx: Effects;
  private readonly crowd: SoldierCrowd;
  readonly audio: BattleAudio;
  private readonly views = new Map<string, View>();
  /** The film: beats waiting their turn, and those playing (beats that touch different units share time). */
  private readonly waiting: Clip[] = [];
  private readonly playing: Clip[] = [];
  /** The beat `queue` is filling. */
  private building: Clip | null = null;
  /** Whose turn the events being queued belong to (zip mode trims theirs). */
  private turnSide: Side = 'blue';
  /** Zip mode: seconds of nothing to see queued since the last thing worth seeing. */
  private deadRun = 0;
  /** Film time the last beat started at. */
  private lastStart = -1;
  /** What the batch being queued says about itself: the kill that closes each turn, bounces that shook a crew. */
  private notes: { kills: Set<BattleEvent>; shook: ReturnType<typeof shakes> } = { kills: new Set(), shook: new Map() };
  /** For the probe: film seconds played while busy, seconds queued, and where each turn began. */
  private played = 0;
  private planned = 0;
  private readonly marks: { side: Side; planned: number; played: number }[] = [];
  private readonly tiles: THREE.InstancedMesh;
  private readonly dashTiles: THREE.InstancedMesh;
  private readonly areaTiles: THREE.InstancedMesh;
  private readonly targetRings: THREE.InstancedMesh;
  private readonly ghostMarks: THREE.InstancedMesh;
  private readonly selRing: THREE.Mesh;
  private readonly destMark: THREE.Mesh;
  private pathLine: THREE.Mesh | null = null;
  private readonly ray = new THREE.Raycaster();
  private overlay: Overlay = { selected: null, reach: [], dash: [], path: null, dest: null, targets: [], area: null, ghosts: [], danger: false, reachOf: null };
  /** Fractions of the screen the HUD covers at the top and bottom (eased toward `wantHud`). */
  private hud: [number, number] = [0.12, 0.26];
  private wantHud: [number, number] = [0.12, 0.26];
  // Orbit camera: a focus on the ground, a heading round it, a tilt and a distance.
  private readonly focus = new THREE.Vector3(W / 2, 0, H - 8);
  private readonly wantFocus = new THREE.Vector3(W / 2, 0, H - 8);
  private yaw = 0;
  private wantYaw = 0;
  private tilt = THREE.MathUtils.degToRad(42);
  private wantTilt = THREE.MathUtils.degToRad(42);
  private dist = PLAY_DIST;
  private wantDist = PLAY_DIST;
  /** The planning view to return to from the whole-field view. */
  private before: { x: number; z: number; dist: number; tilt: number; yaw: number } | null = null;
  /** Camera trauma, 0..1: the shake is its square. */
  private trauma = 0;
  private shakeClock = 0;
  /** The last jolt each unit gave: one moment's hits on one unit shake once, by the worst of them. */
  private readonly jolted = new Map<string, { t: number; add: number }>();
  /** Seconds of hit stop left: the film and the effects hold still on a heavy hit. */
  private stop = 0;
  /** Casualties said over each unit a moment ago, so more add to the same word. */
  private readonly downs = new Map<string, { killed: number; wounded: number; at: number }>();
  private feel: Feel;
  /** Reduced or no motion: the camera cuts to where it is going instead of gliding. */
  private cuts = false;
  /** The film's speed on screen (2 for fast enemy turns, 4 while Skip is held): words read in real time. */
  rate = 1;
  /** Film steps that threw (each is skipped; the film never stops on one). */
  private faults = 0;
  /** Seconds of slow motion left (a vehicle brewing up). */
  private slow = 0;
  private clock = 0;
  private thermal = false;
  /** An action cam in progress: where to look from and at, and for how long. */
  private cam: { from: THREE.Vector3; at: THREE.Vector3; t: number; dur: number } | null = null;
  private readonly preset;
  /** Frame timing (ms of our own work per frame), for the performance probe. */
  private readonly frameMs: number[] = [];
  private readonly saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private readonly hudLayer: FieldHud;
  /** Edges of the move and dash areas, rebuilt when the areas change. */
  private reachEdge: THREE.Mesh | null = null;
  private dashEdge: THREE.Mesh | null = null;
  private edgeKey = '';
  /** Where the defenders were expected, shown until the first contact. */
  private readonly enemyMark: THREE.Group | null;
  private readonly enemyAt: { x: number; z: number; r: number } | null;
  private contact = false;
  /** Who last fired at each unit, for the kill feed. */
  private readonly lastShooter = new Map<string, string>();

  constructor(
    private readonly host: HTMLElement,
    private readonly battle: Battle,
    private readonly opts: StageOptions,
  ) {
    this.preset = QUALITY[opts.quality];
    this.feel = feelOf(opts.settings);
    this.renderer = new THREE.WebGLRenderer({ antialias: this.preset.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
    this.renderer.shadowMap.enabled = this.preset.shadowMap > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('data-testid', 'arena-canvas');
    this.renderer.domElement.style.touchAction = 'none';
    // setSize(..., false) leaves CSS alone: pin it to the host or a 2x screen shows a quarter of the field.
    Object.assign(this.renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
    host.appendChild(this.renderer.domElement);

    const lib = opts.lib;
    this.world = buildWorld(this.renderer, this.scene, battle.map, battle.conditions, opts.quality, battle.seed, lib ? { hesco: lib.hesco } : undefined);
    const sun = this.world.lights.sun;
    if (this.preset.shadowMap > 0) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.preset.shadowMap, this.preset.shadowMap);
    }
    const night = battle.conditions.time === 'night';
    this.fx = new Effects(this.scene, opts.quality, { biome: battle.conditions.biome, night, heightAt: (x, z) => this.world.heightAt(x, z) });
    this.fx.setArsenals?.(opts.arsenal.blue, opts.arsenal.red);
    this.crowd = new SoldierCrowd({ max: 420, shadows: this.preset.soldierShadows, scale: SOLDIER_SCALE });
    this.scene.add(this.crowd.group);
    this.audio = new BattleAudio({ radio: opts.settings.radio });
    this.audio.setNight(night);
    this.audio.ambience(battle.conditions.biome, battle.conditions.weather);

    const tileGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const tile = (color: number, opacity: number, n: number) => {
      const m = new THREE.InstancedMesh(tileGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), n);
      m.count = 0;
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    this.tiles = tile(BLUE_RING, 0.26, W * H);
    this.dashTiles = tile(BLUE_RING, 0.1, W * H);
    this.areaTiles = tile(RED_RING, 0.55, 49);
    const ringGeo = new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2);
    this.targetRings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: RED_RING, transparent: true, opacity: 0.95, depthWrite: false }), 40);
    this.targetRings.count = 0;
    this.targetRings.renderOrder = 3;
    this.targetRings.frustumCulled = false;
    this.scene.add(this.targetRings);
    const ghostGeo = new THREE.RingGeometry(0.28, 0.34, 4, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4);
    this.ghostMarks = new THREE.InstancedMesh(ghostGeo, new THREE.MeshBasicMaterial({ color: RED_RING, transparent: true, opacity: 0.6, depthWrite: false }), 64);
    this.ghostMarks.count = 0;
    this.ghostMarks.renderOrder = 3;
    this.ghostMarks.frustumCulled = false;
    this.scene.add(this.ghostMarks);
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.56, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
    this.selRing.visible = false;
    this.selRing.renderOrder = 4;
    this.scene.add(this.selRing);
    this.destMark = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.destMark.visible = false;
    this.destMark.renderOrder = 4;
    this.scene.add(this.destMark);

    // Where the defenders were seen to deploy (the war map says they hold the ground), until contact.
    const spawn = battle.map.redSpawn;
    if (spawn.length) {
      const ax = spawn.reduce((s, p) => s + p.x + 0.5, 0) / spawn.length;
      const az = spawn.reduce((s, p) => s + p.y + 0.5, 0) / spawn.length;
      const r = Math.max(3, Math.min(9, Math.max(...spawn.map((p) => Math.hypot(p.x + 0.5 - ax, p.y + 0.5 - az))) * 0.8));
      this.enemyAt = { x: ax, z: az, r };
      this.enemyMark = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: RED_RING, transparent: true, opacity: 0.75, depthWrite: false, depthTest: false }));
      const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: RED_RING, transparent: true, opacity: 0.1, depthWrite: false, depthTest: false }));
      ring.renderOrder = fill.renderOrder = 2;
      this.enemyMark.add(fill, ring);
      this.enemyMark.position.set(ax, this.ground(ax, az) + 0.3, az);
      this.scene.add(this.enemyMark);
    } else {
      this.enemyAt = null;
      this.enemyMark = null;
    }
    this.contact = Object.values(battle.intel.blue).some((g) => g.now) || battle.events.some((e) => e.type === 'spotted' && e.side === 'blue');
    if (this.contact && this.enemyMark) this.enemyMark.visible = false;
    this.hudLayer = new FieldHud(host, (id) => {
      const v = this.views.get(id);
      const at = v ? { x: v.x, z: v.z } : id === 'enemy' && this.enemyAt ? this.enemyAt : null;
      if (!at) return;
      this.wantFocus.set(at.x, 0, at.z);
      this.before = null;
    });

    const seen = new Set(Object.keys(battle.intel.blue).filter((id) => battle.intel.blue[id]!.now));
    for (const u of battle.units) this.addUnit(u, u.side === 'blue' || seen.has(u.id));
    // Open close over the attackers' line, looking up the field toward the enemy.
    const blue = battle.units.filter((u) => u.side === 'blue' && u.alive);
    const cx = blue.reduce((s, u) => s + u.x + 0.5, 0) / Math.max(1, blue.length);
    const cz = blue.reduce((s, u) => s + u.y + 0.5, 0) / Math.max(1, blue.length);
    this.wantFocus.set(cx, 0, cz - 2);
    this.focus.copy(this.wantFocus);
    this.setFeel(this.feel);
    this.resize();
  }

  // --- Units -------------------------------------------------------------------------------------

  private paint(side: Side) {
    const arsenal = this.opts.arsenal[side];
    return paintFor(arsenal === 'us' || arsenal === 'europe' ? 'west' : 'east', arsenal, this.battle.conditions.biome);
  }

  private addUnit(u: Unit, shown: boolean): void {
    const t = typeOf(u.type);
    const holder = new THREE.Group();
    this.scene.add(holder);
    const big = t.mobility !== 'foot';
    const ring = new THREE.Mesh(new THREE.RingGeometry(big ? 0.6 : 0.42, big ? 0.66 : 0.48, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: u.side === 'blue' ? BLUE_RING : RED_RING, transparent: true, opacity: 0.55, depthWrite: false }));
    ring.position.y = 0.03;
    ring.renderOrder = 1;
    holder.add(ring);
    const v: View = { id: u.id, side: u.side, type: u.type, t, holder, models: [null, null], lod: 0, men: [], ring, x: u.x + 0.5, z: u.y + 0.5, facing: u.facing, aim: u.aim, alive: u.alive, shown, aboard: !!u.carrier, wreck: false, speed: 0, flash: 0, fall: 0, hunker: u.hunker, hp: health(u), pose: 'kneel', lastX: u.x + 0.5, lastZ: u.y + 0.5 };
    if (t.mobility === 'foot') {
      const faction = t.faction;
      u.men.forEach((m, i) => {
        if (m.state === 'dead') return;
        const id = `${u.id}#${i}`;
        const [ox, oz] = slot(i, u.men.length, u.facing, SPREAD);
        this.crowd.add(id, faction, kitFor(u.type, m.role), v.x + ox, v.z + oz, yawOf(u.facing));
        v.men.push(id);
      });
    } else {
      const lod: 0 | 1 = this.preset.detailCells > 0 ? 0 : 1;
      v.lod = lod;
      v.models[lod] = this.makeModel(u.type, u.side, lod);
      holder.add(v.models[lod]!.root);
    }
    this.views.set(u.id, v);
    this.place(v);
    this.setShown(v, shown && !v.aboard);
  }

  private makeModel(type: TypeId, side: Side, lod: 0 | 1): UnitModel {
    const m = buildModel(type, { paint: this.paint(side), lod, ...(this.opts.lib && type === 'ah64e' ? { apache: this.opts.lib.heli } : {}) });
    m.root.scale.multiplyScalar(VEHICLE_SCALE);
    return m;
  }

  private model(v: View): UnitModel | null {
    return v.models[v.lod];
  }

  /** Swap a vehicle between its full and simple model by distance from the camera focus. */
  private setLod(v: View, lod: 0 | 1): void {
    if (v.lod === lod || v.t.mobility === 'foot' || v.wreck) return;
    const old = this.model(v);
    if (!v.models[lod]) v.models[lod] = this.makeModel(v.type, v.side, lod);
    if (old) v.holder.remove(old.root);
    v.lod = lod;
    v.holder.add(v.models[lod]!.root);
    if (this.thermal) this.thermalUnit(v, true);
  }

  private setShown(v: View, on: boolean): void {
    const show = on && !v.aboard;
    v.holder.visible = show;
    for (const id of v.men) this.crowd.set(id, { y: show ? undefined : -50 });
  }

  private ground(x: number, z: number): number {
    return this.world.heightAt(x, z);
  }

  /** Put a unit's holder (and its soldiers) where its view says. */
  private place(v: View): void {
    const lift = this.model(v)?.lift ?? 0;
    v.holder.position.set(v.x, this.ground(v.x, v.z) + (v.fall > 0 ? Math.max(0, lift * (1 - v.fall)) : lift), v.z);
    v.holder.rotation.y = yawOf(v.facing);
    const m = this.model(v);
    if (m) m.turret.rotation.y = wrap(v.aim - v.facing) * -1;
    if (v.t.mobility === 'foot' && v.shown && !v.aboard) {
      const n = v.men.length;
      v.men.forEach((id, i) => {
        const [ox, oz] = slot(i, n, v.facing, SPREAD);
        const x = v.x + ox;
        const z = v.z + oz;
        this.crowd.set(id, { x, z, y: this.ground(x, z), facing: yawOf(v.facing) });
      });
    }
  }

  private posePeople(v: View, pose: View['pose'], speed = 0): void {
    if (v.pose === pose && !speed) return;
    v.pose = pose;
    for (const id of v.men) this.crowd.set(id, { pose, speed });
  }

  // --- Camera ------------------------------------------------------------------------------------

  /** The HUD covers the top and bottom of the screen; keep the battlefield framed between them. */
  setHud(top: number, bottom: number, now = false): void {
    const clamp = (v: number) => Math.max(0, Math.min(0.6, Number.isFinite(v) ? v : 0));
    this.wantHud = [clamp(top), clamp(bottom)];
    if (now) this.hud = [...this.wantHud];
  }

  resize(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyCamera(0);
  }

  /** Far enough to see the whole field between the HUD bars, at the whole-field view's tilt. */
  private get maxDist(): number {
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const band = Math.max(0.3, 1 - this.hud[0] - this.hud[1]);
    const byW = (W / 2 + 1) / Math.tan(hHalf);
    const byH = ((H / 2 + 1) * Math.sin(THREE.MathUtils.degToRad(64))) / Math.tan(vHalf * band);
    return Math.min(160, Math.max(byW, byH));
  }

  private placeCamera(): void {
    // The focus (the unit you are working with) sits in the middle of the band of field between the
    // HUD bars: the point the camera looks at moves toward the camera so the focus rises above the
    // screen's middle when the bottom bar is the taller, and the other way round. Exact for flat
    // ground: the focus is seen `delta` above the view axis, which puts it at that band's middle.
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const delta = Math.atan((this.hud[1] - this.hud[0]) * half);
    const h = Math.sin(this.tilt) * this.dist;
    const r = Math.cos(this.tilt) * this.dist;
    const s = h / Math.tan(Math.max(0.05, this.tilt - delta)) - r;
    const fx = this.focus.x + Math.sin(this.yaw) * s;
    const fz = this.focus.z + Math.cos(this.yaw) * s;
    const gy = this.ground(this.focus.x, this.focus.z);
    this.camera.position.set(fx + Math.sin(this.yaw) * r, gy + h, fz + Math.cos(this.yaw) * r);
    this.camera.lookAt(fx, gy, fz);
    this.shakeCamera();
    this.camera.updateMatrixWorld(true);
  }

  private applyCamera(dt: number): void {
    // Reduced motion: the camera cuts to where it is going.
    const k = dt <= 0 || this.cuts ? 1 : 1 - Math.exp(-dt * 6);
    this.wantFocus.x = Math.max(0, Math.min(W, this.wantFocus.x));
    this.wantFocus.z = Math.max(0, Math.min(H, this.wantFocus.z));
    this.focus.lerp(this.wantFocus, k);
    this.yaw = lerpAngle(this.yaw, this.wantYaw, k);
    this.tilt += (this.wantTilt - this.tilt) * k;
    this.dist += (this.wantDist - this.dist) * k;
    this.hud[0] += (this.wantHud[0] - this.hud[0]) * k;
    this.hud[1] += (this.wantHud[1] - this.hud[1]) * k;
    if (this.cam) {
      // An action cam: low and close, then back to the planning view.
      const c = this.cam;
      const p = Math.min(1, c.t / c.dur);
      const blend = p < 0.15 ? p / 0.15 : p > 0.85 ? (1 - p) / 0.15 : 1;
      this.placeCamera();
      const plan = this.camera.position.clone();
      const look = new THREE.Vector3();
      this.camera.getWorldDirection(look);
      const planAt = plan.clone().add(look.multiplyScalar(this.dist));
      this.camera.position.lerpVectors(plan, c.from, ease(blend));
      this.camera.lookAt(planAt.lerp(c.at, ease(blend)));
      this.shakeCamera();
      this.camera.updateMatrixWorld(true);
      return;
    }
    this.placeCamera();
  }

  /** Drag the board by a screen distance (pixels). */
  panBy(dx: number, dy: number): void {
    const h = this.host.clientHeight || 1;
    const perPx = (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const mx = -dx * perPx;
    const mz = (-dy * perPx) / Math.max(0.4, Math.sin(this.tilt));
    this.wantFocus.x += mx * c + mz * s;
    this.wantFocus.z += -mx * s + mz * c;
    this.focus.copy(this.wantFocus);
    this.before = null;
  }

  /**
   * Zoom in (factor below 1) or out. With a screen point the ground under it stays put (pinch and
   * wheel, which also apply at once); without one it eases about the centre (the buttons).
   */
  zoomBy(factor: number, at?: { x: number; y: number }): void {
    const next = Math.max(MIN_DIST, Math.min(this.maxDist, this.wantDist * factor));
    if (at) {
      const p = this.groundPoint(at.x, at.y);
      if (p) {
        const k = 1 - next / this.wantDist;
        this.wantFocus.x += (p.x - this.wantFocus.x) * k;
        this.wantFocus.z += (p.z - this.wantFocus.z) * k;
      }
      this.wantDist = next;
      this.dist = next;
      this.focus.copy(this.wantFocus);
    } else this.wantDist = next;
    this.before = null;
  }

  /** The camera has arrived where it was going (nothing on screen will shift under a tap). */
  get settled(): boolean {
    return (
      !this.cam &&
      this.focus.distanceTo(this.wantFocus) < 0.02 &&
      Math.abs(this.dist - this.wantDist) < 0.02 &&
      Math.abs(this.tilt - this.wantTilt) < 0.002 &&
      Math.abs(wrap(this.yaw - this.wantYaw)) < 0.002 &&
      Math.abs(this.hud[0] - this.wantHud[0]) < 0.002 &&
      Math.abs(this.hud[1] - this.wantHud[1]) < 0.002
    );
  }

  /** How far in the camera is, 0 (closest) to 1 (whole field). */
  get zoom(): number {
    return (this.wantDist - MIN_DIST) / Math.max(1, this.maxDist - MIN_DIST);
  }

  /** Orbit round the focus (radians) and tilt (radians, positive looks more straight down). */
  orbitBy(yaw: number, tilt = 0): void {
    this.wantYaw = wrap(this.wantYaw + yaw);
    this.wantTilt = Math.max(THREE.MathUtils.degToRad(28), Math.min(THREE.MathUtils.degToRad(82), this.wantTilt + tilt));
  }

  /**
   * Turn the view with two fingers: the map turns the way the fingers turn (as in Apple Maps), and at
   * once, so it stays under them. `radians` is the fingers' turn on screen, clockwise positive.
   */
  twistBy(radians: number): void {
    this.wantYaw = wrap(this.wantYaw + radians);
    this.yaw = this.wantYaw;
    this.before = null;
  }

  /** The whole field from above, or (on) back to where the player was; returns whether it is on. */
  toggleOverview(): boolean {
    if (this.before) {
      const b = this.before;
      this.before = null;
      this.wantFocus.set(b.x, 0, b.z);
      this.wantDist = b.dist;
      this.wantTilt = b.tilt;
      this.wantYaw = b.yaw;
      return false;
    }
    const was = { x: this.wantFocus.x, z: this.wantFocus.z, dist: this.wantDist, tilt: this.wantTilt, yaw: this.wantYaw };
    this.wantFocus.set(W / 2, 0, H / 2);
    this.wantDist = this.maxDist;
    this.wantTilt = THREE.MathUtils.degToRad(64);
    this.wantYaw = 0;
    this.before = was;
    return true;
  }

  get overview(): boolean {
    return this.before !== null;
  }

  /** Centre on a cell at the playing distance (the unit you are working with). */
  recenter(cell: Point): void {
    this.wantFocus.set(cell.x + 0.5, 0, cell.y + 0.5);
    if (this.wantDist > PLAY_DIST * 1.5 || this.wantDist < MIN_DIST * 1.5) this.wantDist = PLAY_DIST;
    if (this.before) {
      this.wantTilt = this.before.tilt;
      this.before = null;
    }
  }

  /** Bring a point into view if it is near the edge or off screen; `centre` always centres it. */
  follow(x: number, z: number, centre = false): void {
    const p = new THREE.Vector3(x, this.ground(x, z), z).project(this.camera);
    const top = 1 - this.hud[0] * 2;
    const bottom = -1 + this.hud[1] * 2;
    const margin = 0.25;
    if (centre || Math.abs(p.x) > 1 - margin || p.y > top - margin || p.y < bottom + margin || p.z > 1) this.wantFocus.set(x, 0, z);
  }

  focusOn(cell: Point): void {
    this.follow(cell.x + 0.5, cell.y + 0.5);
  }

  /** Where a screen point meets the ground (world units), or null off the field. */
  groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    // March along the ray to the heightfield.
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    let prev = 0;
    const far = Math.max(400, this.dist * 4);
    for (let s = 0; s < far; s += 0.25) {
      const y = o.y + d.y * s;
      if (y <= this.ground(o.x + d.x * s, o.z + d.z * s)) {
        // Refine between the last two samples.
        let lo = prev;
        let hi = s;
        for (let i = 0; i < 8; i++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m <= this.ground(o.x + d.x * m, o.z + d.z * m)) hi = m;
          else lo = m;
        }
        return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
      }
      prev = s;
    }
    return null;
  }

  /** The cell under a screen point, or null off the field. */
  pick(clientX: number, clientY: number): Point | null {
    const p = this.groundPoint(clientX, clientY);
    if (!p) return null;
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.z);
    return cx >= 0 && cy >= 0 && cx < W && cy < H ? { x: cx, y: cy } : null;
  }

  /** The unit drawn nearest a screen point, within `radius` pixels (badges and models sit above their cells). */
  unitNear(clientX: number, clientY: number, radius: number, side?: Side): string | null {
    let best: string | null = null;
    let bestD = radius;
    for (const v of this.views.values()) {
      if (!v.alive || !v.holder.visible || v.aboard || (side && v.side !== side)) continue;
      for (const h of [0.15, this.headOf(v), this.headOf(v) + 0.35]) {
        const p = this.toScreen(v.x - 0.5, v.z - 0.5, h);
        const d = Math.hypot(p.x - clientX, p.y - clientY);
        if (d < bestD) {
          bestD = d;
          best = v.id;
        }
      }
    }
    return best;
  }

  /** A cell's centre on screen, `h` world units above the ground. */
  toScreen(x: number, y: number, h = 0): Point {
    const p = new THREE.Vector3(x + 0.5, this.ground(x + 0.5, y + 0.5) + h, y + 0.5).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  /** Height of the top of a unit above the ground, where its badge sits. */
  private headOf(v: View): number {
    return v.t.mobility === 'foot' ? 0.5 : (this.model(v)?.lift ?? 0) + 0.45;
  }

  unitScreen(id: string): Point | null {
    const v = this.views.get(id);
    if (!v || !v.holder.visible) return null;
    return this.toScreen(v.x - 0.5, v.z - 0.5, this.headOf(v));
  }

  /** A world point on the HUD layer (CSS pixels from the canvas corner), or null behind the camera. */
  private onLayer(x: number, y: number, z: number): { x: number; y: number } | null {
    const p = new THREE.Vector3(x, y, z).project(this.camera);
    if (p.z > 1 || p.z < -1) return null;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
  }

  // --- Overlay -------------------------------------------------------------------------------------

  /**
   * The film's queue, for tests: steps waiting or playing, beats playing, whether an action cam runs,
   * the clock; for measuring, film seconds played while busy, seconds queued, and where turns began.
   */
  filmState(): { steps: number; beats: number; cam: boolean; clock: number; settled: boolean; faults: number; camera: number[]; played: number; planned: number; marks: { side: Side; planned: number; played: number }[] } {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return {
      steps: [...this.playing, ...this.waiting].reduce((n, c) => n + c.steps.length, 0),
      beats: this.playing.length,
      played: r(this.played),
      planned: r(this.planned),
      marks: this.marks.map((m) => ({ ...m, played: r(m.played), planned: r(m.planned) })),
      cam: this.cam !== null,
      clock: this.clock,
      settled: this.settled,
      faults: this.faults,
      camera: [this.focus.x, this.focus.y, this.focus.z, this.wantFocus.x, this.wantFocus.y, this.wantFocus.z, this.dist, this.wantDist, this.tilt, this.wantTilt, this.yaw, this.wantYaw].map(r),
    };
  }

  /** What the overlay shows, for tests. */
  overlayCounts(): { selected: string | null; reach: number; dash: number; targets: number } {
    return { selected: this.overlay.selected, reach: this.overlay.reach.length, dash: this.overlay.dash.length, targets: this.overlay.targets.length };
  }

  setOverlay(o: Overlay): void {
    this.overlay = o;
    const m = new THREE.Matrix4();
    const put = (mesh: THREE.InstancedMesh, cells: number[]) => {
      let n = 0;
      for (const i of cells) {
        if (n >= mesh.instanceMatrix.count) break;
        const x = (i % W) + 0.5;
        const z = Math.floor(i / W) + 0.5;
        m.makeTranslation(x, this.ground(x, z) + 0.04, z);
        mesh.setMatrixAt(n++, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    };
    put(this.tiles, o.reach);
    put(this.dashTiles, o.dash);
    this.setEdges(o);
    if (o.area) {
      const cells: number[] = [];
      for (let dy = -o.area.r; dy <= o.area.r; dy++)
        for (let dx = -o.area.r; dx <= o.area.r; dx++) {
          const x = o.area.at.x + dx;
          const y = o.area.at.y + dy;
          if (x >= 0 && y >= 0 && x < W && y < H) cells.push(y * W + x);
        }
      put(this.areaTiles, cells);
    } else this.areaTiles.count = 0;
    let n = 0;
    for (const id of o.targets) {
      const v = this.views.get(id);
      if (!v || !v.holder.visible || n >= 40) continue;
      m.makeTranslation(v.x, this.ground(v.x, v.z) + (this.model(v)?.lift ?? 0) + 0.05, v.z);
      this.targetRings.setMatrixAt(n++, m);
    }
    this.targetRings.count = n;
    this.targetRings.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const g of o.ghosts) {
      if (n >= 64) break;
      const x = g.x + 0.5;
      const z = g.y + 0.5;
      m.makeTranslation(x, this.ground(x, z) + 0.05, z);
      this.ghostMarks.setMatrixAt(n++, m);
    }
    this.ghostMarks.count = n;
    this.ghostMarks.instanceMatrix.needsUpdate = true;
    if (this.pathLine) {
      this.scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
      this.pathLine = null;
    }
    if (o.path && o.path.length > 1) {
      const pts = o.path.map((p) => new THREE.Vector3(p.x + 0.5, this.ground(p.x + 0.5, p.y + 0.5) + 0.08, p.y + 0.5));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      this.pathLine = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 6, 0.035, 5, false), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
      this.pathLine.renderOrder = 5;
      this.scene.add(this.pathLine);
    }
    this.destMark.visible = !!o.dest;
    if (o.dest) this.destMark.position.set(o.dest.x + 0.5, this.ground(o.dest.x + 0.5, o.dest.y + 0.5) + 0.07, o.dest.y + 0.5);
    const sel = o.selected ? this.views.get(o.selected) : undefined;
    this.selRing.visible = !!sel && sel.holder.visible;
    if (sel) {
      this.selRing.position.set(sel.x, this.ground(sel.x, sel.z) + 0.06, sel.z);
      this.selRing.scale.setScalar(sel.t.mobility === 'foot' ? 1 : 1.3);
    }
  }

  /** A solid edge round the move area and a fainter one round the dash area. */
  private setEdges(o: Overlay): void {
    const key = `${o.selected}|${o.reach.length}:${o.reach[0] ?? -1}:${o.reach.at(-1) ?? -1}|${o.dash.length}:${o.dash[0] ?? -1}`;
    if (key === this.edgeKey) return;
    this.edgeKey = key;
    for (const m of [this.reachEdge, this.dashEdge]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.reachEdge = null;
    this.dashEdge = null;
    if (!o.selected || (!o.reach.length && !o.dash.length)) return;
    const sel = this.views.get(o.selected);
    const home = sel ? Math.floor(sel.z) * W + Math.floor(sel.x) : -1;
    // Our own units stand inside the area: do not cut holes round them.
    const area = new Set([...o.reach, home]);
    for (const v of this.views.values()) if (v.side === 'blue' && v.alive && !v.aboard) area.add(Math.floor(v.z) * W + Math.floor(v.x));
    this.reachEdge = this.edgeMesh(area, 0.06, 0.8);
    if (o.dash.length) this.dashEdge = this.edgeMesh(new Set([...area, ...o.dash]), 0.045, 0.4);
  }

  /** Flat ribbons along the outside edges of a set of cells, following the ground. */
  private edgeMesh(cells: Set<number>, width: number, opacity: number): THREE.Mesh {
    const pos: number[] = [];
    const quad = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
      // Inset by half the width so the ribbon sits just inside the edge.
      const steps = 4;
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const x0 = ax + (bx - ax) * t0;
        const z0 = az + (bz - az) * t0;
        const x1 = ax + (bx - ax) * t1;
        const z1 = az + (bz - az) * t1;
        const y0 = this.ground(x0, z0) + 0.06;
        const y1 = this.ground(x1, z1) + 0.06;
        const ix0 = x0 - nx * width;
        const iz0 = z0 - nz * width;
        const ix1 = x1 - nx * width;
        const iz1 = z1 - nz * width;
        pos.push(x0, y0, z0, x1, y1, z1, ix1, y1, iz1, x0, y0, z0, ix1, y1, iz1, ix0, y0, iz0);
      }
    };
    for (const i of cells) {
      if (i < 0) continue;
      const x = i % W;
      const y = Math.floor(i / W);
      const has = (dx: number, dy: number) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < W && ny < H && cells.has(ny * W + nx);
      };
      if (!has(0, -1)) quad(x, y, x + 1, y, 0, -1);
      if (!has(0, 1)) quad(x, y + 1, x + 1, y + 1, 0, 1);
      if (!has(-1, 0)) quad(x, y, x, y + 1, -1, 0);
      if (!has(1, 0)) quad(x + 1, y, x + 1, y + 1, 1, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = 3;
    m.frustumCulled = false;
    this.scene.add(m);
    return m;
  }

  // --- Badges, words and places --------------------------------------------------------------------

  /** Badges follow the film; when it is still, they read the battle as it stands. */
  private updateHud(dt: number): void {
    const still = !this.busy;
    // An action cam is a shot, not a map: no badges, arrows or labels in it.
    const cinematic = this.cam !== null;
    const states: BadgeState[] = [];
    const compact = this.zoom > 0.55;
    for (const v of this.views.values()) {
      const u = still ? this.battle.units.find((x) => x.id === v.id) : undefined;
      if (u) v.hp = health(u);
      const shown = v.alive && v.holder.visible && !v.aboard && (v.t.mobility !== 'foot' || v.men.length > 0);
      const at = shown && !cinematic ? this.badgePoint(v) : null;
      const unit = u ?? this.battle.units.find((x) => x.id === v.id);
      states.push({
        id: v.id,
        side: v.side,
        cls: classOf(v.t.role),
        at,
        hp: v.hp,
        status: unit && still ? badgeStatus(unit) : 'none',
        done: v.side === 'blue' && !!unit && (unit.acted || !!unit.carrier) && this.battle.turn === 'blue',
        selected: this.overlay.selected === v.id,
      });
    }
    this.hudLayer.setBadges(states, compact);
    this.hudLayer.setPointers(cinematic ? [] : this.edgePointers());
    this.hudLayer.update(dt);
    // The objective and, until the first contact, where the enemy is expected.
    const zone = this.battle.map.zone;
    this.hudLayer.label('objective', zone && !cinematic ? 'Objective' : null, zone ? this.onLayer(zone.x + 0.5, this.ground(zone.x + 0.5, zone.y + 0.5) + 0.2, zone.y + 0.5) : null);
    const ea = this.enemyAt;
    this.hudLayer.label('enemy', ea && !this.contact && !cinematic ? 'Enemy Expected' : null, ea && !this.contact ? this.onLayer(ea.x, this.ground(ea.x, ea.z) + 0.2, ea.z) : null);
  }

  /**
   * Seen enemies off the screen, nearest first (and, before the first contact, where they are
   * expected), as arrows clamped inside the band between the HUD bars.
   */
  private edgePointers(): EdgePointer[] {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const top = this.hud[0] * h + 34;
    const bottom = (1 - this.hud[1]) * h - 34;
    const left = 30;
    const right = w - 30;
    const cx = w / 2;
    const cy = (top + bottom) / 2;
    const out: (EdgePointer & { d: number })[] = [];
    const consider = (id: string, label: string, x: number, y: number, z: number) => {
      const p = new THREE.Vector3(x, y, z).project(this.camera);
      let sx = ((p.x + 1) / 2) * w;
      let sy = ((1 - p.y) / 2) * h;
      if (p.z > 1) {
        // Behind the camera: the projection flips.
        sx = w - sx;
        sy = h - sy;
      } else if (sx >= left && sx <= right && sy >= top && sy <= bottom) return;
      const dx = sx - cx;
      const dy = sy - cy;
      const k = Math.min(Math.abs((dx > 0 ? right - cx : left - cx) / (dx || 1e-6)), Math.abs((dy > 0 ? bottom - cy : top - cy) / (dy || 1e-6)));
      let px = cx + dx * k;
      let py = cy + dy * k;
      // Keep clear of the camera buttons down the right edge.
      if (px > w - 70 && py < this.hud[0] * h + 260) px = w - 76;
      px = Math.max(left, Math.min(right, px));
      py = Math.max(top, Math.min(bottom, py));
      out.push({ id, label, x: px, y: py, angle: Math.atan2(dy, dx), d: Math.hypot(x - this.focus.x, z - this.focus.z) });
    };
    for (const v of this.views.values()) {
      if (v.side !== 'red' || !v.alive || !v.holder.visible || v.aboard) continue;
      consider(v.id, `Show the ${typeOf(v.type).short}`, v.x, this.ground(v.x, v.z) + 0.3, v.z);
    }
    if (!this.contact && this.enemyAt) consider('enemy', 'Show where the enemy is expected', this.enemyAt.x, this.ground(this.enemyAt.x, this.enemyAt.z), this.enemyAt.z);
    // Arrows that would sit on each other become one, with a count.
    const kept: (EdgePointer & { d: number })[] = [];
    for (const p of out.sort((a, b) => a.d - b.d)) {
      const near = kept.find((k) => Math.hypot(k.x - p.x, k.y - p.y) < 48);
      if (near) near.count = (near.count ?? 1) + 1;
      else kept.push(p);
    }
    return kept.slice(0, 6);
  }

  /** Just above the top of a unit as drawn (its box projected to the screen), where its badge sits. */
  private badgePoint(v: View): { x: number; y: number } | null {
    const r = v.t.mobility === 'foot' ? 0.35 : 0.7;
    const g = this.ground(v.x, v.z);
    const top = g + this.headOf(v);
    const c = this.onLayer(v.x, top, v.z);
    if (!c) return null;
    let minY = c.y;
    for (const [dx, dz] of [
      [r, r],
      [r, -r],
      [-r, r],
      [-r, -r],
    ] as const) {
      const p = this.onLayer(v.x + dx, top, v.z + dz);
      if (p) minY = Math.min(minY, p.y);
    }
    return { x: c.x, y: minY - 4 };
  }

  /** Words over a unit, as the film reaches the moment; `group` words over one unit replace each other. */
  private say(v: View | undefined, text: string, tone: Tone, weight: Weight = 'major', group = ''): void {
    if (!v) return;
    this.hudLayer.callout(text, tone, () => (v.holder.visible || !v.alive ? this.badgePoint(v) : null), v.id, weight, group);
  }

  /** Good news when it happens to them, bad when it happens to us. */
  private toneFor(v: View): Tone {
    return v.side === 'red' ? 'good' : 'bad';
  }

  // --- Night and thermal -------------------------------------------------------------------------

  get night(): boolean {
    return this.battle.conditions.time === 'night';
  }

  setThermal(on: boolean): void {
    if (this.thermal === on) return;
    this.thermal = on;
    this.world.setThermal(on);
    this.fx.setThermal(on);
    for (const v of this.views.values()) this.thermalUnit(v, on);
  }

  private thermalUnit(v: View, on: boolean): void {
    const m = this.model(v);
    if (!m) return;
    const hot = new Map<THREE.Object3D, number>();
    for (const h of m.heat) {
      hot.set(h.obj, h.level);
      // The engine deck, exhaust and barrel proxies only show in the thermal view.
      h.obj.visible = on && !v.wreck;
    }
    m.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (on) {
        if (!this.saved.has(mesh)) this.saved.set(mesh, mesh.material);
        let level = v.wreck ? 0.8 : 0.45;
        for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (hot.has(p)) level = Math.max(level, hot.get(p)!);
        mesh.material = thermalMaterialFor(level);
      } else if (this.saved.has(mesh)) {
        mesh.material = this.saved.get(mesh)!;
        this.saved.delete(mesh);
      }
    });
  }

  // --- The film ----------------------------------------------------------------------------------

  get busy(): boolean {
    return this.waiting.length > 0 || this.playing.length > 0 || this.cam !== null;
  }

  /** The film or its feel still moves on screen (a beat, an action cam, a shake, a hit stop, slow motion). */
  get live(): boolean {
    return this.busy || this.trauma > 0 || this.stop > 0 || this.slow > 0;
  }

  /** How the battle feels to watch (the battle menu); it applies at once, mid-film too. */
  setFeel(feel: Feel): void {
    this.feel = { ...feel, shake: Math.max(0, Math.min(100, Number.isFinite(feel.shake) ? feel.shake : 100)) };
    const full = feel.motion === 'full';
    this.cuts = !full;
    this.hudLayer.still = !full;
    if (!full) {
      this.slow = 0;
      this.cam = null;
    }
    if (feel.motion === 'off') this.trauma = 0;
  }

  /** End an action cam now (a tap anywhere); true when one was playing. */
  endActionCam(): boolean {
    if (!this.cam) return false;
    this.cam = null;
    return true;
  }

  play(events: readonly BattleEvent[]): void {
    this.notes = { kills: lastKills(events), shook: shakes(events) };
    for (const beat of beatsOf(events)) {
      const clip = this.clipOf(beat);
      this.building = clip;
      try {
        if (beat.volley) this.queueVolley(beat.volley);
        else for (const e of beat.events) this.queue(e);
      } catch (err) {
        this.fault(err);
      }
      this.building = null;
      if (clip.steps.length) this.waiting.push(clip);
    }
  }

  /** A beat as the film plays it: what it touches, whether it plays alone, whether it may move the camera. */
  private clipOf(beat: Beat): Clip {
    const head = beat.events[0];
    if (head?.type === 'turn') this.turnSide = head.side;
    const zip = this.feel.zip && this.turnSide === 'red';
    // Zip mode: the camera goes only where your units fire, are fired on, move or are hit.
    const ours = beat.events.some((e) => e.type !== 'spotted' && e.type !== 'lost' && e.type !== 'radio' && keysOf(e).some((k) => this.views.get(k)?.side === 'blue'));
    const at = beat.events.find((e) => e.type === 'move' || e.type === 'fire') ?? head;
    const where = () => {
      if (at?.type === 'move') {
        const p = at.path.at(-1)!;
        return { x: p.x + 0.5, z: p.y + 0.5 };
      }
      if (at?.type === 'fire') return { x: at.to.x + 0.5, z: at.to.y + 0.5 };
      const v = at && 'unit' in at ? this.views.get(at.unit) : undefined;
      return v ? { x: v.x, z: v.z } : null;
    };
    return { steps: [], keys: beat.keys, alone: beat.alone, cam: !zip || ours, where, zip, joined: false, age: 0 };
  }

  /** Skip to the end of what is queued (fast-forward). */
  skip(): void {
    for (let n = 0; n < 5000 && (this.playing.length || this.waiting.length); n++) {
      const c = this.playing[0] ?? this.waiting[0]!;
      const s = c.steps.shift();
      if (s) {
        if (!s.started) {
          s.started = true;
          this.safely(s.start);
        }
        this.safely(() => s.tick?.(1, 0));
        this.safely(s.end);
      }
      if (!c.steps.length) {
        const list = this.playing[0] === c ? this.playing : this.waiting;
        list.splice(list.indexOf(c), 1);
      }
    }
    this.playing.length = 0;
    this.waiting.length = 0;
    this.cam = null;
    this.slow = 0;
    this.stop = 0;
    this.trauma = 0;
    this.hudLayer.clearCallouts();
  }

  /** Start beats that can play now: the next in line when nothing plays; with others, one that is independent of them. */
  private admit(): void {
    if (this.playing.some((p) => p.alone)) return;
    for (let i = 0; i < this.waiting.length && i < LOOK_AHEAD && this.playing.length < AT_ONCE; i++) {
      const c = this.waiting[i]!;
      if (!this.playing.length && i === 0) {
        this.begin(0);
        if (c.alone) return;
        i--;
        continue;
      }
      // Nothing goes past a beat that plays alone, and that beat waits for the rest to end.
      if (c.alone) return;
      // Joining beats in progress: no unit in common with them or with any beat still waiting before
      // it, a moment after the last one came in, and on screen as things stand (or the camera is free).
      if (this.playing.some((p) => shares(p, c)) || this.waiting.slice(0, i).some((w) => shares(w, c))) continue;
      if (this.clock - this.lastStart < STAGGER) return;
      if (c.cam && this.playing.some((p) => p.cam) && !this.inView(c.where())) continue;
      this.begin(i);
      i--;
    }
  }

  private begin(i: number): void {
    const [c] = this.waiting.splice(i, 1);
    if (!c) return;
    c.joined = this.playing.length > 0;
    c.age = 0;
    this.playing.push(c);
    this.lastStart = this.clock;
  }

  /**
   * Play `dt` seconds of the film: every beat on screen moves on together, and a step that ends inside
   * the frame hands the rest of it to the next, so the film keeps its length at any frame rate.
   */
  private run(dt: number, real: number): void {
    let left = dt;
    for (let n = 0; n < 512; n++) {
      this.admit();
      if (!this.playing.length) break;
      let span = left;
      for (const c of this.playing) {
        const s = c.steps[0];
        if (s) span = Math.min(span, s.dur - s.t);
      }
      span = Math.max(0, span);
      for (const c of this.playing) {
        const s = c.steps[0];
        if (!s) continue;
        if (!s.started) {
          s.started = true;
          this.safely(s.start);
        }
        s.t += span;
        if (span > 0 || s.dur === 0) this.safely(() => s.tick?.(s.dur > 0 ? Math.min(1, s.t / s.dur) : 1, span));
      }
      this.played += span;
      left -= span;
      let ended = false;
      for (const c of [...this.playing]) {
        const s = c.steps[0];
        if (s && s.t >= s.dur - 1e-6) {
          c.steps.shift();
          c.age = 0;
          this.safely(s.end);
          ended = true;
        }
        if (!c.steps.length) this.playing.splice(this.playing.indexOf(c), 1);
      }
      if (!ended && left <= 1e-9) break;
    }
    // A step that has played far longer than it should is ended where it stands (never expected).
    for (const c of [...this.playing]) {
      c.age += real;
      const s = c.steps[0];
      if (!s || c.age <= Math.max(8, s.dur * 3)) continue;
      this.faults++;
      c.steps.shift();
      c.age = 0;
      this.safely(s.end);
      if (!c.steps.length) this.playing.splice(this.playing.indexOf(c), 1);
    }
  }

  /** A point is on screen between the HUD bars, clear of the edges (where `follow` leaves the camera be). */
  private inView(p: { x: number; z: number } | null): boolean {
    if (!p) return true;
    const s = new THREE.Vector3(p.x, this.ground(p.x, p.z), p.z).project(this.camera);
    const margin = 0.25;
    return s.z <= 1 && Math.abs(s.x) <= 1 - margin && s.y <= 1 - this.hud[0] * 2 - margin && s.y >= -1 + this.hud[1] * 2 + margin;
  }

  /** Bring a beat's action into view: only beats that may move the camera do, and one that joined others centres nothing. */
  private show(clip: Clip, x: number, z: number, centre = false): void {
    if (clip.cam) this.follow(x, z, centre && !clip.joined);
  }

  /** A step of the beat being queued. `dead`: nothing to see (zip mode caps a run of them). */
  private step(dur: number, s: Omit<Step, 'dur' | 't' | 'started'>, dead = false): void {
    const clip = this.building;
    if (!clip) return;
    let d = Number.isFinite(dur) && dur > 0 ? dur : 0;
    if (clip.zip && dead) {
      d = Math.min(d, Math.max(0, DEAD_CAP - this.deadRun));
      this.deadRun += d;
    } else if (d > 0) this.deadRun = 0;
    this.planned += d;
    clip.steps.push({ dur: d, t: 0, started: false, ...s });
  }

  /** Run one moment of a step. A fault is counted and skipped: the film never stops on one. */
  private safely(fn: (() => void) | undefined): void {
    if (!fn) return;
    try {
      fn();
    } catch (e) {
      this.fault(e);
    }
  }

  private fault(e: unknown): void {
    this.faults++;
    if (this.faults <= 3) console.warn('battle film: a step failed and was skipped', e);
  }

  /** Drop whatever is playing and put every unit where the battle says (after a fault). */
  recover(): void {
    this.faults++;
    this.skip();
    this.cam = null;
    this.safely(() => this.resync());
  }

  private now(fn: () => void): void {
    this.step(0, { start: fn });
  }

  private worldOf(p: Point, h = 0.15): THREE.Vector3 {
    return new THREE.Vector3(p.x + 0.5, this.ground(p.x + 0.5, p.y + 0.5) + h, p.y + 0.5);
  }

  private muzzleOf(v: View): THREE.Vector3 {
    const m = this.model(v);
    if (!m) return new THREE.Vector3(v.x, this.ground(v.x, v.z) + 0.18, v.z);
    const holder = m.gun ?? m.turret;
    v.holder.updateMatrixWorld(true);
    return holder.localToWorld(m.muzzle.clone());
  }

  private centreOf(v: View): THREE.Vector3 {
    return new THREE.Vector3(v.x, this.ground(v.x, v.z) + (this.model(v)?.lift ?? 0) + (v.t.mobility === 'foot' ? 0.18 : 0.14 * VEHICLE_SCALE), v.z);
  }

  /** A short cut to the action: catastrophic kills, the kill that closes a turn and captures, with full motion only. */
  private actionCam(at: THREE.Vector3, from?: THREE.Vector3): void {
    if (!this.feel.actionCams || this.feel.motion !== 'full' || this.cam) return;
    const dir = from ? at.clone().sub(from).setY(0).normalize() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).negate();
    const eye = at.clone().sub(dir.multiplyScalar(3.6)).add(new THREE.Vector3(0, 1.3, 0));
    // Keep the line from the eye to the target clear of ground, trees and buildings: raise the eye
    // until it is, and skip the shot if that takes it high above the action.
    for (let i = 0; i <= 12; i++) {
      const f = 0.2 + (0.8 * i) / 12;
      const x = at.x + (eye.x - at.x) * f;
      const z = at.z + (eye.z - at.z) * f;
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      const top = Math.max(this.ground(x, z), cx >= 0 && cz >= 0 && cx < W && cz < H ? this.world.topAt(cx, cz) : 0) + 0.3;
      const need = at.y + (top - at.y) / f;
      if (need > eye.y) eye.y = need;
    }
    if (eye.y - at.y > 4.5) return;
    this.cam = { from: eye, at: at.clone(), t: 0, dur: 1.6 };
  }

  /**
   * A hit's weight on screen, by its rung on the severity ladder: a beat of hit stop and camera trauma,
   * less the farther it is from what the camera looks at. One unit's hits in one moment (the shot, the
   * casualties, the kill) shake once, by the worst of them.
   */
  private jolt(rung: Rung, v: View, stop = HIT_STOP[rung]): void {
    if (!rung) return;
    this.stop = Math.max(this.stop, stop);
    this.shakeAt(TRAUMA[rung], v.x, v.z, v.id);
  }

  private shakeAt(amount: number, x: number, z: number, id: string): void {
    const d = Math.hypot(x - this.focus.x, z - this.focus.z);
    const add = amount / (1 + (d / 8) ** 2);
    const prev = this.jolted.get(id);
    if (prev && this.clock - prev.t < 0.6) {
      if (add <= prev.add) return;
      this.trauma = Math.min(1, this.trauma + add - prev.add);
      prev.add = add;
      return;
    }
    this.jolted.set(id, { t: this.clock, add });
    this.trauma = Math.min(1, this.trauma + add);
  }

  /** Trauma shake on top of the resting pose: mostly a small turn of the head, a little sway. */
  private shakeCamera(): void {
    const s = this.trauma * this.trauma * (this.feel.motion === 'off' ? 0 : this.feel.shake / 100);
    if (s < 1e-4) return;
    const t = this.shakeClock;
    const a = SHAKE_TURN * s;
    this.camera.rotateY(a * wave(t, 0.7));
    this.camera.rotateX(a * 0.7 * wave(t, 2.9));
    this.camera.rotateZ(a * 0.5 * wave(t, 5.3));
    const m = SHAKE_SWAY * this.dist * s;
    this.camera.translateX(m * wave(t, 7.1));
    this.camera.translateY(m * wave(t, 9.4));
  }

  /** Soldiers fall where they stand: the dead go down, the wounded lie and move. */
  private fallMen(v: View, killed: number, wounded: number): void {
    const men = typeOf(v.type).men?.length ?? 1;
    v.hp = Math.max(0, v.hp - (killed + wounded) / Math.max(1, men));
    for (const id of [...v.men].reverse()) {
      if (!killed && !wounded) break;
      if (killed) {
        this.crowd.set(id, { pose: 'dead' });
        killed--;
      } else {
        this.crowd.set(id, { pose: 'wounded' });
        wounded--;
      }
      v.men = v.men.filter((m) => m !== id);
    }
  }

  /** Casualties in a word; more in the same unit a moment later add to it ("3 Down"). */
  private sayDown(v: View, killed: number, wounded: number): void {
    const prev = this.downs.get(v.id);
    const recent = prev && this.clock - prev.at < 0.8;
    const k = killed + (recent ? prev.killed : 0);
    const w = wounded + (recent ? prev.wounded : 0);
    this.downs.set(v.id, { killed: k, wounded: w, at: this.clock });
    const text = downText(k, w);
    if (text) this.say(v, text, this.toneFor(v), 'major', 'down');
  }

  private queue(e: BattleEvent): void {
    const clip = this.building!;
    const v = 'unit' in e ? this.views.get(e.unit) : undefined;
    switch (e.type) {
      case 'turn': {
        const mark = { side: e.side, planned: this.planned, played: 0 };
        this.step(
          0.2,
          {
            start: () => {
              mark.played = this.played;
              this.marks.push(mark);
              if (this.marks.length > 64) this.marks.shift();
            },
          },
          true,
        );
        break;
      }
      case 'move': {
        if (!v) break;
        if (v.side === 'red' && !e.seen.some(Boolean)) {
          // Unseen: it is somewhere else now, out of sight.
          this.now(() => {
            const last = e.path.at(-1)!;
            v.x = last.x + 0.5;
            v.z = last.y + 0.5;
            this.place(v);
          });
          break;
        }
        const pts = e.path.map((p) => new THREE.Vector2(p.x + 0.5, p.y + 0.5));
        const foot = v.t.mobility === 'foot';
        // Brisk: a tank crosses six cells in about two thirds of a second.
        const per = foot ? (e.dash ? 0.13 : 0.17) : v.t.mobility === 'heli' || v.t.mobility === 'drone' ? 0.07 : v.t.mobility === 'wheeled' ? 0.09 : 0.11;
        let dust = 0;
        const len = pts.length - 1;
        this.step(per * len + 0.1, {
          start: () => {
            this.show(clip, pts.at(-1)!.x, pts.at(-1)!.y);
            if (foot) this.posePeople(v, e.dash ? 'run' : 'walk', 1);
          },
          tick: (k, dt) => {
            const f = ease(k) * len;
            const i = Math.min(len - 1, Math.floor(f));
            const a = pts[i]!;
            const b = pts[i + 1]!;
            const t = f - i;
            v.x = a.x + (b.x - a.x) * t;
            v.z = a.y + (b.y - a.y) * t;
            const shown = v.side === 'blue' || !!e.seen[Math.round(f)];
            if (v.holder.visible !== shown) this.setShown(v, shown);
            v.shown = shown;
            const dir = Math.atan2(b.y - a.y, b.x - a.x);
            v.facing = lerpAngle(v.facing, dir, Math.min(1, dt * 12));
            v.aim = lerpAngle(v.aim, dir, Math.min(1, dt * 8));
            v.speed = dt > 0 ? 1 : 0;
            dust -= dt;
            if (dust <= 0 && !foot && shown && v.t.mobility !== 'heli' && v.t.mobility !== 'drone') {
              dust = 0.09;
              this.fx.dust(new THREE.Vector3(v.x - Math.cos(v.facing) * 0.4, this.ground(v.x, v.z) + 0.05, v.z - Math.sin(v.facing) * 0.4), 1);
            }
            if (!foot) this.audio.engine(v.id, v.t.engine === 'turbine' ? 'turbine' : 'diesel', v.x - 0.5, v.z - 0.5, 0.9);
            this.place(v);
          },
          end: () => {
            const last = pts.at(-1)!;
            v.x = last.x;
            v.z = last.y;
            v.speed = 0;
            if (foot) this.posePeople(v, 'kneel');
            this.place(v);
            if (!foot) this.audio.engine(v.id, v.t.engine === 'turbine' ? 'turbine' : 'diesel', v.x - 0.5, v.z - 0.5, 0.2);
          },
        });
        break;
      }
      case 'face':
        if (!v) break;
        this.step(
          0.25,
          {
            tick: (_k, dt) => {
              v.facing = lerpAngle(v.facing, e.facing, Math.min(1, dt * 10));
              v.aim = lerpAngle(v.aim, e.facing, Math.min(1, dt * 10));
              this.place(v);
            },
          },
          v.side === 'red' && !e.seen,
        );
        break;
      case 'fire':
        this.queueFire([e]);
        break;
      case 'intercept': {
        const target = this.views.get(e.by);
        this.now(() => {
          if (!e.seen) return;
          const p = this.worldOf({ x: e.x, y: e.y }, 0.8);
          this.fx.explosion(p, 0.4, 'airburst');
          this.audio.impact('small', e.x, e.y);
          if (target) target.flash = 0.4;
        });
        break;
      }
      case 'impact': {
        if (!v) break;
        const shown = e.seen || v.side === 'blue';
        const shook = e.pen ? undefined : this.notes.shook.get(e);
        this.step(
          e.pen ? 0.35 : 0.2,
          {
            start: () => {
              if (!shown) return;
              const c = this.centreOf(v);
              if (e.pen && e.effect !== 'none') {
                if (e.effect === 'catastrophic' || e.effect === 'knocked_out' || e.effect === 'shot_down') v.hp = 0;
                else v.hp = Math.max(0.1, v.hp - 0.3);
              }
              const rung: Rung = shook ? (Math.max(1, rungOf(e.effect, false)) as Rung) : rungOf(e.effect, e.pen);
              const word = e.pen ? (EFFECT_TEXT[e.effect] ?? 'Penetrated') : e.effect === 'tracks' || e.effect === 'optics' ? EFFECT_TEXT[e.effect]! : shook ? levelWord(shook, true) : 'Bounced';
              this.say(v, word, rung ? this.toneFor(v) : 'plain', rung >= 3 ? 'kill' : rung >= 2 || e.effect === 'crew' || (shook && shook !== 'suppressed') ? 'major' : 'minor');
              this.fx.hit(c, new THREE.Vector3(0, 1, 0), e.pen ? 'pen' : 'bounce');
              this.audio.impact(e.pen ? 'ke_hit' : 'bounce', e.x, e.y);
              v.flash = e.pen ? 1 : 0.5;
              this.jolt(rung, v, e.effect === 'catastrophic' || e.effect === 'shot_down' ? BREW_UP_STOP : HIT_STOP[rung]);
            },
          },
          !shown,
        );
        break;
      }
      case 'casualties':
        if (!v) break;
        this.now(() => {
          this.fallMen(v, e.killed, e.wounded);
          if (e.seen || v.side === 'blue') {
            this.sayDown(v, e.killed, e.wounded);
            this.jolt(1, v);
          }
        });
        break;
      case 'suppressed': {
        if (!v) break;
        // A bounce that shook the crew says it itself ("Shaken").
        const told = this.notes.shook.has(e);
        this.now(() => {
          if (e.level !== 'steady' && (e.seen || v.side === 'blue') && !told) {
            this.say(v, levelWord(e.level), this.toneFor(v), e.level === 'suppressed' ? 'minor' : 'major');
            this.jolt(1, v);
          }
          if (v.t.mobility === 'foot') this.posePeople(v, e.level === 'pinned' || e.level === 'broken' ? 'prone' : 'kneel');
        });
        break;
      }
      case 'destroyed': {
        if (!v) break;
        const by = this.lastShooter.get(e.unit);
        const seen = e.seen || v.side === 'blue';
        const last = this.notes.kills.has(e);
        this.step(
          e.how === 'wiped' || e.how === 'expended' ? 0.1 : 0.7,
          {
            start: () => {
              v.alive = false;
              v.hp = 0;
              if (e.how !== 'expended') this.feedKill(v, by, e.how, e.seen);
              const c = this.centreOf(v);
              if (v.t.mobility === 'foot') {
                for (const id of v.men) this.crowd.set(id, { pose: 'dead' });
                v.men = [];
                v.ring.visible = false;
                if (seen && e.how === 'wiped') {
                  this.say(v, 'Wiped Out', this.toneFor(v), 'kill');
                  this.jolt(2, v);
                  if (last) this.actionCam(c);
                }
                return;
              }
              if (!seen) {
                v.holder.visible = false;
                return;
              }
              this.setShown(v, true);
              v.ring.visible = false;
              const brew = e.how === 'destroyed' || e.how === 'shot_down';
              if (brew) {
                this.fx.catastrophic(c);
                // Half a second of slow motion as it goes up, with full motion only.
                if (this.feel.motion === 'full') this.slow = 0.45;
                this.fx.burn(v.id, c, v.t.armour && v.t.armour.hf[0] >= 300 ? 1.2 : 0.8);
                this.audio.impact('big', e.x, e.y);
                this.jolt(3, v, BREW_UP_STOP);
              } else if (e.how !== 'expended') this.jolt(3, v);
              if (brew || last) this.actionCam(c);
              if (e.how === 'shot_down' || e.how === 'landed') v.fall = 0.001;
              this.wreck(v);
              this.audio.stop(v.id);
              this.fx.stopRotorWash(v.id);
            },
          },
          !seen,
        );
        break;
      }
      case 'boom':
        this.step(
          0.3,
          {
            start: () => {
              const p = this.worldOf({ x: e.x, y: e.y }, 0.02);
              const kind = e.kind === 'bombs' ? 'bombs' : e.kind === 'rockets' ? 'rockets' : e.kind === 'mine' ? 'mine' : e.kind === 'smoke' ? 'he' : 'shell';
              this.fx.explosion(p, e.size, kind);
              this.audio.impact(e.kind === 'bombs' ? 'bombs' : e.kind === 'rockets' ? 'rockets' : e.kind === 'mine' ? 'mine' : 'shell', e.x, e.y);
              if (e.seen && e.kind !== 'smoke') this.shakeAt(Math.min(0.4, 0.1 * e.size), e.x + 0.5, e.y + 0.5, `boom:${e.x},${e.y}`);
            },
          },
          !e.seen,
        );
        break;
      case 'smoke':
        this.now(() => {
          this.fx.smoke(e.cells);
          if (e.side === 'blue') this.audio.impact('small', e.cells[0]?.x ?? 0, e.cells[0]?.y ?? 0);
        });
        break;
      case 'crater':
        this.now(() => this.world.addCrater(e.x, e.y));
        break;
      case 'terrain':
        this.now(() => {
          this.world.setCell(e.x, e.y, this.battle.map);
          if (e.cell === 6) {
            this.fx.collapse(this.worldOf({ x: e.x, y: e.y }, 0.1), 1);
            this.audio.impact('building', e.x, e.y);
          }
        });
        break;
      case 'embark':
        if (!v) break;
        this.step(
          0.4,
          {
            start: () => this.posePeople(v, 'run', 1),
            end: () => {
              v.aboard = true;
              this.setShown(v, false);
            },
          },
          !e.seen && v.side === 'red',
        );
        break;
      case 'dismount': {
        const carrier = this.views.get(e.carrier);
        this.step(
          0.5,
          {
            start: () => {
              for (const d of e.units) {
                const p = this.views.get(d.id);
                if (!p) continue;
                p.aboard = false;
                p.x = carrier?.x ?? d.x + 0.5;
                p.z = carrier?.z ?? d.y + 0.5;
                p.shown = p.side === 'blue' || e.seen;
                this.setShown(p, p.shown);
                this.posePeople(p, 'run', 1);
              }
            },
            tick: (k) => {
              for (const d of e.units) {
                const p = this.views.get(d.id);
                if (!p || !carrier) continue;
                p.x = carrier.x + (d.x + 0.5 - carrier.x) * k;
                p.z = carrier.z + (d.y + 0.5 - carrier.z) * k;
                this.place(p);
              }
            },
            end: () => {
              for (const d of e.units) {
                const p = this.views.get(d.id);
                if (!p) continue;
                p.x = d.x + 0.5;
                p.z = d.y + 0.5;
                this.posePeople(p, 'kneel');
                this.place(p);
              }
            },
          },
          !e.seen,
        );
        break;
      }
      case 'split':
      case 'merge':
        this.now(() => this.resync());
        break;
      case 'treat':
      case 'repair':
        this.step(0.3, {}, true);
        break;
      case 'mine':
        break;
      case 'spotted':
        if (e.side !== 'blue') break;
        this.now(() => {
          if (!this.contact) {
            this.contact = true;
            if (this.enemyMark) this.enemyMark.visible = false;
          }
          const s = this.views.get(e.unit);
          if (!s) return;
          if (!s.shown) this.say(s, 'Contact', 'plain', 'minor');
          s.shown = true;
          s.x = e.x + 0.5;
          s.z = e.y + 0.5;
          this.place(s);
          this.setShown(s, true);
        });
        break;
      case 'lost':
        if (e.side !== 'blue') break;
        this.now(() => {
          const s = this.views.get(e.unit);
          if (!s || !s.alive) return;
          s.shown = false;
          this.setShown(s, false);
        });
        break;
      case 'ability':
        if (e.id === 'airstrike') this.step(0.6, { start: () => this.audio.incoming(e.x, e.y, 0.6) });
        break;
      case 'radio':
        if (e.side === 'blue') this.now(() => this.audio.radio(e.call, { dir: this.direction(e.unit) }));
        break;
      case 'capture': {
        const zone = this.battle.map.zone;
        this.now(() => {
          this.world.setZone(e.rounds / 2);
          // Taking the ground is worth a look.
          if (zone) this.actionCam(this.worldOf(zone, 0.3));
        });
        break;
      }
      case 'end':
        this.step(0.6, {});
        break;
    }
  }

  /** Where a contact is, relative to the attackers' advance (north is front). */
  private direction(id: string): 'front' | 'left' | 'right' | 'rear' {
    const v = this.views.get(id);
    if (!v) return 'front';
    const blue = [...this.views.values()].filter((x) => x.side === 'blue' && x.alive);
    const cx = blue.reduce((s, x) => s + x.x, 0) / Math.max(1, blue.length);
    const cz = blue.reduce((s, x) => s + x.z, 0) / Math.max(1, blue.length);
    const a = Math.atan2(v.z - cz, v.x - cx);
    const rel = wrap(a + Math.PI / 2);
    return Math.abs(rel) < Math.PI / 4 ? 'front' : Math.abs(rel) > (3 * Math.PI) / 4 ? 'rear' : rel > 0 ? 'right' : 'left';
  }

  /**
   * Shots at one target (one, or a small-arms volley from several units): the shooters aim, fire
   * together and the rounds land. Where everyone is is read as the shot plays, after the moves before it.
   */
  private queueFire(fires: FireEvent[]): void {
    const clip = this.building!;
    const e = fires[0]!;
    const target = e.target ? this.views.get(e.target) : undefined;
    for (const f of fires) if (f.target) this.lastShooter.set(f.target, f.unit);
    const shots = fires.map((f) => {
      const v = this.views.get(f.unit);
      return { f, v, shown: !!v && (v.side === 'blue' || f.seen) };
    });
    const offMap = !shots[0]!.v;
    const kind = e.kind;
    const foot = (v: View | undefined) => v?.t.mobility === 'foot';
    const wantOf = (s: (typeof shots)[number]) => (s.v ? Math.atan2(s.f.to.y + 0.5 - s.v.z, s.f.to.x + 0.5 - s.v.x) : 0);
    const shown = shots.filter((s) => s.shown && s.v);
    const lead = shown[0]?.v;
    if (lead) {
      this.step(0.18, {
        start: () => {
          const to = target ?? { x: e.to.x + 0.5, z: e.to.y + 0.5 };
          // Frame both when they fit; otherwise watch the target (where the news is).
          if (Math.hypot(lead.x - to.x, lead.z - to.z) < 9) this.show(clip, (lead.x + to.x) / 2, (lead.z + to.z) / 2);
          else this.show(clip, to.x, to.z, true);
          for (const s of shown) {
            if (foot(s.v)) this.posePeople(s.v!, 'aim');
            if (s.v!.side === 'red' && !s.v!.holder.visible) this.setShown(s.v!, true);
          }
        },
        tick: (_k, dt) => {
          for (const s of shown) {
            const v = s.v!;
            const want = wantOf(s);
            v.aim = lerpAngle(v.aim, want, Math.min(1, dt * 14));
            if (foot(v) || v.t.mobility === 'heli' || v.t.mobility === 'drone') v.facing = lerpAngle(v.facing, want, Math.min(1, dt * 10));
            this.place(v);
          }
        },
        end: () => {
          for (const s of shown) {
            s.v!.aim = wantOf(s);
            this.place(s.v!);
          }
        },
      });
    }
    const side: Side = shots[0]!.v?.side ?? (e.unit.startsWith('support') ? (e.from.y > H / 2 ? 'blue' : 'red') : 'red');
    const d = Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y, offMap ? 8 : 0);
    let flight = 0.12;
    if (kind === 'atgm' || kind === 'manpads') flight = Math.min(1.6, 0.35 + d * 0.06);
    else if (kind === 'rocket') flight = Math.min(1.2, 0.2 + d * 0.05);
    else if (kind === 'mortar' || kind === 'howitzer') flight = Math.min(2.2, 0.8 + d * 0.04);
    else if (kind === 'fpv' || kind === 'loiter') flight = Math.min(2.4, 0.9 + d * 0.07);
    else if (kind === 'cannon') flight = 0.12 + d * 0.006;
    else flight = 0.25;
    const hit = fires.some((f) => f.hit);
    let to = new THREE.Vector3();
    // Nothing to see: an unseen shooter at an unseen target (zip mode trims it).
    const dead = !offMap && !shots.some((s) => s.shown) && target?.side !== 'blue' && !fires.some((f) => f.seen);
    this.step(
      flight,
      {
        start: () => {
          to = target ? this.centreOf(target) : this.worldOf(e.to, 0.05);
          // A miss goes past: land it a little beyond.
          if (!hit && target) to.add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8));
          const shownTo = target ? target.holder.visible : true;
          // Fire from out of sight: show who is taking it.
          if (!shots.some((s) => s.shown) && target && target.side === 'blue') this.show(clip, target.x, target.z, true);
          for (const s of shots) {
            const v = s.v;
            const from = v ? this.muzzleOf(v) : this.worldOf(s.f.from, 8);
            if (s.shown && v) {
              this.fx.muzzle(from, to.clone().sub(from).normalize(), s.f.calibre);
              if (foot(v)) this.posePeople(v, 'fire');
              v.flash = Math.max(v.flash, 0.15);
            }
            if (s.shown || offMap || shownTo) this.audio.shot(s.f.calibre, (v?.x ?? to.x) - 0.5, (v?.z ?? to.z) - 0.5, { night: this.night });
            if (!s.shown && !shownTo && !offMap) continue;
            if (kind === 'atgm' || kind === 'manpads') this.fx.missile(from, to, kind === 'manpads' ? 'manpads' : s.f.weapon.toLowerCase().includes('hellfire') ? 'hellfire' : 'atgm', flight, { top: !!typeOf(v?.type ?? 'm1a2').weapons.find((w) => w.id === s.f.weapon)?.top });
            else if (kind === 'rocket') this.fx.missile(from, to, 'rocket', flight);
            else if (kind === 'mortar' || kind === 'howitzer') {
              this.fx.shell(from, to, flight);
              this.audio.incoming(s.f.to.x, s.f.to.y, flight);
            } else if (kind === 'fpv' || kind === 'loiter') {
              const model = buildProjectile(s.f.weapon.includes('switch') || v?.type === 'switchblade' ? 'switchblade' : v?.type === 'lancet' ? 'lancet' : 'fpv');
              this.fx.drone(from, to, flight, v?.type === 'switchblade' ? 'switchblade' : v?.type === 'lancet' ? 'lancet' : 'fpv', model);
              this.audio.drone(`d${this.clock}`, 'fpv', s.f.to.x, s.f.to.y);
            } else {
              const bursts = kind === 'mg' || kind === 'small_arms' ? 5 : kind === 'autocannon' ? 3 : 1;
              for (let i = 0; i < bursts; i++) this.fx.tracer(from, to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25)), s.f.calibre, side, flight);
            }
          }
        },
        end: () => {
          for (const s of shown) if (foot(s.v)) this.posePeople(s.v!, 'aim');
          if (!hit && !(kind === 'mortar' || kind === 'howitzer')) this.fx.hit(to, new THREE.Vector3(0, 1, 0), 'small');
          if (!hit && target && target.holder.visible) this.say(target, 'Miss', 'plain', 'minor');
        },
      },
      dead,
    );
  }

  /** A small-arms volley: the shots together, then what they did to the target in one word, then the rest. */
  private queueVolley(volley: Volley): void {
    this.queueFire(volley.fires);
    const v = this.views.get(volley.target);
    if (v && volley.hits.length) {
      const hits = volley.hits;
      this.now(() => {
        let killed = 0;
        let wounded = 0;
        let level: (typeof hits)[number] | null = null;
        let seen = v.side === 'blue';
        let rung: Rung = 0;
        const effects: string[] = [];
        for (const h of hits) {
          if ('seen' in h && h.seen === true) seen = true;
          if (h.type === 'casualties') {
            killed += h.killed;
            wounded += h.wounded;
            rung = Math.max(rung, 1) as Rung;
          } else if (h.type === 'suppressed') level = h;
          else if (h.type === 'impact') {
            rung = Math.max(rung, rungOf(h.effect, h.pen)) as Rung;
            const word = h.pen ? (EFFECT_TEXT[h.effect] ?? 'Penetrated') : h.effect === 'tracks' || h.effect === 'optics' ? EFFECT_TEXT[h.effect]! : '';
            if (word && !effects.includes(word)) effects.push(word);
            if (seen) this.fx.hit(this.centreOf(v), new THREE.Vector3(0, 1, 0), h.pen ? 'pen' : 'bounce');
          }
        }
        this.fallMen(v, killed, wounded);
        const lv = level?.type === 'suppressed' && level.level !== 'steady' ? level.level : null;
        if (v.t.mobility === 'foot' && lv) this.posePeople(v, lv === 'pinned' || lv === 'broken' ? 'prone' : 'kneel');
        if (!seen) return;
        const bounced = hits.some((h) => h.type === 'impact' && !h.pen);
        const parts = [downText(killed, wounded), ...effects, lv ? levelWord(lv, bounced && !killed && !wounded && !effects.length) : ''].filter(Boolean);
        if (!parts.length && bounced) parts.push('Bounced');
        if (lv) rung = Math.max(rung, 1) as Rung;
        if (parts.length) this.say(v, parts.join(', '), rung ? this.toneFor(v) : 'plain', rung >= 3 ? 'kill' : killed || wounded || effects.length || lv === 'pinned' || lv === 'broken' ? 'major' : 'minor');
        this.jolt(rung, v);
      });
    }
    for (const e of volley.rest) this.queue(e);
  }

  /** A line for the kill feed: who got whom, as far as we saw. */
  private feedKill(v: View, by: string | undefined, how: string, seen: boolean): void {
    const onFeed = this.opts.onFeed;
    if (!onFeed) return;
    const name = (id: string) => {
      const u = this.battle.units.find((x) => x.id === id);
      return u ? (u.side === 'blue' ? u.name : typeOf(u.type).short) : null;
    };
    const verb = how === 'shot_down' ? 'shot down' : how === 'wiped' ? 'wiped out' : how === 'landed' ? 'forced down' : 'knocked out';
    const shooter = by ? this.battle.units.find((x) => x.id === by) : undefined;
    if (v.side === 'red') {
      if (!seen) return;
      onFeed(`${shooter?.side === 'blue' ? shooter.name : 'We'} ${verb} ${/^[AEIOU]/.test(typeOf(v.type).short) ? 'an' : 'a'} ${typeOf(v.type).short}`, 'good');
    } else {
      const who = shooter && shooter.side === 'red' && this.views.get(shooter.id)?.shown ? ` by ${/^[AEIOU]/.test(typeOf(shooter.type).short) ? 'an' : 'a'} ${typeOf(shooter.type).short}` : '';
      onFeed(`${name(v.id) ?? 'A unit'} ${verb}${who}`, 'bad');
    }
  }

  private wreck(v: View): void {
    v.wreck = true;
    const m = this.model(v);
    if (!m) return;
    for (const mat of m.paint) {
      const s = mat as THREE.MeshStandardMaterial;
      if (s.color) s.color.multiplyScalar(0.28);
      s.roughness = 1;
    }
    this.world.scorch(Math.floor(v.x), Math.floor(v.z));
  }

  /** Re-read units from the battle (after splits, merges and anything the film cannot show). */
  resync(): void {
    for (const u of this.battle.units) {
      let v = this.views.get(u.id);
      if (!v) {
        this.addUnit(u, u.side === 'blue' || !!this.battle.intel.blue[u.id]?.now);
        v = this.views.get(u.id)!;
      }
      if (v.t.mobility === 'foot' && u.alive) {
        const live = u.men.map((m, i) => ({ m, i })).filter(({ m }) => m.state !== 'dead');
        const fit = live.filter(({ m }) => m.state === 'fit').map(({ i }) => `${u.id}#${i}`);
        // Soldiers that left this unit (a split) move to the other half.
        for (const id of v.men) if (!fit.includes(id)) this.crowd.remove(id);
        for (const id of fit) if (!v.men.includes(id)) this.crowd.add(id, v.t.faction, kitFor(u.type, u.men[Number(id.split('#')[1])]!.role), v.x, v.z, yawOf(v.facing));
        v.men = fit;
        v.type = u.type;
      }
      v.x = u.x + 0.5;
      v.z = u.y + 0.5;
      v.facing = u.facing;
      v.aim = u.aim;
      v.aboard = !!u.carrier;
      this.place(v);
      this.setShown(v, (u.side === 'blue' || !!this.battle.intel.blue[u.id]?.now) && u.alive);
    }
    for (const [id, v] of this.views) if (!this.battle.units.some((u) => u.id === id)) {
      for (const s of v.men) this.crowd.remove(s);
      this.scene.remove(v.holder);
      this.views.delete(id);
    }
  }

  // --- Frame ---------------------------------------------------------------------------------------

  frame(dt: number): void {
    const t0 = performance.now();
    // `dt` comes at the film's speed (`rate`): presentation only, nothing the battle depends on.
    const real = dt;
    // Hit stop: the film and the effects hold still for a beat on a heavy hit; the camera does not.
    if (this.stop > 0) {
      const held = Math.min(this.stop, dt);
      this.stop -= held;
      dt -= held;
    }
    // A beat of slow motion when something big goes up; the camera still moves at full speed.
    if (this.slow > 0) {
      this.slow = Math.max(0, this.slow - real);
      dt *= 0.3;
    }
    this.clock += dt;
    this.run(dt, real);
    if (this.cam) {
      this.cam.t += dt;
      if (this.cam.t >= this.cam.dur) this.cam = null;
    }
    for (const v of this.views.values()) {
      const m = this.model(v);
      if (v.t.mobility === 'foot' || !m) continue;
      // Detail by distance from what the camera looks at.
      const near = Math.hypot(v.x - this.focus.x, v.z - this.focus.z) <= this.preset.detailCells;
      this.setLod(v, near ? 0 : 1);
      const mm = this.model(v)!;
      // Roll the wheels and tracks by the distance driven this frame (forward is along the hull).
      const moved = (v.x - v.lastX) * Math.cos(v.facing) + (v.z - v.lastZ) * Math.sin(v.facing);
      v.lastX = v.x;
      v.lastZ = v.z;
      if (v.alive && !v.wreck) {
        for (const r of mm.rotors) r.obj.rotation[r.axis] += r.rate * dt;
        if (moved) {
          for (const w of mm.wheels) w.rotation.x += moved / Math.max(0.001, mm.wheelRadius * VEHICLE_SCALE);
          for (const tr of mm.tracks) {
            const map = (tr as THREE.MeshStandardMaterial).map;
            if (map) map.offset.y += (moved * mm.trackScroll) / VEHICLE_SCALE;
          }
        }
        if (v.t.mobility === 'heli' && v.holder.visible) {
          this.fx.rotorWash(v.id, new THREE.Vector3(v.x, this.ground(v.x, v.z), v.z), 0.8);
          const [blades, rpm] = ROTOR[v.type] ?? [4, 280];
          this.audio.rotor(v.id, blades, rpm, v.x - 0.5, v.z - 0.5, { coaxial: v.type === 'ka52' });
        }
      }
      if (v.fall > 0 && v.fall < 1) {
        v.fall = Math.min(1, v.fall + dt * 1.4);
        v.holder.rotation.z = v.fall * 0.6;
        this.place(v);
      }
      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt * 3);
        for (const mat of mm.paint) {
          const s = mat as THREE.MeshStandardMaterial;
          if (s.emissive) s.emissive.setRGB(v.flash * 0.6, v.flash * 0.3, v.flash * 0.1);
        }
      }
    }
    this.trauma = Math.max(0, this.trauma - real * TRAUMA_DRAIN);
    this.shakeClock += real;
    this.applyCamera(real);
    this.world.update(dt, this.camera);
    this.fx.update(dt, this.camera);
    this.crowd.update(dt);
    this.audio.setListener({ x: this.focus.x - 0.5, y: this.focus.z - 0.5, zoom: Math.min(1, this.dist / this.maxDist) });
    this.audio.update(dt);
    this.renderer.render(this.scene, this.camera);
    // Words read in real time, whatever speed the film runs at.
    this.updateHud(real / Math.max(1, this.rate));
    this.frameMs.push(performance.now() - t0);
    if (this.frameMs.length > 600) this.frameMs.shift();
  }

  /** Compile every shader in the scene before the first frame, so the battle opens without a hitch. */
  async warm(): Promise<void> {
    await this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
  }

  /** Our own work per frame (ms) and what the GPU was asked to draw, for the performance probe.
   *  `reset` starts a fresh sample after this read. */
  perf(reset = false): { p50: number; p95: number; frames: number; calls: number; triangles: number; quality: Quality } {
    const s = [...this.frameMs].sort((a, b) => a - b);
    if (reset) this.frameMs.length = 0;
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
    return { p50: q(0.5), p95: q(0.95), frames: s.length, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, quality: this.opts.quality };
  }

  dispose(): void {
    this.hudLayer.dispose();
    this.audio.dispose();
    this.fx.dispose();
    this.crowd.dispose();
    this.world.dispose();
    for (const v of this.views.values()) for (const m of v.models) m?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export { LEVEL, METRE };
