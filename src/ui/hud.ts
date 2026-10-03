import { COLORS, DINOS, EXHIBITS, EXHIBIT_KINDS, FENCE, SQUAD, UNITS, UNIT_KINDS, type AnimalKind, type ExhibitKind, type UnitKind } from '../config';
import { sedationPerSecond } from '../core/estimates';
import type { Result } from '../core/report';
import type { Phase } from '../core/world';
import { nextTime, timelineLines } from './timeline';

/** Things placed from the build bar. */
export type BuildKind = ExhibitKind | 'tower';
const BUILD_KINDS: readonly BuildKind[] = [...EXHIBIT_KINDS, 'tower'];

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface HudHandlers {
  selectBuild(kind: BuildKind): void;
  confirmPlacement(): void;
  cancelPlacement(): void;
  start(options: { quick: boolean; debug: boolean; tips: boolean }): void;
  retry(): void;
  openTraining(): void;
  train(kind: UnitKind): void;
  cancelQueued(queueId: number): void;
  reinforce(exhibitId: number): void;
  closePanel(): void;
  selectAll(): void;
  clearSelection(): void;
  debugSpeed(speed: number): void;
  debugBlackout(): void;
  debugMoney(): void;
  debugToggle(name: 'hp' | 'grid' | 'fps', on: boolean): void;
  /** The open tip was read. */
  tipDone(): void;
  /** Turn tips off. */
  tipsOff(): void;
  /** Pause menu. Restart uses retry. */
  openMenu(): void;
  resume(): void;
  endGame(): void;
  /** An arrow at the map edge was tapped. */
  focusArrow(key: string): void;
}

export interface TopView {
  phase: Phase;
  money: number;
  revenue: number;
  revenueTarget: number;
  clockSeconds: number;
  casualties: number;
  casualtyLimit: number;
  penned: number;
  loose: number;
  secured: number;
  contained: number;
  allClear: boolean;
  /** Visitors still in the park. */
  inPark: number;
  /** The park has sent everyone to the gate. */
  evacuating: boolean;
}

/** What the placement panel shows for an exhibit or a tower. */
export interface PlaceView {
  title: string;
  lines: [string, string][];
  /** Why it can't be built, or null when it can. */
  reason: string | null;
  cost: number;
  valid: boolean;
}

export interface TrainingView {
  money: number;
  canTrain: boolean;
  queue: { id: number; kind: UnitKind; progress: number }[];
  /** Troops alive or queued, and how long they take darting together. */
  team: { troops: number; trexSeconds: number; packSeconds: number; packSize: number };
}

export interface ExhibitView {
  id: number;
  name: string;
  kind: ExhibitKind;
  visits: number;
  revenue: number;
  fence: string;
  animals: string;
  /** null when reinforcing isn't possible any more. */
  reinforceCost: number | null;
  reinforced: boolean;
  money: number;
  /** Before the blackout: seconds until these animals get out (null: never on their own), and the same behind concrete. */
  breakout: { now: number | null; concrete: number | null } | null;
}

/** An arrow at the edge of the map pointing at something off screen. Position in CSS pixels. */
export interface ArrowView {
  key: string;
  x: number;
  y: number;
  /** Direction it points, in radians. */
  angle: number;
  kind: AnimalKind | 'breach';
  count: number;
}

export interface BriefingView {
  buildSeconds: number;
  quickSeconds: number;
  revenueTarget: number;
  villain: string;
  quick: boolean;
  debug: boolean;
  tips: boolean;
}

export type Panel = 'place' | 'train' | 'exhibit';

/** "14 s after the blackout" style text for planning numbers. */
export const afterBlackout = (s: number | null) => (s === null ? 'Never on its own' : `${Math.round(s)} s after blackout`);

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
export const formatMoney = (n: number) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
export const formatClock = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text?: string): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  return b;
}

