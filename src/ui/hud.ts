import { COLORS, EXHIBITS, EXHIBIT_KINDS, type AnimalKind, type ExhibitKind } from '../config';
import type { PlacementPlan } from '../core/placement';

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

function animalIcon(kind: AnimalKind): string {
  const fill = hex(COLORS.animal[kind]);
  switch (kind) {
    case 'triceratops':
      return `<svg viewBox="0 0 26 26" aria-hidden="true"><ellipse cx="13" cy="13" rx="9.5" ry="6" fill="${fill}" stroke="#0b2a12" stroke-width="1.5"/></svg>`;
    case 'raptor':
      return `<svg viewBox="0 0 26 26" aria-hidden="true"><polygon points="6,6.5 21,13 6,19.5" fill="${fill}" stroke="#4a2500" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
    case 'trex':
      return `<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="${fill}" stroke="#3a0a0a" stroke-width="1.5"/><rect x="17.5" y="11" width="6" height="4" rx="1" fill="${hex(COLORS.trexNotch)}"/></svg>`;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The HTML layer over the game canvas: top bar, build bar, placement panel, toasts. */
export class Hud {
  onSelectExhibit: (kind: ExhibitKind) => void = () => {};
  onConfirm: () => void = () => {};
  onCancel: () => void = () => {};

  private readonly topBar: HTMLElement;
  private readonly bottomBar: HTMLElement;
  private readonly moneyEl: HTMLElement;
  private readonly centerEl: HTMLElement;
  private readonly buttons = new Map<ExhibitKind, HTMLButtonElement>();
  private readonly metaEls = new Map<ExhibitKind, HTMLElement>();
  private readonly panel: HTMLElement;
  private readonly panelTitle: HTMLElement;
  private readonly panelLines: HTMLElement;
  private readonly panelReason: HTMLElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly toastEl: HTMLElement;
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    this.topBar = el('div', 'topbar');
    this.moneyEl = el('div', 'money', '$0');
    this.centerEl = el('div', 'center', 'Build your park');
    const phase = el('div', 'phase', 'Build phase');
    this.topBar.append(this.moneyEl, this.centerEl, phase);

    this.bottomBar = el('div', 'bottombar');
    for (const kind of EXHIBIT_KINDS) {
      const cfg = EXHIBITS[kind];
      const btn = el('button', 'build-btn');
      btn.type = 'button';
      btn.dataset.kind = kind;
      btn.setAttribute('aria-pressed', 'false');
      const swatch = el('span', 'swatch');
      swatch.style.background = hex(COLORS.interior[kind]);
      swatch.innerHTML = animalIcon(cfg.animal);
      const label = el('span', 'label');
      const meta = el('span', 'meta');
      label.append(el('span', 'name', cfg.name), meta);
      btn.append(swatch, label);
      btn.addEventListener('click', () => this.onSelectExhibit(kind));
      this.buttons.set(kind, btn);
      this.metaEls.set(kind, meta);
      this.bottomBar.append(btn);
    }

    this.panel = el('div', 'place-panel hidden');
    this.panelTitle = el('div', 'place-title');
    this.panelLines = el('div', 'place-lines');
    this.panelReason = el('div', 'place-reason');
    const actions = el('div', 'place-actions');
    this.confirmBtn = el('button', 'confirm');
    this.confirmBtn.type = 'button';
    this.confirmBtn.addEventListener('click', () => this.onConfirm());
    const cancel = el('button', 'cancel', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.onCancel());
    actions.append(this.confirmBtn, cancel);
    this.panel.append(this.panelTitle, this.panelLines, this.panelReason, actions);

    this.toastEl = el('div', 'toast');
    root.append(this.topBar, this.bottomBar, this.panel, this.toastEl);
  }

  /** Heights (CSS px) of the bars covering the top and bottom of the screen. */
  get insets(): { top: number; bottom: number } {
    return {
      top: this.topBar.getBoundingClientRect().height,
      bottom: this.bottomBar.getBoundingClientRect().height,
    };
  }

  setMoney(amount: number): void {
    this.moneyEl.textContent = money(amount);
  }

  setHint(text: string | null): void {
    this.centerEl.textContent = text ?? 'Build your park';
    this.centerEl.classList.toggle('hinting', text !== null);
  }

  updateBuildButtons(cash: number, counts: Record<ExhibitKind, number>, placing: ExhibitKind | null): void {
    for (const kind of EXHIBIT_KINDS) {
      const cfg = EXHIBITS[kind];
      const btn = this.buttons.get(kind)!;
      const meta = this.metaEls.get(kind)!;
      const atLimit = cfg.maxPerLevel !== null && counts[kind] >= cfg.maxPerLevel;
      const left = cfg.maxPerLevel === null ? null : cfg.maxPerLevel - counts[kind];
      meta.textContent = atLimit ? 'Limit reached' : left === null ? money(cfg.cost) : `${money(cfg.cost)} · ${left} left`;
      btn.disabled = placing !== kind && (atLimit || cash < cfg.cost);
      btn.setAttribute('aria-pressed', placing === kind ? 'true' : 'false');
    }
  }

  showPlacement(plan: PlacementPlan): void {
    const cfg = EXHIBITS[plan.kind];
    this.panelTitle.textContent = cfg.name;
    const tiles = plan.newPathTiles.length;
    this.panelLines.innerHTML = '';
    const line = (label: string, value: string) => {
      const row = el('div', 'place-line');
      row.append(el('span', '', label), el('span', 'value', value));
      this.panelLines.append(row);
    };
    line('Exhibit', money(plan.exhibitCost));
    // The path is only known once the footprint fits and a route exists.
    if (plan.viewingSpot) line(tiles === 1 ? 'Path (1 tile)' : `Path (${tiles} tiles)`, money(plan.pathCost));
    line('Earns per visit', money(cfg.pricePerVisit));
    this.panelReason.textContent = plan.reason ?? '';
    this.panelReason.classList.toggle('hidden', plan.reason === null);
    this.confirmBtn.textContent = `Build ${money(plan.totalCost)}`;
    this.confirmBtn.disabled = !plan.valid;
    this.panel.classList.remove('hidden');
  }

  hidePlacement(): void {
    this.panel.classList.add('hidden');
  }

  /** Puts the panel beside the ghost footprint without covering the bars. */
  positionPlacement(ghost: ScreenRect): void {
    if (this.panel.classList.contains('hidden')) return;
    const gap = 10;
    const margin = 8;
    const { top, bottom } = this.insets;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = this.panel.offsetWidth;
    const ph = this.panel.offsetHeight;

    let left = ghost.right + gap;
    if (left + pw > vw - margin) left = ghost.left - gap - pw;
    if (left < margin) left = Math.min(Math.max(margin, vw - pw - margin), ghost.right + gap);
    let y = ghost.top;
    y = Math.max(top + margin, Math.min(y, vh - bottom - ph - margin));
    this.panel.style.transform = `translate(${Math.round(left)}px, ${Math.round(y)}px)`;
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }
}
