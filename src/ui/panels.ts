// What the HUD's panels show, read from the world. Shared by the 2D scene and the 3D controller, so both
// games say the same things.
import { DINOS, EXHIBITS, GRID, UNITS, type AnimalKind, type ExhibitKind, type UnitKind } from '../config';
import { huntersOf, packCircling } from '../core/dinos';
import { breakoutSeconds, secondsToSedate } from '../core/estimates';
import { reinforceCost } from '../core/exhibit';
import type { PlacementPlan, TowerPlan } from '../core/placement';
import { repairProgress } from '../core/power';
import { animalNoun } from '../core/report';
import { canDart, canTrainNow, isTroop, type Unit } from '../core/units';
import type { World } from '../core/world';
import { numberWord } from './levels';
import { afterBlackout, formatClock, formatMoney, type ExhibitView, type PlaceView, type SubstationView, type TrainingView } from './hud';
import { pensText } from './timeline';

/** HQ's training panel: the queue, and how fast the team will sedate what it is up against. */
export function trainingView(w: World): TrainingView {
  // Troops alive plus the queue that can dart: what the player will have.
  const team = [...w.units.filter((u) => !u.dead && isTroop(u)).map((u) => u.kind), ...w.queue.map((q) => q.kind)].filter(canDart);
  // What the team will be darting: in mission levels the animals that started loose, one at a time.
  const kinds: { kind: AnimalKind; count: number }[] = w.mission
    ? (Object.keys(w.startedLoose) as AnimalKind[]).map((kind) => ({ kind, count: 1 }))
    : [
        { kind: 'trex', count: 1 },
        { kind: 'raptor', count: EXHIBITS.raptor.animalCount },
      ];
  return {
    money: w.money,
    canTrain: canTrainNow(w),
    kinds: w.trainable,
    queue: w.queue.map((q, i) => ({
      id: q.id,
      kind: q.kind,
      progress: i === 0 ? 1 - q.left / UNITS[q.kind].trainSeconds : 0,
    })),
    team: { troops: team.length, targets: kinds.map((k) => ({ ...k, seconds: secondsToSedate(team, k.kind, k.count) })) },
  };
}

/** An exhibit's panel: its fence, its animals, its takings, and while building, reinforcing. */
export function exhibitView(w: World, id: number): ExhibitView | null {
  const ex = w.exhibitById(id);
  if (!ex) return null;
  const segs = ex.segments;
  const gaps = segs.filter((s) => s.hp <= 0).length;
  const weakest = Math.min(...segs.filter((s) => s.hp > 0).map((s) => s.hp));
  const max = segs[0].maxHp;
  const material = ex.reinforced ? 'Concrete' : 'Chain-link';
  let fence: string;
  const gapWords = `${gaps} ${gaps === 1 ? 'gap' : 'gaps'}`;
  if (ex.powered) fence = gaps ? `${material}, ${gaps} ${gaps === 1 ? 'segment' : 'segments'} down` : `${material}, powered`;
  // In the blackout every fence is dark; in level 4 and 5 only some are, so say so.
  else if (w.mission) fence = gaps ? `No power, ${gapWords}` : `No power, weakest ${weakest}/${max}`;
  else if (gaps) fence = `${gapWords}, weakest ${Number.isFinite(weakest) ? weakest : 0}/${max}`;
  else fence = `${material}, weakest ${weakest}/${max}`;
  const kind = EXHIBITS[ex.kind].animal;
  const mine = w.dinos.filter((d) => d.home === ex.id && d.state !== 'dead');
  const inside = mine.filter((d) => d.state === 'penned' || d.state === 'contained').length;
  const out = mine.filter((d) => d.state === 'loose').length;
  const name = DINOS[kind];
  const animals = out ? `${inside} inside · ${out} loose` : inside ? `${inside} ${inside === 1 ? name.name : name.plural}` : 'None left';
  // Level 4: when the animals inside go for the fence, while it has no power.
  let breaksOut: string | null = null;
  if (w.mission && !ex.powered && inside && ex.breakoutAt !== undefined && !gaps) {
    const left = ex.breakoutAt === null ? null : ex.breakoutAt - w.phaseTime;
    breaksOut = left === null ? 'Not on their own' : left > 0 ? `In ${formatClock(left)}` : 'Now';
  }
  const sub = w.substationFor(ex.id);
  return {
    id: ex.id,
    name: EXHIBITS[ex.kind].name,
    kind: ex.kind,
    visits: ex.visits,
    revenue: ex.revenue,
    fence,
    animals,
    reinforceCost: w.canBuild && !ex.reinforced ? reinforceCost(ex.footprint) : null,
    reinforced: ex.reinforced,
    money: w.money,
    closed: !!w.mission,
    breakout: w.canBuild ? { now: breakoutSeconds(ex.kind, ex.reinforced), concrete: ex.reinforced ? null : breakoutSeconds(ex.kind, true) } : null,
    breaksOut,
    powerFrom: sub ? `${sub.name}, ${sub.fixed ? 'fixed' : 'broken'}` : null,
  };
}