/** Writes text only when it changed, so per-frame updates stay cheap. */
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function animalIcon(kind: AnimalKind): string {
  const fill = hex(COLORS.animal[kind]);
  const stroke = hex(COLORS.animalStroke[kind]);
  switch (kind) {
    case 'triceratops':
      return `<svg viewBox="0 0 26 26" aria-hidden="true"><ellipse cx="13" cy="13" rx="9.5" ry="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></svg>`;
    case 'raptor':
      return `<svg viewBox="0 0 26 26" aria-hidden="true"><polygon points="6,6.5 21,13 6,19.5" fill="${fill}" stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
    case 'trex':
      return `<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><rect x="17.5" y="11" width="6" height="4" rx="1" fill="${hex(COLORS.trexNotch)}"/></svg>`;
  }
}

function unitIcon(kind: UnitKind): string {
  const fill = hex(COLORS.unit);
  const stroke = hex(COLORS.unitStroke);
  switch (kind) {
    case 'tranq':
      return `<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="7" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></svg>`;
    case 'heavy':
      return `<svg viewBox="0 0 26 26" aria-hidden="true"><rect x="5" y="5" width="16" height="16" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></svg>`;
    case 'tower':
      return `<svg viewBox="0 0 26 26" aria-hidden="true"><rect x="3" y="3" width="20" height="20" rx="3" fill="${hex(COLORS.tower)}" stroke="${hex(COLORS.towerTrim)}" stroke-width="1.5"/><circle cx="13" cy="13" r="5.5" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/><rect x="17" y="11.8" width="6" height="2.4" fill="#e8f0ff"/></svg>`;
  }
}

/** The HTML layer over the game canvas. */
export class Hud {
  handlers: HudHandlers | null = null;

  private readonly topBar: HTMLElement;
  private readonly moneyVal: HTMLElement;
  private readonly revenueVal: HTMLElement;
  private readonly revenueCap: HTMLElement;
  private readonly revenueMeter: HTMLElement;
  private readonly revenueStat: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly clockCap: HTMLElement;
  private readonly clockVal: HTMLElement;
  private readonly dinoVal: HTMLElement;
  private readonly casualtyVal: HTMLElement;
  private readonly casualtyStat: HTMLElement;

  private readonly bottomBar: HTMLElement;
  private readonly buildGroup: HTMLElement;
  private readonly buildButtons = new Map<BuildKind, HTMLButtonElement>();
  private readonly buildMeta = new Map<BuildKind, { price: HTMLElement; left: HTMLElement }>();
  private readonly hqMeta: HTMLElement;
  private readonly selectAllBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly selSummary: HTMLElement;

  private readonly placePanel: HTMLElement;
  private readonly placeTitle: HTMLElement;
  private readonly placeLines: HTMLElement;
  private readonly placeReason: HTMLElement;
  private readonly confirmBtn: HTMLButtonElement;

  private readonly trainPanel: HTMLElement;
  private readonly trainButtons = new Map<UnitKind, HTMLButtonElement>();
  private readonly queueLabel: HTMLElement;
  private readonly queueChips: HTMLElement;
  private readonly teamNote: HTMLElement;
  private queueKey = '';

  private readonly exhibitPanel: HTMLElement;
  private readonly exTitle: HTMLElement;
  private readonly exVisits: HTMLElement;
  private readonly exRevenue: HTMLElement;
  private readonly exFence: HTMLElement;
  private readonly exAnimals: HTMLElement;
  private readonly exBreakout: HTMLElement;
  private readonly reinforceBtn: HTMLButtonElement;
  private readonly reinforceNote: HTMLElement;
  private exhibitId = 0;

  private readonly banner: HTMLElement;
  private bannerTimer = 0;
  private readonly toastEl: HTMLElement;
  private toastTimer = 0;

  private readonly briefing: HTMLElement;
  private readonly briefTitle: HTMLElement;
  private readonly briefIntro: HTMLElement;
  private readonly briefGoal2: HTMLElement;
  private readonly quickBox: HTMLInputElement;
  private readonly quickLabel: HTMLElement;
  private readonly debugBox: HTMLInputElement;
  private readonly tipsBox: HTMLInputElement;

  private readonly tipCard: HTMLElement;
  private readonly tipTitle: HTMLElement;
  private readonly tipBody: HTMLElement;
  private briefView: BriefingView | null = null;

  private readonly endScreen: HTMLElement;
  private readonly endBody: HTMLElement;

  private readonly menu: HTMLElement;
  private readonly arrowLayer: HTMLElement;
  private readonly arrows: { el: HTMLButtonElement; pointer: HTMLElement; icon: HTMLElement; count: HTMLElement; kind: string; transform: string; rotate: string }[] = [];

  private readonly debugPanel: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly speedButtons: HTMLButtonElement[] = [];

  private openPanel: Panel | null = null;

  constructor(root: HTMLElement) {
    // ------------------------------------------------ top bar
    this.topBar = el('div', 'topbar');
    const stat = (cls: string, cap: string) => {
      const box = el('div', `stat ${cls}`);
      const c = el('span', 'cap', cap);
      const v = el('span', 'val');
      box.append(c, v);
      return { box, cap: c, val: v };
    };
    const money = stat('money', 'Money');
    const revenue = stat('revenue', 'Revenue');
    this.revenueMeter = el('i');
    const meter = el('span', 'meter');
    meter.append(this.revenueMeter);
    revenue.box.append(meter);
    this.clock = el('div', 'clock');
    this.clockCap = el('span', 'cap', 'Until blackout');
    this.clockVal = el('span', 'val', '10:00');
    this.clock.append(this.clockCap, this.clockVal);
    const dinos = stat('dinos', 'Dinosaurs');
    const casualties = stat('casualties', 'Casualties');
    const pause = button('pause-btn');
    pause.setAttribute('aria-label', 'Pause');
    pause.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="4" width="3.5" height="12" rx="1"/><rect x="11.5" y="4" width="3.5" height="12" rx="1"/></svg>';
    pause.addEventListener('click', () => this.handlers?.openMenu());
    this.topBar.append(money.box, revenue.box, this.clock, dinos.box, casualties.box, pause);
    this.moneyVal = money.val;
    this.revenueVal = revenue.val;
    this.revenueCap = revenue.cap;
    this.revenueStat = revenue.box;
    this.dinoVal = dinos.val;
    this.casualtyVal = casualties.val;
    this.casualtyStat = casualties.box;

    // ------------------------------------------------ bottom bar
    this.bottomBar = el('div', 'bottombar');
    this.buildGroup = el('div', 'build-group');
    for (const kind of BUILD_KINDS) {
      const tower = kind === 'tower';
      const b = button(tower ? 'build-btn tower' : 'build-btn');
      b.dataset.kind = kind;
      b.setAttribute('aria-pressed', 'false');
      const swatch = el('span', 'swatch');
      swatch.style.background = hex(tower ? COLORS.grass : COLORS.interior[kind]);
      swatch.innerHTML = tower ? unitIcon('tower') : animalIcon(EXHIBITS[kind].animal);
      const label = el('span', 'label');
      const meta = el('span', 'meta');
      // "· 3 left" drops out on narrow screens; the price stays.
      const price = el('span', 'cost');
      const left = el('span', 'left');
      meta.append(price, left);
      label.append(el('span', 'name', tower ? 'Tower' : EXHIBITS[kind].short), meta);
      b.setAttribute('aria-label', tower ? UNITS.tower.name : EXHIBITS[kind].name);
      b.append(swatch, label);
      b.addEventListener('click', () => this.handlers?.selectBuild(kind));
      this.buildButtons.set(kind, b);
      this.buildMeta.set(kind, { price, left });
      this.buildGroup.append(b);
    }
    const troopGroup = el('div', 'troop-group');
    const hqBtn = button('hq-btn');
    const hqLabel = el('span', 'label');
    this.hqMeta = el('span', 'meta', 'Queue 0/5');
    hqLabel.append(el('span', 'name', 'Train'), this.hqMeta);
    hqBtn.setAttribute('aria-label', 'Train troops at HQ');
    hqBtn.append(el('span', 'hq-icon', 'HQ'), hqLabel);
    hqBtn.addEventListener('click', () => this.handlers?.openTraining());
    this.selSummary = el('span', 'sel-summary');
    this.selectAllBtn = button('sel-btn sel-all');
    this.selectAllBtn.addEventListener('click', () => this.handlers?.selectAll());
    this.clearBtn = button('sel-btn sel-clear');
    this.clearBtn.addEventListener('click', () => this.handlers?.clearSelection());
    troopGroup.append(hqBtn, this.selSummary, this.selectAllBtn, this.clearBtn);
    this.bottomBar.append(this.buildGroup, troopGroup);

    // ------------------------------------------------ placement panel
    this.placePanel = el('div', 'panel place-panel hidden');
    this.placeTitle = el('div', 'panel-title');
    this.placeLines = el('div', 'lines');
    this.placeReason = el('div', 'reason');
    const placeActions = el('div', 'actions');
    this.confirmBtn = button('primary');
    this.confirmBtn.addEventListener('click', () => this.handlers?.confirmPlacement());
    const cancel = button('secondary', 'Cancel');
    cancel.addEventListener('click', () => this.handlers?.cancelPlacement());
    placeActions.append(this.confirmBtn, cancel);
    this.placePanel.append(this.placeTitle, this.placeLines, this.placeReason, placeActions);

    // ------------------------------------------------ training panel
    this.trainPanel = el('div', 'panel train-panel hidden');
    this.trainPanel.append(this.panelHead('Containment HQ'));
    for (const kind of UNIT_KINDS) {
      const cfg = UNITS[kind];
      const b = button('train-btn');
      b.dataset.kind = kind;
      const icon = el('span', 'unit-icon');
      icon.innerHTML = unitIcon(kind);
      const label = el('span', 'label');
      label.append(
        el('span', 'name', cfg.name),
        el('span', 'meta', `Sedates ${Math.round(sedationPerSecond(kind))}/s · ${cfg.hp}\u00a0HP`),
      );
      b.append(icon, label, el('span', 'price', formatMoney(cfg.cost)));
      b.addEventListener('click', () => this.handlers?.train(kind));
      this.trainButtons.set(kind, b);
      this.trainPanel.append(b);
    }
    const queue = el('div', 'queue');
    this.queueLabel = el('span', 'queue-label');
    this.queueChips = el('div', 'chips');
    queue.append(this.queueLabel, this.queueChips);
    this.teamNote = el('div', 'team-note');
    this.trainPanel.append(queue, this.teamNote, el('div', 'note', 'Tap a queued troop to cancel it for a full refund.'));

    // ------------------------------------------------ exhibit panel
    this.exhibitPanel = el('div', 'panel exhibit-panel hidden');
    const exHead = this.panelHead('');
    this.exTitle = exHead.querySelector('.panel-title') as HTMLElement;
    const rows = el('div', 'lines');
    const row = (label: string) => {
      const r = el('div', 'line');
      const v = el('span', 'value');
      r.append(el('span', '', label), v);
      rows.append(r);
      return v;
    };
    this.exVisits = row('Visits');
    this.exRevenue = row('Revenue');
    this.exFence = row('Fence');
    this.exAnimals = row('Animals');
    this.exBreakout = row('Breaks out');
    this.reinforceBtn = button('primary reinforce');
    this.reinforceBtn.addEventListener('click', () => this.handlers?.reinforce(this.exhibitId));
    this.reinforceNote = el('div', 'note');
    this.exhibitPanel.append(exHead, rows, this.reinforceBtn, this.reinforceNote);

    // ------------------------------------------------ banner, toast
    this.banner = el('div', 'banner');
    this.toastEl = el('div', 'toast');

    // ------------------------------------------------ tip
    this.tipCard = el('div', 'tip hidden');
    this.tipCard.setAttribute('role', 'dialog');
    this.tipTitle = el('div', 'tip-title');
    this.tipBody = el('p', 'tip-body');
    const tipActions = el('div', 'actions');
    const gotIt = button('primary tip-ok', 'Got it');
    gotIt.addEventListener('click', () => this.handlers?.tipDone());
    const off = button('secondary tip-off', 'Hide tips');
    off.addEventListener('click', () => this.handlers?.tipsOff());
    tipActions.append(gotIt, off);
    this.tipCard.append(el('div', 'tip-eyebrow', 'Tip · game paused'), this.tipTitle, this.tipBody, tipActions);

    // ------------------------------------------------ briefing
    this.briefing = el('div', 'overlay briefing hidden');
    const card = el('div', 'card brief-card');
    const left = el('div', 'brief-main');
    this.briefTitle = el('h1', 'brief-title');
    this.briefIntro = el('p', 'brief-intro');
    const options = el('div', 'options');
    const check = (id: string, text: string) => {
      const label = el('label', 'check');
      const input = el('input');
      input.type = 'checkbox';
      input.id = id;
      label.append(input, el('span', '', text));
      options.append(label);
      return input;
    };
    this.quickBox = check('opt-quick', 'Quick test');
    this.quickLabel = this.quickBox.nextElementSibling as HTMLElement;
    this.tipsBox = check('opt-tips', 'Show tips');
    this.debugBox = check('opt-debug', 'Debug tools');
    this.quickBox.addEventListener('change', () => this.renderBriefing());
    const start = button('primary start', 'Start');
    start.addEventListener('click', () =>
      this.handlers?.start({ quick: this.quickBox.checked, debug: this.debugBox.checked, tips: this.tipsBox.checked }),
    );
    left.append(el('div', 'eyebrow', 'Park Blackout'), this.briefTitle, this.briefIntro, options, start);

    const right = el('div', 'brief-side');
    const goals = el('ul', 'goals');
    const goal = (stars: string, text: string) => {
      const li = el('li');
      const t = el('span', 'goal-text', text);
      li.append(el('span', 'goal-stars', stars), t);
      goals.append(li);
      return t;
    };
    goal('★', 'Secure every loose dinosaur after the power comes back.');
    this.briefGoal2 = goal('★★', 'Also earn $40,000 before the blackout.');
    goal('★★★', 'Also keep every visitor alive.');
    const howto = el('ul', 'howto');
    for (const line of [
      'Tap an exhibit or a tower below, then tap the map to place it.',
      'Tap HQ to train troops. Towers guard a spot on their own.',
      'Tap a troop, then tap the map to move or a dinosaur to attack.',
      'Hold, then drag, to select a group.',
      'Drag to pan. Pinch to zoom.',
    ]) {
      howto.append(el('li', '', line));
    }
    right.append(el('h2', '', 'Goals'), goals, el('h2', '', 'Controls'), howto);
    card.append(left, right);
    this.briefing.append(card);

    // ------------------------------------------------ end screen
    this.endScreen = el('div', 'overlay end hidden');
    const endCard = el('div', 'card end-card');
    this.endBody = el('div', 'end-body');
    const retry = button('primary retry', 'Retry');
    retry.addEventListener('click', () => this.handlers?.retry());
    // The end screen can be taller than a phone: its body scrolls, and Retry stays in view below it.
    const foot = el('div', 'end-foot');
    foot.append(retry);
    endCard.append(this.endBody, foot);
    this.endScreen.append(endCard);

    // ------------------------------------------------ pause menu
    this.menu = el('div', 'overlay menu hidden');
    const menuCard = el('div', 'card menu-card');
    menuCard.setAttribute('role', 'dialog');
    const resume = button('primary menu-resume', 'Resume');
    resume.addEventListener('click', () => this.handlers?.resume());
    const restart = button('secondary menu-restart', 'Restart');
    restart.addEventListener('click', () => this.handlers?.retry());
    const endGame = button('secondary menu-end', 'End game');
    endGame.addEventListener('click', () => this.handlers?.endGame());
    const menuActions = el('div', 'menu-actions');
    menuActions.append(resume, restart, endGame);
    menuCard.append(
      el('div', 'eyebrow', 'Paused'),
      el('p', 'menu-text', 'Restart goes back to the briefing. End game shows what happened so far.'),
      menuActions,
    );
    this.menu.append(menuCard);

    // ------------------------------------------------ edge arrows
    this.arrowLayer = el('div', 'arrows');

    // ------------------------------------------------ debug
    this.debugPanel = el('div', 'debug hidden');
    const dbgHead = button('dbg-head', 'Debug');
    dbgHead.addEventListener('click', () => this.debugPanel.classList.toggle('collapsed'));
    const speedRow = el('div', 'dbg-row');
    speedRow.append(el('span', 'dbg-label', 'Speed'));
    for (const s of [1, 2, 4]) {
      const b = button('dbg-btn', `${s}x`);
      b.dataset.speed = String(s);
      b.addEventListener('click', () => this.handlers?.debugSpeed(s));
      this.speedButtons.push(b);
      speedRow.append(b);
    }
    const actionRow = el('div', 'dbg-row');
    const blackout = button('dbg-btn', 'Blackout now');
    blackout.addEventListener('click', () => this.handlers?.debugBlackout());
    const cash = button('dbg-btn', '+$10,000');
    cash.addEventListener('click', () => this.handlers?.debugMoney());
    actionRow.append(blackout, cash);
    const toggleRow = el('div', 'dbg-row');
    for (const [name, text] of [
      ['hp', 'Fence HP'],
      ['grid', 'Grid'],
      ['fps', 'FPS'],
    ] as const) {
      const label = el('label', 'dbg-check');
      const input = el('input');
      input.type = 'checkbox';
      input.id = `dbg-${name}`;
      input.addEventListener('change', () => this.handlers?.debugToggle(name, input.checked));
      label.append(input, el('span', '', text));
      toggleRow.append(label);
    }
    this.fpsEl = el('div', 'dbg-fps hidden');
    this.debugPanel.append(dbgHead, speedRow, actionRow, toggleRow, this.fpsEl);

    root.append(
      this.arrowLayer,
      this.topBar,
      this.bottomBar,
      this.placePanel,
      this.trainPanel,
      this.exhibitPanel,
      this.banner,
      this.toastEl,
      this.tipCard,
      this.debugPanel,
      this.briefing,
      this.endScreen,
      this.menu,
    );
  }

  private panelHead(title: string): HTMLElement {
    const head = el('div', 'panel-head');
    const close = button('close', '✕');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.handlers?.closePanel());
    head.append(el('span', 'panel-title', title), close);
    return head;
  }

  /** Heights (CSS px) of the bars covering the top and bottom of the screen. */
  get insets(): { top: number; bottom: number } {
    return {
      top: this.topBar.getBoundingClientRect().height,
      bottom: this.bottomBar.getBoundingClientRect().height,
    };
  }

  get panel(): Panel | null {
    return this.openPanel;
  }

  reset(): void {
    this.closePanels();
    this.hideTip();
    this.hideMenu();
    this.setArrows([]);
    this.endScreen.classList.add('hidden');
    this.banner.classList.remove('show');
    this.toastEl.classList.remove('show');
    this.queueKey = '';
  }

  // ------------------------------------------------ bars

  setTop(v: TopView): void {
    setText(this.moneyVal, formatMoney(v.money));
    // Guests keep paying in the dark. Once the park evacuates, this slot shows who is still inside.
    this.revenueStat.classList.toggle('people', v.evacuating);
    if (v.evacuating) {
      setText(this.revenueCap, 'Visitors in park');
      setText(this.revenueVal, v.inPark ? String(v.inPark) : 'Everyone is out');
    } else {
      setText(this.revenueCap, `Revenue · ★★ at ${formatMoney(v.revenueTarget)}`);
      setText(this.revenueVal, formatMoney(v.revenue));
    }
    const pct = Math.min(100, (v.revenue / Math.max(1, v.revenueTarget)) * 100);
    const width = `${pct.toFixed(1)}%`;
    if (this.revenueMeter.style.width !== width) this.revenueMeter.style.width = width;
    this.revenueStat.classList.toggle('met', v.revenue >= v.revenueTarget);

    const caption =
      v.phase === 'blackout'
        ? v.allClear
          ? 'All clear · power in'
          : 'Power returns in'
        : v.phase === 'restored'
          ? 'Secure them within'
          : v.phase === 'ended'
            ? 'Game over'
            : 'Until blackout';
    setText(this.clockCap, caption);
    setText(this.clockVal, v.phase === 'ended' ? '' : formatClock(v.clockSeconds));
    this.clock.classList.toggle('danger', v.phase === 'blackout' || v.phase === 'restored');
    this.clock.classList.toggle('urgent', v.phase === 'build' && v.clockSeconds <= 60);

    let dinos: string;
    if (v.phase === 'briefing' || v.phase === 'build') dinos = v.penned ? `${v.penned} penned` : 'None yet';
    else if (v.loose) dinos = `${v.loose} loose · ${v.secured} secured`;
    else if (v.phase === 'blackout' && v.penned) dinos = `None loose · ${v.penned} penned`;
    else dinos = v.secured ? `None loose · ${v.secured} secured` : 'None loose';
    setText(this.dinoVal, dinos);

    setText(this.casualtyVal, `${v.casualties} / ${v.casualtyLimit}`);
    this.casualtyStat.classList.toggle('bad', v.casualties > 0);
  }

  setBuildBar(visible: boolean, cash: number, counts: Record<ExhibitKind, number>, placing: BuildKind | null): void {
    this.buildGroup.classList.toggle('hidden', !visible);
    if (!visible) return;
    for (const kind of BUILD_KINDS) {
      const b = this.buildButtons.get(kind)!;
      const meta = this.buildMeta.get(kind)!;
      let cost: number;
      let atLimit = false;
      if (kind === 'tower') {
        cost = UNITS.tower.cost;
        setText(meta.price, formatMoney(cost));
      } else {
        const cfg = EXHIBITS[kind];
        cost = cfg.cost;
        atLimit = cfg.maxPerLevel !== null && counts[kind] >= cfg.maxPerLevel;
        const left = cfg.maxPerLevel === null ? null : cfg.maxPerLevel - counts[kind];
        setText(meta.price, atLimit ? 'None left' : formatMoney(cost));
        setText(meta.left, atLimit || left === null ? '' : ` · ${left} left`);
      }
      const disabled = placing !== kind && (atLimit || cash < cost);
      if (b.disabled !== disabled) b.disabled = disabled;
      const pressed = placing === kind ? 'true' : 'false';
      if (b.getAttribute('aria-pressed') !== pressed) b.setAttribute('aria-pressed', pressed);
    }
  }

  setTroops(total: number, selected: number, summary: string, queued: number, wide: boolean): void {
    setText(this.hqMeta, `Queue ${queued}/${SQUAD.queueMax}`);
    setText(this.selectAllBtn, `Select all ${total}`);
    setText(this.clearBtn, selected ? `Clear ${selected}` : 'Clear');
    if (this.selectAllBtn.disabled !== (total === 0)) this.selectAllBtn.disabled = total === 0;
    if (this.clearBtn.disabled !== (selected === 0)) this.clearBtn.disabled = selected === 0;
    setText(this.selSummary, wide && selected ? summary : '');
    this.selSummary.classList.toggle('hidden', !(wide && selected));
  }

  // ------------------------------------------------ panels

  private show(panel: Panel): void {
    this.openPanel = panel;
    this.placePanel.classList.toggle('hidden', panel !== 'place');
    this.trainPanel.classList.toggle('hidden', panel !== 'train');
    this.exhibitPanel.classList.toggle('hidden', panel !== 'exhibit');
  }

  closePanels(): void {
    this.openPanel = null;
    this.placePanel.classList.add('hidden');
    this.trainPanel.classList.add('hidden');
    this.exhibitPanel.classList.add('hidden');
  }

  showPlacement(v: PlaceView): void {
    setText(this.placeTitle, v.title);
    this.placeLines.innerHTML = '';
    for (const [label, value] of v.lines) {
      const r = el('div', 'line');
      r.append(el('span', '', label), el('span', 'value', value));
      this.placeLines.append(r);
    }
    setText(this.placeReason, v.reason ?? '');
    this.placeReason.classList.toggle('hidden', v.reason === null);
    setText(this.confirmBtn, `Build ${formatMoney(v.cost)}`);
    this.confirmBtn.disabled = !v.valid;
    this.show('place');
  }

  showTraining(v: TrainingView): void {
    this.queueKey = '';
    this.updateTraining(v);
    this.show('train');
  }

  updateTraining(v: TrainingView): void {
    for (const kind of UNIT_KINDS) {
      const b = this.trainButtons.get(kind)!;
      const disabled = !v.canTrain || v.queue.length >= SQUAD.queueMax || v.money < UNITS[kind].cost;
      if (b.disabled !== disabled) b.disabled = disabled;
    }
    setText(this.queueLabel, v.queue.length ? `Queue ${v.queue.length}/${SQUAD.queueMax}` : 'Queue empty');
    const t = v.team;
    setText(
      this.teamNote,
      t.troops
        ? `Your ${t.troops} ${t.troops === 1 ? 'troop' : 'troops'}, darting together: a T. rex in ${Math.ceil(t.trexSeconds)} s, a pack of ${t.packSize} raptors in ${Math.ceil(t.packSeconds)} s.`
        : `No troops yet. A T. rex takes ${DINOS.trex.sedation} sedation, a raptor ${DINOS.raptor.sedation}.`,
    );
    const key = v.queue.map((q) => q.id).join(',');
    if (key !== this.queueKey) {
      this.queueKey = key;
      this.queueChips.innerHTML = '';
      for (const q of v.queue) {
        const chip = button('chip');
        chip.dataset.id = String(q.id);
        chip.setAttribute('aria-label', `Cancel ${UNITS[q.kind].name}`);
        const icon = el('span', 'unit-icon');
        icon.innerHTML = unitIcon(q.kind);
        chip.append(icon, el('span', 'chip-bar'));
        chip.addEventListener('click', () => this.handlers?.cancelQueued(q.id));
        this.queueChips.append(chip);
      }
    }
    v.queue.forEach((q, i) => {
      const bar = this.queueChips.children[i]?.querySelector('.chip-bar') as HTMLElement | null;
      if (bar) bar.style.setProperty('--p', `${Math.round(q.progress * 100)}%`);
    });
  }

  showExhibit(v: ExhibitView): void {
    this.updateExhibit(v);
    this.show('exhibit');
  }

  updateExhibit(v: ExhibitView): void {
    this.exhibitId = v.id;
    setText(this.exTitle, v.name);
    setText(this.exVisits, String(v.visits));
    setText(this.exRevenue, formatMoney(v.revenue));
    setText(this.exFence, v.fence);
    setText(this.exAnimals, v.animals);
    const row = this.exBreakout.parentElement!;
    row.classList.toggle('hidden', !v.breakout);
    if (v.breakout) setText(this.exBreakout, afterBlackout(v.breakout.now));
    const canReinforce = v.reinforceCost !== null;
    this.reinforceBtn.classList.toggle('hidden', !canReinforce);
    if (canReinforce) {
      setText(this.reinforceBtn, `Reinforce fence ${formatMoney(v.reinforceCost!)}`);
      const disabled = v.money < v.reinforceCost!;
      if (this.reinforceBtn.disabled !== disabled) this.reinforceBtn.disabled = disabled;
    }
    const holds = canReinforce && v.breakout?.concrete != null ? ` It holds them in until about ${Math.round(v.breakout.concrete)} s.` : '';
    setText(
      this.reinforceNote,
      v.reinforced
        ? `Concrete fence: ${FENCE.concreteHp} HP per segment.`
        : canReinforce
          ? `Concrete: ${FENCE.concreteHp} HP per segment instead of ${FENCE.chainLinkHp}.${holds}`
          : 'Fences can only be reinforced before the blackout.',
    );
  }

  get shownExhibit(): number {
    return this.openPanel === 'exhibit' ? this.exhibitId : 0;
  }

  /** Puts the open panel beside a screen rectangle without covering the bars. */
  anchor(target: ScreenRect): void {
    const panel = this.openPanel === 'place' ? this.placePanel : this.openPanel === 'train' ? this.trainPanel : this.openPanel === 'exhibit' ? this.exhibitPanel : null;
    if (!panel) return;
    const gap = 10;
    const margin = 8;
    const { top, bottom } = this.insets;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    let left = target.right + gap;
    if (left + pw > vw - margin) left = target.left - gap - pw;
    if (left < margin) left = Math.min(Math.max(margin, vw - pw - margin), target.right + gap);
    const y = Math.max(top + margin, Math.min(target.top, vh - bottom - ph - margin));
    const t = `translate(${Math.round(left)}px, ${Math.round(y)}px)`;
    if (panel.style.transform !== t) panel.style.transform = t;
  }

  // ------------------------------------------------ messages

  showBanner(text: string, tone: 'warn' | 'danger' | 'good' | 'info', seconds = 3.5): void {
    this.banner.textContent = text;
    this.banner.dataset.tone = tone;
    this.banner.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), seconds * 1000);
  }

  /** Where the banner is while it shows, so edge arrows can step around it. */
  get bannerBox(): DOMRect | null {
    return this.banner.classList.contains('show') ? this.banner.getBoundingClientRect() : null;
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2000);
  }

  // ------------------------------------------------ tips

  showTip(title: string, body: string): void {
    setText(this.tipTitle, title);
    setText(this.tipBody, body);
    this.toastEl.classList.remove('show');
    this.tipCard.classList.remove('hidden');
  }

  hideTip(): void {
    this.tipCard.classList.add('hidden');
  }

  get tipOpen(): boolean {
    return !this.tipCard.classList.contains('hidden');
  }

  /** Top edge of the open tip card, in CSS pixels. */
  get tipTop(): number {
    return this.tipCard.getBoundingClientRect().top;
  }

  // ------------------------------------------------ pause menu

  showMenu(): void {
    this.toastEl.classList.remove('show');
    this.menu.classList.remove('hidden');
  }

  hideMenu(): void {
    this.menu.classList.add('hidden');
  }

  get menuOpen(): boolean {
    return !this.menu.classList.contains('hidden');
  }

  // ------------------------------------------------ edge arrows

  /** Arrows at the map edge. Elements are reused, and the DOM is only touched when something changed. */
  setArrows(list: readonly ArrowView[]): void {
    while (this.arrows.length < list.length) {
      const b = button('edge-arrow hidden');
      const pointer = el('span', 'pointer');
      const icon = el('span', 'arrow-icon');
      const count = el('span', 'arrow-count');
      b.append(pointer, icon, count);
      b.addEventListener('click', () => {
        const key = b.dataset.key;
        if (key) this.handlers?.focusArrow(key);
      });
      this.arrowLayer.append(b);
      this.arrows.push({ el: b, pointer, icon, count, kind: '', transform: '', rotate: '' });
    }
    this.arrows.forEach((a, i) => {
      const v = list[i];
      const hidden = !v;
      if (a.el.classList.contains('hidden') !== hidden) a.el.classList.toggle('hidden', hidden);
      if (!v) return;
      if (a.el.dataset.key !== v.key) a.el.dataset.key = v.key;
      if (a.kind !== v.kind) {
        a.kind = v.kind;
        a.el.dataset.kind = v.kind;
        a.icon.innerHTML = v.kind === 'breach' ? '!' : animalIcon(v.kind);
        a.el.setAttribute('aria-label', v.kind === 'breach' ? 'Broken fence off screen' : `${DINOS[v.kind].name} off screen`);
      }
      setText(a.count, v.count > 1 ? String(v.count) : '');
      const transform = `translate(${Math.round(v.x)}px, ${Math.round(v.y)}px)`;
      if (a.transform !== transform) {
        a.transform = transform;
        a.el.style.transform = transform;
      }
      const rotate = `rotate(${v.angle.toFixed(2)}rad)`;
      if (a.rotate !== rotate) {
        a.rotate = rotate;
        a.pointer.style.transform = rotate;
      }
    });
  }

  // ------------------------------------------------ briefing

  showBriefing(v: BriefingView): void {
    this.briefView = v;
    this.quickBox.checked = v.quick;
    this.debugBox.checked = v.debug;
    this.tipsBox.checked = v.tips;
    this.renderBriefing();
    this.briefing.classList.remove('hidden');
  }

  private renderBriefing(): void {
    const v = this.briefView;
    if (!v) return;
    const seconds = this.quickBox.checked ? v.quickSeconds : v.buildSeconds;
    const target = Math.round((v.revenueTarget * seconds) / v.buildSeconds);
    setText(this.quickLabel, `Quick test: ${formatClock(v.quickSeconds)} build phase`);
    setText(this.briefTitle, `Lights out in ${formatClock(seconds)}`);
    setText(
      this.briefIntro,
      `${v.villain} will cut power to the electric fences in ${formatClock(seconds)} to steal dinosaur embryos. Build your park, earn money, and train your containment team before the lights go out.`,
    );
    setText(this.briefGoal2, `Also earn ${formatMoney(target)} before the blackout.`);
  }

  hideBriefing(): void {
    this.briefing.classList.add('hidden');
  }

  get briefingOpen(): boolean {
    return !this.briefing.classList.contains('hidden');
  }

  // ------------------------------------------------ end screen

  showEnd(r: Result): void {
    const b = this.endBody;
    b.innerHTML = '';
    const stars = el('div', 'stars');
    stars.setAttribute('aria-label', `${r.stars} of 3 stars`);
    for (let i = 0; i < 3; i++) stars.append(el('span', i < r.stars ? 'star on' : 'star', i < r.stars ? '★' : '☆'));
    const head = el('div', `end-head ${r.won ? 'won' : 'lost'}`);
    head.append(stars, el('h1', '', r.title), el('p', 'detail', r.detail));
    const parts: HTMLElement[] = [head];

    const advice = nextTime(r);
    if (advice) {
      const box = el('div', 'next-time');
      box.append(el('span', 'next-label', 'Next time'), el('p', '', advice));
      parts.push(box);
    }
    const lines = timelineLines(r.log);
    if (lines.length) {
      const s = el('section', 'timeline');
      s.append(el('h2', '', 'What happened'));
      const list = el('div', 'tl-rows');
      for (const l of lines) {
        const row = el('div', `tl-row ${l.tone}`);
        row.append(el('span', 'tl-time', l.time), el('span', 'tl-text', l.text));
        list.append(row);
      }
      s.append(list);
      parts.push(s);
    }

    const section = (title: string, rows: [string, string][], foot?: [string, string]) => {
      const s = el('section');
      s.append(el('h2', '', title));
      const list = el('div', 'rows');
      for (const [k, v] of rows) {
        const r = el('div', 'line');
        r.append(el('span', '', k), el('span', 'value', v));
        list.append(r);
      }
      if (foot) {
        const r = el('div', 'line total');
        r.append(el('span', '', foot[0]), el('span', 'value', foot[1]));
        list.append(r);
      }
      s.append(list);
      return s;
    };

    const revenueRows: [string, string][] = r.exhibits.length
      ? r.exhibits.map((e) => [`${e.name} · ${e.visits} visits`, formatMoney(e.revenue)])
      : [['No exhibits built', '$0']];
    const hit = r.revenue >= r.revenueTarget;
    const s = r.spending;
    // The first animal out is what started the evacuation.
    const firstOut: Record<AnimalKind, string> = { raptor: 'Raptors', trex: 'T. rex', triceratops: 'Triceratops' };
    const blackoutRows: [string, string][] = [
      ['In the park at blackout', String(r.visitorsAtBlackout)],
      ['Earned in the dark', formatMoney(r.blackoutRevenue)],
      ['First animal out', r.evacuatedBy ? firstOut[r.evacuatedBy] : 'None'],
      ['Got out safely', String(r.visitorsSafe)],
      ['Killed by raptors', String(r.casualties.raptor)],
      ['Killed by the T. rex', String(r.casualties.trex)],
      ['Trampled', String(r.casualties.stampede)],
      ['Troops lost', `${r.troopsLost} of ${r.troopsTrained}`],
    ];
    if (r.towersBuilt) blackoutRows.push(['Towers lost', `${r.towersLost} of ${r.towersBuilt}`]);
    blackoutRows.push(['Dinosaurs secured', String(r.dinosSecured)], ['Dinosaurs contained', String(r.dinosContained)]);
    const grid = el('div', 'end-grid');
    grid.append(
      section('Revenue', revenueRows, [`Total (★★ at ${formatMoney(r.revenueTarget)})${hit ? ' ✓' : ''}`, formatMoney(r.revenue)]),
      section(
        'Spending',
        [
          ['Exhibits', formatMoney(s.exhibits)],
          ['Paths', formatMoney(s.paths)],
          ['Reinforcement', formatMoney(s.reinforcement)],
          ['Troops', formatMoney(s.troops)],
          ['Towers', formatMoney(s.towers)],
        ],
        ['Total', formatMoney(s.total)],
      ),
      section('Blackout', blackoutRows, ['Visitors killed', String(r.casualtyTotal)]),
    );
    b.append(...parts, grid);
    this.endScreen.classList.remove('hidden');
    this.endBody.scrollTop = 0;
  }

  // ------------------------------------------------ debug

  showDebug(on: boolean): void {
    const wasHidden = this.debugPanel.classList.contains('hidden');
    this.debugPanel.classList.toggle('hidden', !on);
    // Start folded on phones so it doesn't cover the map.
    if (on && wasHidden && window.innerHeight < 500) this.debugPanel.classList.add('collapsed');
  }

  setDebugSpeed(speed: number): void {
    for (const b of this.speedButtons) b.setAttribute('aria-pressed', b.dataset.speed === String(speed) ? 'true' : 'false');
  }

  setFps(fps: number | null): void {
    this.fpsEl.classList.toggle('hidden', fps === null);
    if (fps !== null) setText(this.fpsEl, `${Math.round(fps)} fps`);
  }
}
