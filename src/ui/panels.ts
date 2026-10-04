// What the HUD's panels show, read from the world. Shared by the 2D scene and the 3D controller, so both
// games say the same things.
import { DINOS, EXHIBITS, UNITS, type AnimalKind } from '../config';
import { breakoutSeconds, secondsToSedate } from '../core/estimates';
import { reinforceCost } from '../core/exhibit';
import type { PlacementPlan, TowerPlan } from '../core/placement';
import { canTrainNow, isTroop } from '../core/units';
import type { World } from '../core/world';
import { afterBlackout, formatMoney, type ExhibitView, type PlaceView, type TrainingView } from './hud';

/** HQ's training panel: the queue, and how fast the team will sedate what it is up against. */
export function trainingView(w: World): TrainingView {
  // Troops alive plus the queue: what the player will have.
  const team = [...w.units.filter(isTroop).map((u) => u.kind), ...w.queue.map((q) => q.kind)];
  // What the team will be darting: in levels 1 and 2 the animals that started loose, one at a time.
  const kinds: { kind: AnimalKind; count: number }[] = w.hunt
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
  if (w.powerOn) fence = gaps ? `${material}, ${gaps} ${gaps === 1 ? 'segment' : 'segments'} down` : `${material}, powered`;
  else if (gaps) fence = `${gaps} ${gaps === 1 ? 'gap' : 'gaps'}, weakest ${Number.isFinite(weakest) ? weakest : 0}/${max}`;
  else fence = `${material}, weakest ${weakest}/${max}`;
  const kind = EXHIBITS[ex.kind].animal;
  const mine = w.dinos.filter((d) => d.home === ex.id);
  const inside = mine.filter((d) => d.state === 'penned' || d.state === 'contained').length;
  const out = mine.filter((d) => d.state === 'loose').length;
  const name = DINOS[kind];
  const animals = out ? `${inside} inside · ${out} loose` : inside ? `${inside} ${inside === 1 ? name.name : name.plural}` : 'None left';
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
    closed: !!w.hunt,
    breakout: w.canBuild ? { now: breakoutSeconds(ex.kind, ex.reinforced), concrete: ex.reinforced ? null : breakoutSeconds(ex.kind, true) } : null,
  };
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