/** Level 4: a substation's panel: what it powers, and how far the fix has got. */
export function substationView(w: World, id: number): SubstationView | null {
  const s = w.substationById(id);
  if (!s) return null;
  const kinds = s.pens.map((p) => w.exhibitById(p)?.kind).filter((k): k is ExhibitKind => !!k);
  const powers = pensText(kinds);
  const progress = repairProgress(s);
  const left = Math.max(0, GRID.repairSeconds - s.work);
  const status = s.fixed
    ? `Fixed. ${kinds.length === 1 ? 'Its pen has' : 'Its pens have'} power.`
    : s.workers
      ? `${s.workers === 1 ? 'An Engineer is' : `${s.workers} Engineers are`} fixing it: ${Math.ceil(left / s.workers)} s left`
      : progress > 0
        ? `${Math.round(progress * 100)}% fixed. Send an Engineer back.`
        : 'Broken. Send an Engineer.';
  return { id: s.id, name: `${s.name} substation`, powers: powers[0].toUpperCase() + powers.slice(1), status, progress, fixed: s.fixed };
}

/** The placement panel for an exhibit: what it costs, earns, and when its animals get out. */
export function exhibitPlaceView(plan: PlacementPlan): PlaceView {
  const cfg = EXHIBITS[plan.kind];
  const tiles = plan.newPathTiles.length;
  const lines: [string, string][] = [['Exhibit', formatMoney(plan.exhibitCost)]];
  if (plan.viewingSpot) lines.push([tiles === 1 ? 'Path (1 tile)' : `Path (${tiles} tiles)`, formatMoney(plan.pathCost)]);
  lines.push(['Earns per visit', formatMoney(cfg.pricePerVisit)]);
  lines.push(['Breaks out', afterBlackout(breakoutSeconds(plan.kind, false))]);
  return { title: cfg.name, lines, reason: plan.reason, cost: plan.totalCost, valid: plan.valid };
}

/** The placement panel for a tower. `T` is the tile size in world pixels. */
export function towerPlaceView(plan: TowerPlan, T: number): PlaceView {
  const cfg = UNITS.tower;
  return {
    title: cfg.name,
    lines: [
      ['Darts', `${cfg.dartSedation} every ${cfg.fireIntervalSeconds} s`],
      ['Range', `${Math.round(cfg.range / T)} tiles`],
      ['HP', String(cfg.hp)],
    ],
    reason: plan.reason,
    cost: plan.cost,
    valid: plan.valid,
  };
}

/** "2 Tranq · 1 Engineer · 4x4 (2 in) selected", for the bottom bar. */
export function selectionSummary(units: readonly Unit[], selected: ReadonlySet<number>, riders: (jeep: Unit) => number): string {
  const n = { tranq: 0, heavy: 0, engineer: 0 };
  let jeep = '';
  for (const u of units) {
    if (!selected.has(u.id)) continue;
    if (u.kind === 'jeep') jeep = `4x4 (${riders(u)} in)`;
    else if (u.kind !== 'tower') n[u.kind]++;
  }
  const parts = [n.tranq ? `${n.tranq} Tranq` : '', n.heavy ? `${n.heavy} Heavy` : '', n.engineer ? `${n.engineer} ${n.engineer === 1 ? 'Engineer' : 'Engineers'}` : '', jeep].filter(Boolean);
  return `${parts.join(' · ')} selected`;
}

/** The banner when a mission level starts. */
export function startBanner(w: World): string {
  const opens = `The park opens in ${formatClock(w.clockSeconds)}.`;
  const loose = w.dinos.filter((d) => d.state === 'loose');
  if (w.level === 4) {
    const word = numberWord(loose.length);
    return `${word[0].toUpperCase()}${word.slice(1)} ${loose.length === 1 ? 'raptor is' : 'raptors are'} on patrol. Fix ${w.substations.length} substations before dawn.`;
  }
  if (w.level === 5) return `The T. rex is breaking into the raptor cage. ${opens}`;
  const kind = (Object.keys(w.startedLoose)[0] as AnimalKind | undefined) ?? 'triceratops';
  return `${loose.length} ${animalNoun(kind, loose.length)} ${w.nest ? 'are guarding a nest' : 'are loose'}. ${opens}`;
}

/** The toast when raptors come for a troop: circling it as a pack, coming straight at it, or one alone. */
export function huntedToast(w: World, unitId: number, kind: UnitKind): string {
  const name = UNITS[kind].name;
  if (packCircling(w, unitId)) return `Raptors are circling the ${name}.`;
  return huntersOf(w, unitId).length > 1 ? `Raptors are after the ${name}.` : `A raptor is after the ${name}.`;
}
