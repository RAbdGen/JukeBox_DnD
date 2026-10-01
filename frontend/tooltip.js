/**
 * Tooltips thémés (#38) à la place des title natifs (bulle système grise,
 * lente, qui ignore le thème). Un seul élément #app-tooltip pour toute
 * l'app, piloté par délégation d'événements sur document : tout élément
 * portant data-tooltip en profite, y compris ceux créés plus tard.
 * Logique pure (placement, minuterie) dans tooltipPosition.js.
 */
import { createTooltipTimer, isIconOnly, placeTooltip } from './tooltipPosition.js';

const TOOLTIP_ID = 'app-tooltip';

let tip = null;
let tipText = null;
let tipArrow = null;
let active = null;   // élément survolé/focalisé (bulle affichée ou en attente)
let shown = null;    // élément dont la bulle est affichée
let previousDescribedBy = null;
const timer = createTooltipTimer();

/**
 * Pose (ou change) le tooltip d'un élément. Un élément sans libellé visible
 * (⏮, ✕, ✂…) reçoit aussi aria-label : sans title, il n'aurait plus de nom
 * accessible.
 */
export function setTooltip(element, text) {
    element.dataset.tooltip = text;
    if (isIconOnly(element.textContent)) element.setAttribute('aria-label', text);
    if (shown === element) tipText.textContent = text;
}

function show(element) {
    const text = element.dataset.tooltip;
    if (!text || !element.isConnected) return;

    // Une modal ouverte par showModal() passe au-dessus de tout et rend le reste
    // inerte (#41) : la bulle doit vivre dans la modal pour y être visible
    const host = element.closest('dialog[open]') ?? document.body;
    if (tip.parentNode !== host) host.append(tip);

    tipText.textContent = text;
    tip.hidden = false;
    const { width, height } = tip.getBoundingClientRect();
    const place = placeTooltip({
        trigger: element.getBoundingClientRect(),
        tip: { width, height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    tip.dataset.side = place.side;
    tip.style.left = `${place.left}px`;
    tip.style.top = `${place.top}px`;
    tipArrow.style.left = `${place.arrowLeft}px`;

    // Ne pas écraser une description déjà présente : on la rend à la fermeture
    previousDescribedBy = element.getAttribute('aria-describedby');
    element.setAttribute('aria-describedby', previousDescribedBy ? `${previousDescribedBy} ${TOOLTIP_ID}` : TOOLTIP_ID);
    shown = element;
}

function hide() {
    if (!shown) return;
    if (previousDescribedBy) shown.setAttribute('aria-describedby', previousDescribedBy);
    else shown.removeAttribute('aria-describedby');
    tip.hidden = true;
    shown = null;
    timer.markClosed();
}

function leave() {
    timer.cancel();
    hide();
    active = null;
}

function enter(element, { immediate = false } = {}) {
    if (element === active) return;
    leave();
    if (!element) return;
    active = element;
    timer.schedule(() => show(element), { immediate });
}

const tooltipTarget = event => event.target.closest?.('[data-tooltip]') ?? null;

export function initTooltips() {
    if (tip) return;

    tip = document.createElement('div');
    tip.id = TOOLTIP_ID;
    tip.className = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    tipText = document.createElement('span');
    tipArrow = document.createElement('span');
    tipArrow.className = 'tooltip-arrow';
    tip.append(tipText, tipArrow);
    document.body.append(tip);

    document.addEventListener('pointerover', event => enter(tooltipTarget(event)));
    document.addEventListener('pointerout', event => {
        if (active && !active.contains(event.relatedTarget)) leave();
    });
    // Au clavier seulement : un clic donne aussi le focus, sans :focus-visible
    document.addEventListener('focusin', event => {
        const element = tooltipTarget(event);
        if (element?.matches(':focus-visible')) enter(element, { immediate: true });
    });
    document.addEventListener('focusout', event => {
        if (active === event.target) leave();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && shown) leave();
    });
    document.addEventListener('pointerdown', leave, true);
    document.addEventListener('scroll', leave, true);
    window.addEventListener('resize', leave);
    window.addEventListener('blur', leave);
}
