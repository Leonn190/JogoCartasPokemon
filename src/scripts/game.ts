import { createJourneyGame, createLookup, officialTimerSeconds, validateFormation } from '../game/setup';
import {
  PILE_LABELS,
  STADIUM_CONNECTIONS,
  advanceAfterHandLimit,
  chooseInitialPokemon,
  compatibleAttack,
  currentSpeed,
  defineResolutionOrderWithCards,
  enforceHandLimit,
  finishByPoints,
  legalAttackTargets,
  lockProgrammedActions,
  lockSupporterChoice,
  manualAdjustDamage,
  manualAdjustModifier,
  manualAdjustPoints,
  manualHealDamage,
  manualLogNote,
  manualRemoveEffect,
  manualSetKnockedOut,
  manualSwitchActive,
  manualToggleResurrection,
  performFreeAcquisition,
  pokemonCard,
  pokemonDisplayName,
  programPlayerAction,
  programSupporter,
  resolveNextAction,
  resolvePendingChoice,
  revealActions,
  setPrivateVisible,
  startNextRound,
  validateInvariants,
} from '../game/engine';
import { clearGameState, exportGameState, importGameState, loadGameState, saveGameState } from '../game/persistence';
import type { CardCollection, CardData, StoredCard } from '../types/card';
import type {
  ActionSlot,
  GameState,
  PendingChoice,
  PhysicalPileId,
  PlayerId,
  PokemonInPlay,
  ProgrammedAction,
  StadiumSlotId,
  SupporterProgram,
} from '../game/types';
import { cardName } from '../game/utils';

const q = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector);
const qa = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(selector));

type CandidateTargetKind = 'none' | 'pokemon' | 'stadium' | 'pile' | 'zone-card' | 'list';
type CardSize = 'hero' | 'support' | 'bench' | 'attachment' | 'zone' | 'pile-top' | 'hand' | 'preview' | 'zoom';
type SpecialActionKind = 'none' | 'buyWildcard' | 'switchWildcard' | 'reuseAttack' | 'manual';

interface ActionCandidate {
  action: ProgrammedAction;
  label: string;
  prompt?: string;
  targetKind: CandidateTargetKind;
  targetId?: string;
}

interface PendingProgramSelection {
  playerId: PlayerId;
  slot: ActionSlot;
  sourceCardIds: string[];
  specialLabel?: string;
  prompt: string;
  presentation: 'context' | 'list';
  candidates: ActionCandidate[];
}

interface SupporterCandidate {
  choice: SupporterProgram;
  label: string;
  prompt?: string;
  targetKind: CandidateTargetKind;
  targetId?: string;
}

interface PendingSupporterSelection {
  playerId: PlayerId;
  sourceCardId?: string;
  prompt: string;
  presentation: 'context' | 'list';
  candidates: SupporterCandidate[];
}

interface SeatLayout {
  bottom: PlayerId;
  left: PlayerId;
  top: PlayerId;
  right: PlayerId;
}

interface DragState {
  cardId: string;
  playerId: PlayerId;
  pointerId: number;
  origin: HTMLElement;
  ghost: HTMLElement;
  startX: number;
  startY: number;
  moved: boolean;
  hoveredSlot: ActionSlot | null;
}

const root = q<HTMLElement>('[data-role="game-root"]')!;
const baseUrl = document.documentElement.dataset.baseUrl || '/';
const collections = JSON.parse(q<HTMLScriptElement>('#published-collections')?.textContent || '[]') as CardCollection[];

let state: GameState | null = null;
let cards: Record<string, StoredCard> = {};
let activeCollection = collections[0] ?? null;
let restoredNeedsNeutral = false;
let pendingChoiceVisibleFor: string | null = null;
let handLimitVisibleFor: PlayerId | null = null;

let selectedHandCardId: string | null = null;
let selectedSupporterCardId: string | null = null;
let previewInstanceId: string | null = null;
let zoomInstanceId: string | null = null;
let armedSlot: ActionSlot | null = null;
let pendingProgram: PendingProgramSelection | null = null;
let pendingSupporter: PendingSupporterSelection | null = null;
let logOpen = false;
let debugOpen = false;
let dragState: DragState | null = null;
let suppressClickUntil = 0;

let timerInterval: number | undefined;
let timerKey: string | null = null;
let timerDeadline = 0;

function escapeHtml(value: string | number | undefined) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function encodeAction(value: ProgrammedAction | SupporterProgram) {
  return encodeURIComponent(JSON.stringify(value));
}

function decodeValue<T>(value: string | undefined) {
  return JSON.parse(decodeURIComponent(value || '%7B%7D')) as T;
}

function appHref(path: string) {
  return `${baseUrl.replace(/\/?$/, '/')}${path.replace(/^\//, '')}`;
}

function playerById(playerId: PlayerId) {
  return state?.players.find((player) => player.id === playerId);
}

function cardForInstance(instanceId?: string) {
  if (!state || !instanceId) return undefined;
  const instance = state.instances[instanceId];
  return instance ? cards[instance.cardId] : undefined;
}

function displayCard(instanceId?: string) {
  const card = cardForInstance(instanceId);
  return card ? cardName(card.data) : 'Carta';
}

function instanceExists(instanceId?: string | null) {
  return !!(instanceId && state?.instances[instanceId]);
}

function playerName(playerId: PlayerId) {
  return playerById(playerId)?.name ?? playerId;
}

function normalizePokemonName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isLegalEvolutionUi(currentName: string, currentPokemonId: number | null, previousEvolution: string, nextForm: string, nextPokemonId: number | null) {
  return normalizePokemonName(previousEvolution) === normalizePokemonName(currentName)
    || (nextForm !== 'Normal' && nextPokemonId !== null && nextPokemonId === currentPokemonId);
}

function currentInitialPlayer() {
  return state?.initialChoice ? state.players[state.initialChoice.playerIndex] : undefined;
}

function currentPreparationPlayer() {
  return state?.privateTurn ? state.players[state.privateTurn.playerIndex] : undefined;
}

function currentConfrontationPlayer() {
  return state?.confrontation ? state.players[state.confrontation.playerIndex] : undefined;
}

function currentAcquisitionPlayer() {
  if (!state?.acquisition) return undefined;
  const order = state.acquisition.order ?? state.players.filter((player) => player.active).map((player) => player.id);
  const currentId = order[state.acquisition.playerIndex];
  return currentId ? playerById(currentId) : undefined;
}

function currentHandLimitPlayer() {
  return state?.players.find((player) => player.hand.length > 12);
}

function activeTablePlayerId() {
  if (!state) return null;
  if (state.pendingChoice?.playerId) return state.pendingChoice.playerId;
  if (state.phase === 'initialPokemon') return currentInitialPlayer()?.id ?? null;
  if (state.phase === 'preparation') return currentPreparationPlayer()?.id ?? null;
  if (state.phase === 'confrontation') return currentConfrontationPlayer()?.id ?? null;
  if (state.phase === 'acquisitions') return currentAcquisitionPlayer()?.id ?? null;
  if (state.phase === 'handLimit') return currentHandLimitPlayer()?.id ?? null;
  if (state.phase === 'resolution') return state.resolution?.order[state.resolution.index] ?? state.priorityPlayerId;
  return state.priorityPlayerId;
}

function visibleInteractivePlayerId() {
  if (!state) return null;
  if (state.pendingChoice) return pendingChoiceVisibleFor === state.pendingChoice.id ? state.pendingChoice.playerId ?? null : null;
  if (state.phase === 'initialPokemon') return state.initialChoice?.visible ? currentInitialPlayer()?.id ?? null : null;
  if (state.phase === 'preparation') return state.privateTurn?.visible ? currentPreparationPlayer()?.id ?? null : null;
  if (state.phase === 'confrontation') return state.confrontation?.visible ? currentConfrontationPlayer()?.id ?? null : null;
  if (state.phase === 'acquisitions') return state.acquisition?.visible ? currentAcquisitionPlayer()?.id ?? null : null;
  if (state.phase === 'handLimit') {
    const over = currentHandLimitPlayer();
    return over && handLimitVisibleFor === over.id ? over.id : null;
  }
  return null;
}

function seatLayout(focusId: PlayerId | null): SeatLayout {
  if (!state) return { bottom: 'player-1', left: 'player-2', top: 'player-3', right: 'player-4' };
  const ids = state.players.map((player) => player.id);
  const startIndex = focusId ? ids.indexOf(focusId) : 0;
  return {
    bottom: ids[(startIndex + 4) % 4] as PlayerId,
    left: ids[(startIndex + 1) % 4] as PlayerId,
    top: ids[(startIndex + 2) % 4] as PlayerId,
    right: ids[(startIndex + 3) % 4] as PlayerId,
  };
}

function phaseLabel(phase: GameState['phase']) {
  const labels: Record<GameState['phase'], string> = {
    menu: 'Menu',
    formation: 'Formação',
    initialPokemon: 'Pokémon Inicial',
    roundStart: 'Início da Rodada',
    preparation: 'Preparação',
    reveal: 'Revelação',
    onReveal: 'Ao Revelar',
    confrontation: 'Confronto',
    order: 'Ordem',
    resolution: 'Resolução',
    roundEnd: 'Fim da Rodada',
    acquisitions: 'Aquisições',
    handLimit: 'Limite de Mão',
    priority: 'Prioridade',
    pokemonZone: 'Zona Pokémon',
    gameOver: 'Fim de Jogo',
  };
  return labels[phase];
}

function normalizeUiState() {
  if (!state) {
    selectedHandCardId = null;
    selectedSupporterCardId = null;
    previewInstanceId = null;
    zoomInstanceId = null;
    armedSlot = null;
    pendingProgram = null;
    pendingSupporter = null;
    cleanupDragState();
    return;
  }

  const visiblePlayerId = visibleInteractivePlayerId();
  const prepPlayer = state.phase === 'preparation' && visiblePlayerId ? playerById(visiblePlayerId) : undefined;
  const supporterPlayer = state.phase === 'confrontation' && visiblePlayerId ? playerById(visiblePlayerId) : undefined;

  if (!prepPlayer) {
    selectedHandCardId = null;
    armedSlot = null;
    pendingProgram = null;
    cleanupDragState();
  } else {
    if (!selectedHandCardId || !prepPlayer.hand.includes(selectedHandCardId)) selectedHandCardId = null;
    if (!pendingProgram || pendingProgram.playerId !== prepPlayer.id) pendingProgram = null;
    armedSlot ??= firstOpenSlot(prepPlayer);
  }

  if (!supporterPlayer) {
    selectedSupporterCardId = null;
    pendingSupporter = null;
  } else {
    if (!selectedSupporterCardId || !supporterPlayer.hand.includes(selectedSupporterCardId)) selectedSupporterCardId = null;
    if (!pendingSupporter || pendingSupporter.playerId !== supporterPlayer.id) pendingSupporter = null;
  }

  if (previewInstanceId && !instanceExists(previewInstanceId)) previewInstanceId = null;
  if (zoomInstanceId && !instanceExists(zoomInstanceId)) zoomInstanceId = null;
}

function setPreview(instanceId?: string | null) {
  previewInstanceId = instanceId && instanceExists(instanceId) ? instanceId : null;
}

function firstOpenSlot(player: GameState['players'][number]) {
  if (!player.programmed.primary) return 'primary';
  if (!player.roundFlags.recoveryActionOnly && !player.programmed.secondary) return 'secondary';
  return 'primary';
}

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function cardScale(size: CardSize) {
  const scaleBySize: Record<CardSize, number> = {
    hero: 0.34,
    support: 0.26,
    bench: 0.22,
    attachment: 0.17,
    zone: 0.19,
    'pile-top': 0.16,
    hand: 0.24,
    preview: 0.4,
    zoom: 0.56,
  };
  return scaleBySize[size];
}

function templateForCard(card: StoredCard) {
  return q<HTMLTemplateElement>(`template[data-card-template-collection="${card.collectionId}"][data-card-template-id="${card.id}"]`);
}

function applyArtworkTransform(node: HTMLElement, data: CardData) {
  node.style.setProperty('--art-scale', String(data.artworkTransform?.scale ?? 1));
  node.style.setProperty('--art-x', String(data.artworkTransform?.x ?? 0));
  node.style.setProperty('--art-y', String(data.artworkTransform?.y ?? 0));
}

function renderCardButton(instanceId: string, size: CardSize, mode: 'public' | 'hand' | 'preview') {
  const stored = cardForInstance(instanceId);
  if (!stored) return '<div class="journey-card-fallback">Carta ausente</div>';
  const template = templateForCard(stored);
  if (!template?.content.firstElementChild) return `<div class="journey-card-fallback">${escapeHtml(cardName(stored.data))}</div>`;
  const clone = template.content.firstElementChild.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  qa<HTMLElement>('[id]', clone).forEach((node) => node.removeAttribute('id'));
  qa<HTMLImageElement>('img', clone).forEach((image) => {
    image.loading = 'lazy';
    image.decoding = 'async';
  });
  applyArtworkTransform(clone, stored.data);

  return `<div class="journey-card-wrap is-${size}" style="--journey-card-scale:${cardScale(size)};">
    <button class="journey-card-hitbox" type="button" data-command="${mode === 'hand' ? 'select-hand-card' : 'open-card'}" data-instance-id="${instanceId}">
      <div class="journey-card-tilt" data-tilt-card>
        ${clone.outerHTML}
        <i class="journey-card-glare" aria-hidden="true"></i>
      </div>
    </button>
  </div>`;
}

function renderHandBacks(count: number) {
  return `<span class="journey-hand-backs" aria-label="${count} carta(s) na mão"><i></i><i></i><i></i><b>${count} cartas</b></span>`;
}

function renderPlayerHeader(player: GameState['players'][number]) {
  const wildcards = `Atk ${player.wildcards.attack ? '✓' : '—'} · Cmp ${player.wildcards.draw ? '✓' : '—'} · Troca ${player.wildcards.switch ? '✓' : '—'}`;
  return `<header class="journey-player-header">
    <div>
      <strong>${escapeHtml(player.name)}</strong>
      <span>${escapeHtml(player.championName)}</span>
    </div>
    <div class="journey-player-meta">
      <span>${player.points} pts</span>
      <span>${player.programmed.locked ? 'ações travadas' : 'ações abertas'}</span>
      <span>${wildcards}</span>
      ${renderHandBacks(player.hand.length)}
    </div>
  </header>`;
}

function renderChampionSeatCard(player: GameState['players'][number], size: CardSize) {
  return player.championId
    ? `<div class="journey-sidecard-block"><span class="journey-sidecard-label">Campeão</span>${renderCardButton(player.championId, size, 'public')}</div>`
    : '<div class="journey-empty-line">Sem Campeão</div>';
}

function renderContextTargetAttributes(kind: CandidateTargetKind, id: string) {
  if (pendingProgram?.presentation === 'context') {
    const match = pendingProgram.candidates.find((candidate) => candidate.targetKind === kind && candidate.targetId === id);
    if (match) return ` data-command="choose-context-target" data-target-kind="${kind}" data-target-id="${escapeHtml(id)}"`;
  }
  if (pendingSupporter?.presentation === 'context') {
    const match = pendingSupporter.candidates.find((candidate) => candidate.targetKind === kind && candidate.targetId === id);
    if (match) return ` data-command="choose-context-supporter" data-target-kind="${kind}" data-target-id="${escapeHtml(id)}"`;
  }
  return '';
}

function renderPokemonStack(mon: PokemonInPlay | undefined, size: CardSize) {
  if (!mon) return '<div class="journey-empty-pokemon">Sem Ativo</div>';
  const data = pokemonCard(state!, cards, mon);
  if (!data) return '<div class="journey-empty-pokemon">Carta ausente</div>';
  const hp = Math.max(0, data.hp - mon.damage);
  const modifiers: string[] = [];
  if (mon.modifiers.offense || mon.temporaryModifiers.offense) modifiers.push(`ATK ${signed(mon.modifiers.offense + mon.temporaryModifiers.offense)}`);
  if (mon.modifiers.defense || mon.temporaryModifiers.defense) modifiers.push(`DEF ${signed(mon.modifiers.defense + mon.temporaryModifiers.defense)}`);
  if (mon.modifiers.speed || mon.temporaryModifiers.speed) modifiers.push(`VEL ${signed(mon.modifiers.speed + mon.temporaryModifiers.speed)}`);
  const effects = mon.effects.slice(0, 3).map((effect) => `<span class="journey-effect-pill is-${effect.tone}">${escapeHtml(effect.name)}</span>`).join('');
  return `<article class="journey-pokemon-stack ${mon.knockedOut ? 'is-ko' : ''}">
    <div class="journey-pokemon-main"${renderContextTargetAttributes('pokemon', mon.pokemonId)}>
      ${renderCardButton(mon.currentCardInstanceId, size, 'public')}
      <div class="journey-card-badges">
        ${mon.damage > 0 ? `<span class="journey-damage-badge">${mon.damage} dano</span>` : ''}
        <span class="journey-stat-badge">HP ${hp}/${data.hp}</span>
        <span class="journey-stat-badge">VEL ${currentSpeed(state!, cards, mon)}</span>
        ${mon.knockedOut ? '<span class="journey-damage-badge is-ko">KO</span>' : ''}
      </div>
    </div>
    ${mon.toolInstanceId ? `<div class="journey-tool-stack"><span class="journey-overlay-label">Ferramenta</span>${renderCardButton(mon.toolInstanceId, 'attachment', 'public')}</div>` : ''}
    ${mon.attacks.length ? `<div class="journey-attack-stack">${mon.attacks.map((slot) => `<div class="journey-attack-card"><span class="journey-overlay-label">N${slot.level}${slot.state === 'mastered' ? ' · Dom.' : ''}</span>${renderCardButton(slot.attackInstanceId, 'attachment', 'public')}</div>`).join('')}</div>` : ''}
    <div class="journey-pokemon-footer">
      ${modifiers.length ? modifiers.map((item) => `<span class="journey-mini-chip">${escapeHtml(item)}</span>`).join('') : '<span class="journey-mini-chip">Sem modificadores</span>'}
      ${effects || '<span class="journey-mini-chip">Sem efeitos</span>'}
    </div>
  </article>`;
}

function renderPile(id: PhysicalPileId) {
  const reveal = state!.dev.revealPiles
    ? `<small>${state!.board.piles[id].slice(0, 3).map(displayCard).join(' / ') || 'sem topo revelado'}</small>`
    : '';
  return `<button class="journey-pile-card" type="button"${renderContextTargetAttributes('pile', id)}>
    <div class="journey-pile-stack"><i></i><i></i><i></i></div>
    <div class="journey-pile-copy">
      <strong>${PILE_LABELS[id]}</strong>
      <span>${state!.board.piles[id].length} carta(s)</span>
      ${reveal}
    </div>
  </button>`;
}

function renderStadiumSlot(slotId: StadiumSlotId) {
  const connected = STADIUM_CONNECTIONS[slotId].map((index) => state!.players[index]?.name).join(' / ');
  const cardId = state!.board.stadiums[slotId];
  return `<div class="journey-stadium-slot"${renderContextTargetAttributes('stadium', slotId)}>
    <div class="journey-stadium-copy"><strong>${slotId}</strong><small>${escapeHtml(connected)}</small></div>
    <div class="journey-stadium-card">${cardId ? renderCardButton(cardId, 'zone', 'public') : '<div class="journey-empty-slot">Livre</div>'}</div>
  </div>`;
}

function renderCenterBoard() {
  const discardTop = state!.board.discard[state!.board.discard.length - 1]?.instanceId;
  return `<section class="journey-center">
    <div class="journey-center-piles">${(['pokemonA', 'pokemonB', 'trainerA', 'trainerB', 'attackA', 'attackB'] as PhysicalPileId[]).map((id) => renderPile(id)).join('')}</div>
    <div class="journey-center-core">
      <div class="journey-center-lane">
        <div class="journey-climate-zone"><span class="journey-zone-title">Clima</span>${state!.board.climate ? renderCardButton(state!.board.climate, 'zone', 'public') : '<div class="journey-empty-slot">Sem clima</div>'}</div>
        <div class="journey-discard-zone"><span class="journey-zone-title">Descarte</span>${discardTop ? renderCardButton(discardTop, 'pile-top', 'public') : '<div class="journey-card-back small"></div>'}<small>${state!.board.discard.length} carta(s)</small></div>
      </div>
      <div class="journey-zone-zone">
        <div class="journey-zone-header"><span class="journey-zone-title">Zona Pokémon</span><small>${state!.board.pokemonZone.length} carta(s)</small></div>
        <div class="journey-zone-cards">${state!.board.pokemonZone.map((instanceId) => `<div class="journey-zone-card"${renderContextTargetAttributes('zone-card', instanceId)}>${renderCardButton(instanceId, 'zone', 'public')}</div>`).join('') || '<div class="journey-empty-slot">Vazia</div>'}</div>
      </div>
      <div class="journey-stadium-ring">${(Object.keys(state!.board.stadiums) as StadiumSlotId[]).map((slotId) => renderStadiumSlot(slotId)).join('')}</div>
    </div>
  </section>`;
}

function renderSeat(position: 'top' | 'left' | 'right', playerId: PlayerId, focused: boolean) {
  const player = playerById(playerId);
  if (!player) return '';
  const large = position === 'top' ? 'support' : 'bench';
  return `<section class="journey-seat journey-seat-${position} ${focused ? 'is-focused' : ''} ${player.active ? '' : 'is-inactive'}">
    ${renderPlayerHeader(player)}
    <div class="journey-seat-body">
      <div class="journey-seat-active-zone">${renderPokemonStack(player.activePokemonId ? state!.pokemon[player.activePokemonId] : undefined, large as CardSize)}</div>
      <div class="journey-seat-sidecard">${renderChampionSeatCard(player, 'support')}</div>
      <div class="journey-seat-bench">${player.bench.map((id) => renderPokemonStack(state!.pokemon[id], 'attachment')).join('') || '<div class="journey-empty-line">Banco vazio</div>'}</div>
    </div>
  </section>`;
}

function renderPassiveCopy() {
  if (state!.phase === 'reveal') return 'As ações já foram travadas. Revele tudo de uma vez para seguir para o confronto.';
  if (state!.phase === 'resolution') return 'A mesa está em resolução pública. Avance ação por ação usando o painel da rodada.';
  if (state!.phase === 'roundStart') return 'Abra a próxima rodada para voltar aos turnos privados.';
  if (state!.phase === 'gameOver') return 'A Jornada terminou e a classificação final permanece disponível.';
  return 'Aguarde a próxima etapa pública ou abra as ferramentas recolhidas se precisar de um ajuste manual.';
}

function renderBottomArena(playerId: PlayerId, focused: boolean) {
  const player = playerById(playerId);
  if (!player) return '';
  const previewId = previewInstanceId ?? player.activePokemonId ?? player.hand[0] ?? player.championId ?? state!.board.pokemonZone[0] ?? state!.board.climate ?? null;
  return `<section class="journey-seat journey-seat-bottom ${focused ? 'is-focused' : ''} ${player.active ? '' : 'is-inactive'}">
    ${renderPlayerHeader(player)}
    <div class="journey-local-layout">
      <div class="journey-local-field">
        <div class="journey-local-main">${renderPokemonStack(player.activePokemonId ? state!.pokemon[player.activePokemonId] : undefined, 'hero')}</div>
        <div class="journey-local-side-column">
          ${renderChampionSeatCard(player, 'support')}
          <div class="journey-local-bench">${player.bench.map((id) => renderPokemonStack(state!.pokemon[id], 'bench')).join('') || '<div class="journey-empty-line">Banco vazio</div>'}</div>
        </div>
      </div>
      <aside class="journey-preview-panel">
        <div class="journey-preview-heading"><span class="journey-eyebrow">CARTA EM FOCO</span><strong>${escapeHtml(previewId ? displayCard(previewId) : 'Mesa da Jornada')}</strong></div>
        <div class="journey-preview-stage">${previewId ? renderCardButton(previewId, 'preview', 'public') : '<div class="journey-preview-empty">Selecione uma carta para ampliar.</div>'}</div>
      </aside>
    </div>
    ${renderBottomInteraction(player)}
  </section>`;
}

function actionSourceCards(action?: ProgrammedAction) {
  if (!action) return [];
  if (action.kind === 'learnAttack') return [action.attackInstanceId];
  if (action.kind === 'playPokemon') return [action.cardInstanceId];
  if (action.kind === 'useItems') return [...action.itemInstanceIds];
  if (action.kind === 'attachTools') return [...action.toolInstanceIds];
  if (action.kind === 'useRareItem') return [action.rareItemInstanceId];
  if (action.kind === 'placeStadium') return [action.stadiumInstanceId];
  if (action.kind === 'placeClimate') return [action.climateInstanceId];
  return [];
}

function specialLabelForAction(action?: ProgrammedAction) {
  if (!action) return undefined;
  if (action.kind === 'none') return 'Sem ação';
  if (action.kind === 'buyWildcard') return 'Curinga de compra';
  if (action.kind === 'reuseAttack') return `Curinga de ataque N${action.level}`;
  if (action.kind === 'switchWildcard') return 'Curinga de troca';
  if (action.kind === 'manual') return 'Resolução manual';
  return undefined;
}

function actionLabel(action: ProgrammedAction) {
  if (action.kind === 'none') return 'Não agir';
  if (action.kind === 'learnAttack') return `Ataque ${displayCard(action.attackInstanceId)} → ${pokemonDisplayName(state!, cards, action.targetPokemonId)}`;
  if (action.kind === 'reuseAttack') return `Curinga N${action.level} → ${pokemonDisplayName(state!, cards, action.targetPokemonId)}`;
  if (action.kind === 'playPokemon') return action.targetPokemonId ? `Evoluir ${pokemonDisplayName(state!, cards, action.targetPokemonId)}` : `Posicionar ${displayCard(action.cardInstanceId)}`;
  if (action.kind === 'useItems') return `Item ${action.itemInstanceIds.map(displayCard).join(' + ')}`;
  if (action.kind === 'attachTools') return `Ferramenta ${action.toolInstanceIds.map(displayCard).join(' + ')}`;
  if (action.kind === 'useRareItem') return `Item Raro ${displayCard(action.rareItemInstanceId)}`;
  if (action.kind === 'placeStadium') return `Estádio ${action.slotId}`;
  if (action.kind === 'placeClimate') return `Clima ${displayCard(action.climateInstanceId)}`;
  if (action.kind === 'buyWildcard') return action.pileId === 'zone' ? 'Comprar da Zona' : `Comprar de ${PILE_LABELS[action.pileId]}`;
  if (action.kind === 'switchWildcard') return 'Troca via Curinga';
  return 'Resolver manualmente';
}

function renderSlotSelectionMarkup(cardIds: string[], specialLabel?: string) {
  if (cardIds.length) return `<div class="journey-slot-cards">${cardIds.map((instanceId) => renderCardButton(instanceId, 'support', 'public')).join('')}</div>`;
  if (specialLabel) return `<div class="journey-slot-token">${escapeHtml(specialLabel)}</div>`;
  return '<div class="journey-slot-placeholder">Solte uma carta aqui</div>';
}

function slotSelection(player: GameState['players'][number], slot: ActionSlot) {
  if (pendingProgram?.playerId === player.id && pendingProgram.slot === slot) {
    return {
      clearable: true,
      label: pendingProgram.prompt,
      markup: renderSlotSelectionMarkup(pendingProgram.sourceCardIds, pendingProgram.specialLabel),
    };
  }
  const action = slot === 'primary' ? player.programmed.primary : player.programmed.secondary;
  if (!action) {
    return {
      clearable: false,
      label: slot === 'secondary' && player.roundFlags.recoveryActionOnly ? 'Bloqueada nesta rodada.' : 'Arraste uma carta para este espaço.',
      markup: `<div class="journey-slot-placeholder">${slot === 'secondary' && player.roundFlags.recoveryActionOnly ? 'Sem ação secundária nesta rodada.' : 'Solte uma carta aqui'}</div>`,
    };
  }
  return {
    clearable: true,
    label: actionLabel(action),
    markup: renderSlotSelectionMarkup(actionSourceCards(action), specialLabelForAction(action)),
  };
}

function renderActionSlot(player: GameState['players'][number], slot: ActionSlot) {
  const selection = slotSelection(player, slot);
  const blocked = slot === 'secondary' && player.roundFlags.recoveryActionOnly;
  return `<section class="journey-slot ${armedSlot === slot ? 'is-armed' : ''} ${blocked ? 'is-blocked' : ''}" data-slot-drop="${slot}">
    <div class="journey-slot-topline">
      <span class="journey-slot-title">${slot === 'primary' ? 'Ação Principal' : 'Ação Secundária'}</span>
      ${selection.clearable ? `<button class="journey-slot-clear" type="button" data-command="clear-slot" data-slot="${slot}">Limpar</button>` : ''}
    </div>
    <button class="journey-slot-surface" type="button" data-command="arm-slot" data-slot="${slot}" ${blocked ? 'disabled' : ''}>${selection.markup}</button>
    <div class="journey-slot-foot"><span>${escapeHtml(selection.label)}</span></div>
  </section>`;
}

function renderReadyPanel(player: GameState['players'][number]) {
  const timeLabel = state!.timerMode === 'official'
    ? `<small data-role="timer-readout">${officialTimerSeconds(state!.round)}s</small>`
    : '<small>sem limite</small>';
  return `<aside class="journey-ready-panel">
    <button class="journey-ready-button" type="button" data-command="lock-actions" data-player-id="${player.id}">
      <strong>PRONTO</strong>
      ${timeLabel}
    </button>
    <p>Ao confirmar, sua mão desaparece e a mesa volta imediatamente para a tela neutra de passe.</p>
  </aside>`;
}

function renderHandCard(player: GameState['players'][number], instanceId: string, index: number) {
  return `<button class="journey-hand-card ${selectedHandCardId === instanceId ? 'is-selected' : ''}" type="button" data-command="select-hand-card" data-player-id="${player.id}" data-instance-id="${instanceId}" data-drag-card-id="${instanceId}" style="--fan-index:${index};--fan-total:${player.hand.length};">
    ${renderCardButton(instanceId, 'hand', 'public')}
  </button>`;
}

function renderSupporterCard(player: GameState['players'][number], instanceId: string, index: number) {
  return `<button class="journey-hand-card ${selectedSupporterCardId === instanceId ? 'is-selected' : ''}" type="button" data-command="select-supporter-card" data-player-id="${player.id}" data-instance-id="${instanceId}" style="--fan-index:${index};--fan-total:${Math.max(1, player.hand.length)};">
    ${renderCardButton(instanceId, 'hand', 'public')}
  </button>`;
}

function renderProgramListChoice() {
  if (!pendingProgram || pendingProgram.presentation !== 'list') return '';
  return `<div class="journey-option-list">${pendingProgram.candidates.map((candidate) => `<button class="journey-mini-action" type="button" data-command="apply-program-candidate" data-action-json="${encodeAction(candidate.action)}">${escapeHtml(candidate.label)}</button>`).join('')}</div>`;
}

function renderSupporterListChoice() {
  if (!pendingSupporter || pendingSupporter.presentation !== 'list') return '';
  return `<div class="journey-option-list">${pendingSupporter.candidates.map((candidate) => `<button class="journey-mini-action" type="button" data-command="apply-supporter-candidate" data-supporter-choice="${encodeAction(candidate.choice)}">${escapeHtml(candidate.label)}</button>`).join('')}</div>`;
}

function renderInitialChoiceBand(player: GameState['players'][number]) {
  const options = state!.initialChoice?.options ?? [];
  return `<section class="journey-bottom-panel">
    <div class="journey-panel-copy">
      <span class="journey-eyebrow">ESCOLHA INICIAL</span>
      <h3>${escapeHtml(player.name)}, escolha seu Pokémon inicial</h3>
      <p>Use um Pokémon Básico comum ou incomum. As outras cartas voltam para a reserva.</p>
    </div>
    <div class="journey-card-row">${options.map((instanceId) => {
      const card = cardForInstance(instanceId);
      const valid = card?.data.cardType === 'pokemon' && card.data.stage === 'BÁSICO' && ['common', 'uncommon'].includes(card.data.rarity);
      return `<button class="journey-selection-card ${valid ? '' : 'is-disabled'}" type="button" data-command="choose-initial" data-player-id="${player.id}" data-instance-id="${instanceId}" ${valid ? '' : 'disabled'}>${renderCardButton(instanceId, 'hand', 'public')}</button>`;
    }).join('')}</div>
  </section>`;
}

function renderPreparationBand(player: GameState['players'][number]) {
  return `<section class="journey-bottom-panel">
    <div class="journey-panel-copy">
      <span class="journey-eyebrow">PROGRAMAÇÃO PRIVADA</span>
      <h3>Monte suas duas ações sobre a mesa</h3>
      <p>${pendingProgram ? escapeHtml(pendingProgram.prompt) : 'Clique em uma carta da mão para deixá-la em foco e depois escolha um slot, ou arraste direto até a Ação Principal ou Secundária.'}</p>
    </div>
    ${renderProgramListChoice()}
    <div class="journey-workbench">
      <div class="journey-slot-row">
        ${renderActionSlot(player, 'primary')}
        ${renderActionSlot(player, 'secondary')}
        ${renderReadyPanel(player)}
      </div>
      <div class="journey-aux-row">
        <span class="journey-aux-label">Extras para ${armedSlot === 'secondary' ? 'Ação Secundária' : 'Ação Principal'}</span>
        <div class="journey-aux-actions">
          <button class="journey-mini-action" type="button" data-command="assign-special-action" data-special="none">Passar ação</button>
          <button class="journey-mini-action" type="button" data-command="assign-special-action" data-special="buyWildcard">Curinga de compra</button>
          <button class="journey-mini-action" type="button" data-command="assign-special-action" data-special="reuseAttack">Curinga de ataque</button>
          <button class="journey-mini-action" type="button" data-command="assign-special-action" data-special="switchWildcard">Curinga de troca</button>
          <button class="journey-mini-action" type="button" data-command="assign-special-action" data-special="manual">Resolver manualmente</button>
          ${pendingProgram ? '<button class="journey-mini-action" type="button" data-command="cancel-pending-program">Cancelar seleção</button>' : ''}
        </div>
      </div>
      <div class="journey-card-fan">${player.hand.map((instanceId, index) => renderHandCard(player, instanceId, index)).join('') || '<div class="journey-empty-slot">Mão vazia</div>'}</div>
    </div>
  </section>`;
}

function renderConfrontationBand(player: GameState['players'][number]) {
  const supporters = player.hand.filter((id) => cardForInstance(id)?.data.cardType === 'supporter');
  const choice = player.supporterChoice;
  return `<section class="journey-bottom-panel">
    <div class="journey-panel-copy">
      <span class="journey-eyebrow">JANELA DE APOIADOR</span>
      <h3>Escolha seu Apoiador da rodada</h3>
      <p>${pendingSupporter ? escapeHtml(pendingSupporter.prompt) : 'Selecione uma carta de Apoiador. Se ela pedir um alvo, a mesa vai destacar os pontos válidos.'}</p>
    </div>
    ${renderSupporterListChoice()}
    <div class="journey-supporter-layout">
      <div class="journey-supporter-slot">
        <span class="journey-slot-title">Apoiador</span>
        <div class="journey-slot-surface">
          ${choice?.kind === 'useSupporter' && choice.supporterInstanceId ? renderCardButton(choice.supporterInstanceId, 'support', 'public') : '<div class="journey-slot-placeholder">Nenhum apoiador selecionado.</div>'}
        </div>
        <div class="journey-slot-actions">
          <button class="journey-mini-action" type="button" data-command="program-supporter" data-player-id="${player.id}" data-supporter-json="${encodeAction({ kind: 'none' })}">Não usar Apoiador</button>
          ${pendingSupporter ? '<button class="journey-mini-action" type="button" data-command="cancel-pending-supporter">Cancelar alvo</button>' : ''}
        </div>
      </div>
      <div class="journey-supporter-hand">${supporters.map((instanceId, index) => renderSupporterCard(player, instanceId, index)).join('') || '<div class="journey-empty-slot">Sem apoiadores na mão.</div>'}</div>
      <div class="journey-ready-compact">
        <button class="journey-ready-button" type="button" data-command="lock-supporter" data-player-id="${player.id}">
          <strong>PRONTO</strong>
          <small>travar apoiador</small>
        </button>
      </div>
    </div>
  </section>`;
}

function renderHandLimitBand(player: GameState['players'][number]) {
  const needed = Math.max(0, player.hand.length - 12);
  return `<section class="journey-bottom-panel">
    <div class="journey-panel-copy">
      <span class="journey-eyebrow">LIMITE DE MÃO</span>
      <h3>${escapeHtml(player.name)} precisa descartar ${needed} carta(s)</h3>
      <p>Escolha as cartas diretamente abaixo e depois confirme.</p>
    </div>
    <div class="journey-discard-grid">${player.hand.map((instanceId) => `<label class="journey-discard-card">
      <input type="checkbox" value="${instanceId}" data-discard-limit="${player.id}" />
      ${renderCardButton(instanceId, 'hand', 'public')}
    </label>`).join('')}</div>
    <div class="journey-hand-limit-actions"><button class="journey-button primary" type="button" data-command="apply-hand-limit" data-player-id="${player.id}">Aplicar limite</button></div>
  </section>`;
}

function renderBottomInteraction(player: GameState['players'][number]) {
  if (state!.pendingChoice) return '';
  if (state!.phase === 'initialPokemon' && state!.initialChoice?.visible && currentInitialPlayer()?.id === player.id) return renderInitialChoiceBand(player);
  if (state!.phase === 'preparation' && state!.privateTurn?.visible && currentPreparationPlayer()?.id === player.id) return renderPreparationBand(player);
  if (state!.phase === 'confrontation' && state!.confrontation?.visible && currentConfrontationPlayer()?.id === player.id) return renderConfrontationBand(player);
  if (state!.phase === 'handLimit') {
    const over = currentHandLimitPlayer();
    if (over && handLimitVisibleFor === over.id && over.id === player.id) return renderHandLimitBand(over);
  }
  return `<section class="journey-bottom-panel is-passive">
    <div class="journey-passive-panel">
      <span class="journey-eyebrow">MESA DA JORNADA</span>
      <h3>${escapeHtml(phaseLabel(state!.phase))}</h3>
      <p>${renderPassiveCopy()}</p>
    </div>
  </section>`;
}

function renderPendingChoiceCard(optionId: string, disabled: boolean | undefined, choiceId: string) {
  if (instanceExists(optionId)) {
    return `<label class="journey-discard-card ${disabled ? 'is-disabled' : ''}">
      <input type="checkbox" value="${optionId}" data-pending-multi="${choiceId}" ${disabled ? 'disabled' : ''} />
      ${renderCardButton(optionId, 'hand', 'public')}
    </label>`;
  }
  return `<label class="journey-discard-card ${disabled ? 'is-disabled' : ''}">
    <input type="checkbox" value="${escapeHtml(optionId)}" data-pending-multi="${choiceId}" ${disabled ? 'disabled' : ''} />
    <span class="journey-option-pill">${escapeHtml(optionId)}</span>
  </label>`;
}

function renderPendingChoiceOptions(choice: PendingChoice) {
  return `<div class="journey-option-list">${choice.options.map((option) => {
    if (instanceExists(option.id)) {
      return `<button class="journey-inline-card-button ${option.disabled ? 'is-disabled' : ''}" type="button" data-command="resolve-choice" data-choice-id="${choice.id}" data-choice-option="${escapeHtml(option.id)}" ${option.disabled ? 'disabled' : ''}>${renderCardButton(option.id, 'support', 'public')}<span>${escapeHtml(option.label)}</span></button>`;
    }
    return `<button class="journey-mini-action ${option.disabled ? 'is-disabled' : ''}" type="button" data-command="resolve-choice" data-choice-id="${choice.id}" data-choice-option="${escapeHtml(option.id)}" ${option.disabled ? 'disabled' : ''}>${escapeHtml(option.label)}</button>`;
  }).join('')}</div>`;
}

function renderPendingChoicePanel(choice: PendingChoice) {
  if (pendingChoiceVisibleFor !== choice.id) return '';
  const ownerName = choice.playerId ? playerName(choice.playerId) : 'jogador responsável';
  const multi = choice.kind === 'discard' && choice.data?.multi;
  return `<aside class="journey-status-panel is-wide">
    <span class="journey-eyebrow">ESCOLHA PRIVADA</span>
    <h3>${escapeHtml(ownerName)}</h3>
    <p>${escapeHtml(choice.prompt)}</p>
    ${multi
      ? `<div class="journey-discard-grid">${choice.options.map((option) => renderPendingChoiceCard(option.id, option.disabled, choice.id)).join('')}</div><button class="journey-button primary" type="button" data-command="resolve-choice-multi" data-choice-id="${choice.id}">Confirmar escolha</button>`
      : renderPendingChoiceOptions(choice)}
  </aside>`;
}

function renderStatusPanel() {
  if (state!.pendingChoice) return renderPendingChoicePanel(state!.pendingChoice);
  if (state!.phase === 'roundStart') {
    return `<aside class="journey-status-panel"><span class="journey-eyebrow">RODADA ${state!.round}</span><h3>Preparar mesa</h3><p>Abra a próxima rodada para voltar aos turnos privados de programação.</p><button class="journey-button primary" type="button" data-command="start-round">Começar Preparação</button></aside>`;
  }
  if (state!.phase === 'reveal') {
    return `<aside class="journey-status-panel"><span class="journey-eyebrow">REVELAÇÃO</span><h3>Todos os jogadores concluíram</h3><div class="journey-reveal-list">${state!.players.map((player) => `<div><strong>${escapeHtml(player.name)}</strong><span>Principal: ${player.programmed.primary ? actionLabel(player.programmed.primary) : 'Nada'}</span><span>Secundária: ${player.programmed.secondary ? actionLabel(player.programmed.secondary) : 'Nada'}</span></div>`).join('')}</div><button class="journey-button primary" type="button" data-command="reveal-actions">Revelar ações</button></aside>`;
  }
  if (state!.phase === 'resolution') {
    const current = state!.resolution?.order[state!.resolution.index];
    return `<aside class="journey-status-panel"><span class="journey-eyebrow">RESOLUÇÃO</span><h3>${current ? escapeHtml(playerName(current)) : 'Fim da ordem'}</h3><p>${state!.resolution ? escapeHtml(`${state!.resolution.order.map(playerName).join(' → ')} · ${state!.resolution.slot === 'primary' ? 'Ações Principais' : 'Ações Secundárias'}`) : 'Aguardando ordem.'}</p><button class="journey-button primary" type="button" data-command="resolve-next">Resolver próxima ação</button></aside>`;
  }
  if (state!.phase === 'order') {
    return `<aside class="journey-status-panel"><span class="journey-eyebrow">ORDEM</span><h3>Definir resolução</h3><p>O confronto terminou. Defina a ordem com base na velocidade atual da mesa.</p><button class="journey-button primary" type="button" data-command="continue-phase">Definir ordem</button></aside>`;
  }
  if (state!.phase === 'gameOver') {
    return `<aside class="journey-status-panel"><span class="journey-eyebrow">FIM DE JOGO</span><h3>Classificação final</h3><ol class="journey-ranking">${state!.ranking.map((playerId) => `<li>${escapeHtml(playerName(playerId))}</li>`).join('')}</ol></aside>`;
  }
  if (state!.phase === 'acquisitions' && state!.acquisition?.visible) {
    return `<aside class="journey-status-panel"><span class="journey-eyebrow">AQUISIÇÃO GRATUITA</span><h3>${escapeHtml(currentAcquisitionPlayer()?.name ?? 'Jogador')}</h3><p>Clique em uma pilha ou em uma carta da Zona Pokémon para fazer a aquisição gratuita.</p></aside>`;
  }
  if (state!.phase === 'confrontation' && state!.confrontation?.visible) {
    return `<aside class="journey-status-panel"><span class="journey-eyebrow">CONFRONTO</span><h3>${escapeHtml(currentConfrontationPlayer()?.name ?? 'Jogador')}</h3><p>${pendingSupporter ? escapeHtml(pendingSupporter.prompt) : 'Escolha secretamente até um Apoiador da rodada.'}</p></aside>`;
  }
  if (state!.phase === 'preparation' && state!.privateTurn?.visible) {
    return `<aside class="journey-status-panel"><span class="journey-eyebrow">MESA PRIVADA</span><h3>${escapeHtml(currentPreparationPlayer()?.name ?? 'Jogador')}</h3><p>${pendingProgram ? escapeHtml(pendingProgram.prompt) : 'Monte suas duas ações diretamente sobre a mesa.'}</p></aside>`;
  }
  if (state!.phase === 'initialPokemon' && state!.initialChoice?.visible) {
    return `<aside class="journey-status-panel"><span class="journey-eyebrow">ESCOLHA INICIAL</span><h3>${escapeHtml(currentInitialPlayer()?.name ?? 'Jogador')}</h3><p>Selecione um Pokémon Básico comum ou incomum para abrir a partida.</p></aside>`;
  }
  if (state!.phase === 'handLimit') {
    return `<aside class="journey-status-panel"><span class="journey-eyebrow">LIMITE DE MÃO</span><h3>${escapeHtml(currentHandLimitPlayer()?.name ?? 'Jogador')}</h3><p>Faça o descarte necessário para a rodada poder continuar.</p></aside>`;
  }
  return '';
}

function renderBoardTools() {
  return `<div class="journey-board-tools"><button class="journey-mini-action" type="button" data-command="toggle-log">${logOpen ? 'Fechar log' : 'Abrir log'}</button><button class="journey-mini-action" type="button" data-command="toggle-debug">${debugOpen ? 'Fechar ferramentas' : 'Ferramentas'}</button></div>`;
}

function renderOverlayCard(eyebrow: string, title: string, copy: string, actions: string) {
  return `<div class="journey-overlay"><div class="journey-overlay-card"><span class="journey-eyebrow">${eyebrow}</span><h2>${title}</h2><p>${copy}</p><div class="journey-overlay-actions">${actions}</div></div></div>`;
}

function renderBlockingOverlay() {
  if (state!.pendingChoice && pendingChoiceVisibleFor !== state!.pendingChoice.id) {
    return renderOverlayCard('ESCOLHA PRIVADA', `Passe para ${playerName(state!.pendingChoice.playerId ?? state!.priorityPlayerId)}`, 'Há uma decisão pendente durante a resolução. As opções só aparecem quando o jogador confirmar.', `<button class="journey-button primary" type="button" data-command="reveal-pending-choice" data-choice-id="${state!.pendingChoice.id}">Estou pronto</button>`);
  }
  if (state!.phase === 'initialPokemon' && state!.initialChoice && !state!.initialChoice.visible) {
    return renderOverlayCard('ESCOLHA INICIAL', `Passe para ${escapeHtml(currentInitialPlayer()?.name ?? 'o próximo jogador')}`, 'A mão inicial só será revelada quando o jogador confirmar que está com o computador.', '<button class="journey-button primary" type="button" data-command="reveal-initial">Estou pronto</button>');
  }
  if (state!.phase === 'preparation' && state!.privateTurn && !state!.privateTurn.visible) {
    return renderOverlayCard('TURNO DE PROGRAMAÇÃO', `Passe para ${escapeHtml(currentPreparationPlayer()?.name ?? 'o próximo jogador')}`, state!.timerMode === 'official' ? `O cronômetro oficial desta rodada será de ${officialTimerSeconds(state!.round)}s.` : 'Esta rodada está sem limite oficial de tempo.', '<button class="journey-button primary" type="button" data-command="reveal-preparation">Revelar minha mão</button>');
  }
  if (state!.phase === 'confrontation' && state!.confrontation && !state!.confrontation.visible) {
    return renderOverlayCard('CONFRONTO', `Passe para ${escapeHtml(currentConfrontationPlayer()?.name ?? 'o próximo jogador')}`, 'A escolha de Apoiador continua privada até que o jogador confirme.', '<button class="journey-button primary" type="button" data-command="reveal-confrontation">Estou pronto</button>');
  }
  if (state!.phase === 'acquisitions' && state!.acquisition && !state!.acquisition.visible) {
    return renderOverlayCard('AQUISIÇÃO GRATUITA', `Passe para ${escapeHtml(currentAcquisitionPlayer()?.name ?? 'o próximo jogador')}`, 'A mesa pública continua visível, mas a escolha só abre quando o jogador confirmar.', '<button class="journey-button primary" type="button" data-command="reveal-acquisition">Estou pronto</button>');
  }
  if (state!.phase === 'handLimit') {
    const over = currentHandLimitPlayer();
    if (over && handLimitVisibleFor !== over.id) {
      return renderOverlayCard('LIMITE DE MÃO', `Passe para ${escapeHtml(over.name)}`, `Este jogador precisa descartar ${Math.max(0, over.hand.length - 12)} carta(s).`, `<button class="journey-button primary" type="button" data-command="reveal-hand-limit" data-player-id="${over.id}">Estou pronto</button>`);
    }
  }
  return '';
}

function renderDebugPlayer(player: GameState['players'][number]) {
  const pokemonIds = [player.activePokemonId, ...player.bench].filter(Boolean) as string[];
  return `<section class="journey-debug-group">
    <div class="journey-debug-group-head"><strong>${escapeHtml(player.name)}</strong><div class="journey-debug-inline"><button class="journey-mini-action" type="button" data-command="manual-points" data-player-id="${player.id}" data-delta="1">+1 pt</button><button class="journey-mini-action" type="button" data-command="manual-points" data-player-id="${player.id}" data-delta="-1">-1 pt</button></div></div>
    ${pokemonIds.map((pokemonId) => renderDebugPokemon(player.id, pokemonId)).join('') || '<p class="journey-empty-line">Sem Pokémon em campo.</p>'}
  </section>`;
}

function renderDebugPokemon(playerId: PlayerId, pokemonId: string) {
  const mon = state!.pokemon[pokemonId];
  if (!mon) return '';
  const removeButtons = mon.effects.map((effect) => `<button class="journey-mini-action" type="button" data-command="manual-remove-effect" data-pokemon-id="${mon.pokemonId}" data-effect-id="${escapeHtml(effect.id)}">Remover ${escapeHtml(effect.name)}</button>`).join('');
  return `<div class="journey-debug-pokemon">
    <strong>${escapeHtml(pokemonDisplayName(state!, cards, mon.pokemonId))}</strong>
    <div class="journey-debug-inline">
      <button class="journey-mini-action" type="button" data-command="manual-damage" data-pokemon-id="${mon.pokemonId}" data-delta="10">+10 dano</button>
      <button class="journey-mini-action" type="button" data-command="manual-damage" data-pokemon-id="${mon.pokemonId}" data-delta="-10">-10 dano</button>
      <button class="journey-mini-action" type="button" data-command="manual-heal" data-pokemon-id="${mon.pokemonId}" data-amount="30">Curar 30</button>
      <button class="journey-mini-action" type="button" data-command="manual-stat" data-pokemon-id="${mon.pokemonId}" data-stat="offense" data-delta="10">+ATK</button>
      <button class="journey-mini-action" type="button" data-command="manual-stat" data-pokemon-id="${mon.pokemonId}" data-stat="defense" data-delta="10">+DEF</button>
      <button class="journey-mini-action" type="button" data-command="manual-stat" data-pokemon-id="${mon.pokemonId}" data-stat="speed" data-delta="10">+VEL</button>
      <button class="journey-mini-action" type="button" data-command="manual-stat" data-pokemon-id="${mon.pokemonId}" data-stat="offense" data-delta="-10">-ATK</button>
      <button class="journey-mini-action" type="button" data-command="manual-stat" data-pokemon-id="${mon.pokemonId}" data-stat="defense" data-delta="-10">-DEF</button>
      <button class="journey-mini-action" type="button" data-command="manual-stat" data-pokemon-id="${mon.pokemonId}" data-stat="speed" data-delta="-10">-VEL</button>
      <button class="journey-mini-action" type="button" data-command="manual-ko" data-pokemon-id="${mon.pokemonId}" data-ko="${mon.knockedOut ? 'false' : 'true'}">${mon.knockedOut ? 'Remover KO' : 'Marcar KO'}</button>
      <button class="journey-mini-action" type="button" data-command="manual-resurrection" data-pokemon-id="${mon.pokemonId}">Ressurreição</button>
      ${playerById(playerId)?.bench.includes(mon.pokemonId) ? `<button class="journey-mini-action" type="button" data-command="manual-switch" data-player-id="${playerId}" data-pokemon-id="${mon.pokemonId}">Virar Ativo</button>` : ''}
      ${removeButtons}
    </div>
  </div>`;
}

function renderDebugDrawer() {
  if (!debugOpen) return '';
  return `<aside class="journey-drawer journey-debug-drawer">
    <div class="journey-drawer-header"><h2>Ferramentas</h2><button class="journey-mini-action" type="button" data-command="toggle-debug">Fechar</button></div>
    <div class="journey-debug-toolbar">
      <p>Seed: <strong>${state!.rng.seed}</strong></p>
      <button class="journey-mini-action" type="button" data-command="copy-state">Exportar GameState</button>
      <button class="journey-mini-action" type="button" data-command="open-import">Importar GameState</button>
      <button class="journey-mini-action" type="button" data-command="copy-log">Copiar log</button>
      <button class="journey-mini-action" type="button" data-command="toggle-piles">${state!.dev.revealPiles ? 'Ocultar topo das pilhas' : 'Revelar topo das pilhas'}</button>
      <button class="journey-mini-action" type="button" data-command="finish-by-points">Encerrar por pontos</button>
      <div class="journey-debug-note"><input data-role="manual-note" placeholder="Nota manual" /><button class="journey-mini-action" type="button" data-command="manual-note">Registrar</button></div>
    </div>
    <div class="journey-debug-groups">${state!.players.map((player) => renderDebugPlayer(player)).join('')}</div>
  </aside>`;
}

function renderLogDrawer() {
  if (!logOpen) return '';
  const visible = state!.log.filter((entry) => !entry.privateFor);
  return `<aside class="journey-drawer journey-log-drawer">
    <div class="journey-drawer-header"><h2>Log da partida</h2><button class="journey-mini-action" type="button" data-command="toggle-log">Fechar</button></div>
    <div class="journey-log-entries">${visible.slice(-80).reverse().map((entry) => `<p><small>R${entry.round} · ${phaseLabel(entry.phase)}</small>${escapeHtml(entry.message)}</p>`).join('')}</div>
  </aside>`;
}

function renderImportDialog() {
  return `<dialog class="journey-dialog" data-role="import-dialog"><div class="journey-dialog-inner"><h3>Importar GameState</h3><textarea data-role="import-json" rows="10"></textarea><div class="journey-dialog-actions"><button class="journey-button" data-command="close-dialog" type="button">Cancelar</button><button class="journey-button primary" data-command="confirm-import" type="button">Importar</button></div></div></dialog>`;
}

function renderZoomOverlay() {
  if (!zoomInstanceId) return '';
  return `<div class="journey-zoom-overlay" data-command="close-zoom"><div class="journey-zoom-card-shell" role="dialog" aria-modal="true" aria-label="Carta ampliada"><button class="journey-zoom-close" type="button" data-command="close-zoom" aria-label="Fechar visualização">×</button><div class="journey-zoom-stage">${renderCardButton(zoomInstanceId, 'zoom', 'public')}</div><div class="journey-zoom-caption"><span class="journey-eyebrow">VISUALIZAÇÃO</span><strong>${escapeHtml(displayCard(zoomInstanceId))}</strong></div></div></div>`;
}

function render() {
  normalizeUiState();
  if (!state) {
    renderMenu();
    return;
  }
  if (restoredNeedsNeutral) {
    root.innerHTML = `<section class="journey-neutral"><span class="journey-eyebrow">JORNADA RESTAURADA</span><h1>Partida carregada.</h1><p>A tela privada continua escondida. Quando o próximo jogador estiver com o computador, basta revelar a etapa certa.</p><button class="journey-button primary" type="button" data-command="ack-restore">Continuar</button></section>`;
    return;
  }
  const focusId = activeTablePlayerId();
  const seats = seatLayout(focusId);
  root.innerHTML = `<div class="journey-shell">
    <header class="journey-topbar"><a class="journey-brand" href="${appHref('/')}"><span>✦</span><strong>Card Forge / Jornada</strong></a><div class="journey-top-stats"><span>Rodada <strong>${state.round}</strong></span><span>Fase <strong>${phaseLabel(state.phase)}</strong></span><span>Prioridade <strong>${escapeHtml(playerName(state.priorityPlayerId))}</strong></span><span>Dano Base <strong>+${state.round >= 8 ? 40 : state.round >= 6 ? 30 : state.round >= 4 ? 20 : state.round >= 2 ? 10 : 0}</strong></span></div></header>
    <main class="journey-table">
      <div class="journey-board">
        ${renderSeat('top', seats.top, focusId === seats.top)}
        ${renderSeat('left', seats.left, focusId === seats.left)}
        ${renderCenterBoard()}
        ${renderSeat('right', seats.right, focusId === seats.right)}
        ${renderBottomArena(seats.bottom, focusId === seats.bottom)}
        ${renderStatusPanel()}
        ${renderBoardTools()}
        ${renderBlockingOverlay()}
      </div>
      ${renderDebugDrawer()}
      ${renderLogDrawer()}
    </main>
  </div>${renderImportDialog()}${renderZoomOverlay()}`;
  syncOfficialTimer();
}

function renderMenu() {
  const saved = loadGameState();
  const selected = activeCollection ?? collections[0];
  if (selected) cards = createLookup(selected).cards;
  const validation = selected ? validateFormation(createLookup(selected).collection) : null;
  root.innerHTML = `<section class="journey-menu">
    <div class="journey-menu-copy"><span class="journey-eyebrow">CARD FORGE / JORNADA</span><h1>Jogar Jornada</h1><p>Monte uma mesa local para 4 jogadores, usando as coleções publicadas do próprio projeto e preservando o modo jogue-e-passe.</p><div class="journey-menu-actions">${saved ? '<button class="journey-button primary" type="button" data-command="continue">Continuar Jornada</button><button class="journey-button danger" type="button" data-command="delete-save">Apagar Jornada atual</button>' : ''}<a class="journey-button" href="${appHref('/')}">Explorar coleções</a></div></div>
    <form class="journey-start-card" data-role="start-form">
      <label><span>Coleção</span><select name="collection">${collections.map((collection) => `<option value="${escapeHtml(collection.id)}" ${collection.id === selected?.id ? 'selected' : ''}>${escapeHtml(collection.name)}</option>`).join('')}</select></label>
      <label><span>Formação</span><select name="mode"><option value="test" selected>Teste</option><option value="official">Oficial</option></select></label>
      <div class="journey-formation-note"><strong>Formação de Teste</strong><p>Permite jogar mesmo sem Campeões, Climas, Ferramentas e outros componentes oficiais.</p>${validation ? `<small>Linhas Básicas: ${validation.lines.length}/24 · Ataques: ${validation.counts.attack}/50 · Itens: ${validation.counts.item}/8 · Apoiadores: ${validation.counts.supporter}/8 · Estádios: ${validation.counts.stadium}/6 · Campeões: ${validation.counts.champion}/5</small>` : ''}${validation ? `<small>Faltas oficiais: ${Object.entries(validation.officialMissing).filter(([, count]) => count > 0).map(([key, count]) => `${key}: ${count}`).join(' · ') || 'nenhuma'}</small>` : ''}</div>
      ${validation ? `<details class="journey-line-picker" open><summary>Linhas Pokémon da Jornada</summary><div>${validation.lines.slice(0, 36).map((line, index) => `<label><input type="checkbox" name="line" value="${escapeHtml(line.id)}" ${index < 24 ? 'checked' : ''} /> <span>${escapeHtml(line.name)}</span><small>${line.branches.length ? `ramificações: ${line.branches.map((branch) => branch.map((id) => cardName(cards[id]?.data ?? selected!.cards.find((entry) => entry.id === id)!.data)).join(' / ')).join(' · ')}` : line.cards.map((id) => cardName(cards[id]?.data ?? selected!.cards.find((entry) => entry.id === id)!.data)).join(' → ')}</small></label>`).join('')}</div></details>` : ''}
      <div class="journey-player-grid"><label><span>Jogador A</span><input name="player1" value="Jogador 1" /></label><label><span>Jogador B</span><input name="player2" value="Jogador 2" /></label><label><span>Jogador C</span><input name="player3" value="Jogador 3" /></label><label><span>Jogador D</span><input name="player4" value="Jogador 4" /></label></div>
      <label><span>Cronômetro</span><select name="timer"><option value="none" selected>Sem limite</option><option value="official">Oficial</option></select></label>
      <label><span>Seed</span><input name="seed" placeholder="AUTO" /></label>
      <button class="journey-button primary" type="submit">Nova Jornada</button>
    </form>
  </section>`;
}

function itemActionPrograms(playerId: PlayerId, itemId: string, card: StoredCard) {
  const owner = playerById(playerId)!;
  const ownPokemon = [owner.activePokemonId, ...owner.bench].filter(Boolean) as string[];
  const result: Array<{ itemId: string; label: string; targets: Record<string, string> }> = [];
  if (card.id === 'card-pjo-089') {
    for (const target of ownPokemon) result.push({ itemId, label: `Spray de Emergência → ${pokemonDisplayName(state!, cards, target)}`, targets: { [itemId]: target } });
  } else if (card.id === 'card-pjo-090') {
    for (const target of owner.bench) result.push({ itemId, label: `Passagem Secreta → ${pokemonDisplayName(state!, cards, target)}`, targets: { [itemId]: target } });
  } else if (card.id === 'card-pjo-091') {
    const attacks = state!.board.discard.filter((entry) => entry.lastControllerId === playerId && cardForInstance(entry.instanceId)?.data.cardType === 'attack');
    for (const target of attacks) result.push({ itemId, label: `Caixa de Reposição → ${displayCard(target.instanceId)}`, targets: { [itemId]: target.instanceId } });
    if (!attacks.length) result.push({ itemId, label: 'Caixa de Reposição (sem alvo no descarte)', targets: {} });
  } else if (card.id === 'card-pjo-092') {
    for (const pileId of Object.keys(PILE_LABELS) as PhysicalPileId[]) result.push({ itemId, label: `Scanner de Rotas → ${PILE_LABELS[pileId]}`, targets: { [itemId]: pileId } });
  }
  return result;
}

function contextualCandidates(candidates: Array<{ targetKind: CandidateTargetKind; targetId?: string }>) {
  const kind = candidates[0]?.targetKind;
  if (!kind || !['pokemon', 'stadium', 'pile', 'zone-card'].includes(kind)) return false;
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.targetKind !== kind || !candidate.targetId) return false;
    const key = `${candidate.targetKind}:${candidate.targetId}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function contextualPrompt(kind: CandidateTargetKind, slot: ActionSlot) {
  const slotLabel = slot === 'primary' ? 'Ação Principal' : 'Ação Secundária';
  if (kind === 'pokemon') return `Escolha o alvo para ${slotLabel}.`;
  if (kind === 'stadium') return `Escolha o espaço de estádio para ${slotLabel}.`;
  if (kind === 'pile') return `Escolha a pilha para ${slotLabel}.`;
  if (kind === 'zone-card') return `Escolha uma carta da Zona Pokémon para ${slotLabel}.`;
  return `Complete a seleção de ${slotLabel}.`;
}

function buildActionCandidatesFromCards(playerId: PlayerId, sourceCardIds: string[]): ActionCandidate[] {
  const owner = playerById(playerId);
  if (!owner || !state) return [] as ActionCandidate[];
  const available = sourceCardIds.filter((id) => owner.hand.includes(id));
  if (available.length !== sourceCardIds.length || !available.length || available.length > 2) return [] as ActionCandidate[];

  if (available.length === 2) {
    const [firstId, secondId] = available;
    const firstCard = cardForInstance(firstId);
    const secondCard = cardForInstance(secondId);
    if (firstCard?.data.cardType !== 'item' || secondCard?.data.cardType !== 'item' || firstId === secondId) return [];
    const result: ActionCandidate[] = [];
    for (const first of itemActionPrograms(playerId, firstId, firstCard)) {
      for (const second of itemActionPrograms(playerId, secondId, secondCard)) {
        result.push({
          action: { kind: 'useItems', itemInstanceIds: [first.itemId, second.itemId], targets: { ...first.targets, ...second.targets } },
          label: `Usar ${first.label} e depois ${second.label}`,
          targetKind: 'list',
        });
      }
    }
    return result;
  }

  const instanceId = available[0]!;
  const card = cardForInstance(instanceId);
  if (!card) return [];
  const ownPokemon = [owner.activePokemonId, ...owner.bench].filter(Boolean) as string[];
  const active = owner.activePokemonId ? state.pokemon[owner.activePokemonId] : undefined;
  const activeCard = active ? pokemonCard(state, cards, active) : undefined;

  if (card.data.cardType === 'pokemon') {
    const pokemonEntry = card.data;
    if (pokemonEntry.stage === 'BÁSICO' && (!owner.activePokemonId || owner.bench.length < 3)) {
      return [{ action: { kind: 'playPokemon' as const, cardInstanceId: instanceId }, label: `Posicionar ${displayCard(instanceId)}`, targetKind: 'none' as const }];
    }
    if (!owner.roundFlags.recoveryActionOnly) {
      const result: ActionCandidate[] = [];
      for (const target of ownPokemon) {
        const targetMon = state!.pokemon[target];
        const targetCard = targetMon ? pokemonCard(state!, cards, targetMon) : undefined;
        if (!targetCard || !isLegalEvolutionUi(targetCard.pokemonName, targetCard.pokemonId, pokemonEntry.previousEvolution, pokemonEntry.form, pokemonEntry.pokemonId)) continue;
        result.push({
          action: { kind: 'playPokemon' as const, cardInstanceId: instanceId, targetPokemonId: target },
          label: `Evoluir ${pokemonDisplayName(state!, cards, target)} para ${displayCard(instanceId)}`,
          targetKind: 'pokemon' as const,
          targetId: target,
        });
      }
      return result;
    }
    return [];
  }

  if (card.data.cardType === 'attack' && !owner.roundFlags.recoveryActionOnly && state.round > 1 && active && activeCard && !active.flags.cannotAttackThisRound && compatibleAttack(activeCard, card.data)) {
    return legalAttackTargets(state, cards, playerId).map((target) => ({
      action: { kind: 'learnAttack' as const, attackInstanceId: instanceId, targetPokemonId: target.pokemonId },
      label: `Usar ${displayCard(instanceId)} em ${target.label}`,
      targetKind: 'pokemon' as const,
      targetId: target.pokemonId,
    }));
  }

  if (card.data.cardType === 'item') {
    return itemActionPrograms(playerId, instanceId, card).map((program) => {
      const [targetId] = Object.values(program.targets);
      const targetKind: CandidateTargetKind = card.id === 'card-pjo-089' || card.id === 'card-pjo-090'
        ? 'pokemon'
        : card.id === 'card-pjo-091'
          ? 'list'
          : card.id === 'card-pjo-092'
            ? 'pile'
            : 'none';
      return {
        action: { kind: 'useItems' as const, itemInstanceIds: [instanceId], targets: program.targets },
        label: program.label,
        targetKind: targetKind as CandidateTargetKind,
        targetId: targetKind === 'list' ? undefined : String(targetId ?? ''),
      };
    });
  }

  if (card.data.cardType === 'stadium' && !owner.roundFlags.recoveryActionOnly) {
    return (['AB', 'BC', 'CD', 'DA'] as StadiumSlotId[]).map((slotId) => ({
      action: { kind: 'placeStadium' as const, stadiumInstanceId: instanceId, slotId },
      label: `Posicionar ${displayCard(instanceId)} em ${slotId}`,
      targetKind: 'stadium' as const,
      targetId: slotId,
    }));
  }

  if (card.data.cardType === 'climate' && !owner.roundFlags.recoveryActionOnly) return [{ action: { kind: 'placeClimate' as const, climateInstanceId: instanceId }, label: `Posicionar ${displayCard(instanceId)}`, targetKind: 'none' as const }];

  if (card.data.cardType === 'tool') {
    return ownPokemon.map((target) => ({
      action: { kind: 'attachTools' as const, toolInstanceIds: [instanceId], targets: { [instanceId]: target } },
      label: `Anexar ${displayCard(instanceId)} em ${pokemonDisplayName(state!, cards, target)}`,
      targetKind: 'pokemon' as const,
      targetId: target,
    }));
  }

  if (card.data.cardType === 'rareItem' && !owner.roundFlags.recoveryActionOnly) return [{ action: { kind: 'useRareItem' as const, rareItemInstanceId: instanceId }, label: `Usar ${displayCard(instanceId)}`, targetKind: 'none' as const }];

  return [];
}

function buildActionCandidatesFromSpecial(playerId: PlayerId, special: SpecialActionKind): ActionCandidate[] {
  const owner = playerById(playerId);
  if (!owner || !state) return [] as ActionCandidate[];
  if (special === 'none') return [{ action: { kind: 'none' as const }, label: 'Não agir', targetKind: 'none' as const }];
  if (special === 'manual') return owner.roundFlags.recoveryActionOnly ? [] : [{ action: { kind: 'manual' as const, note: 'Resolver esta ação manualmente pelo texto da carta/regra.' }, label: 'Resolver manualmente', targetKind: 'none' as const }];
  if (special === 'buyWildcard' && owner.wildcards.draw) {
    return [
      ...(['pokemonA', 'pokemonB', 'trainerA', 'trainerB', 'attackA', 'attackB'] as PhysicalPileId[]).map((pileId) => ({
        action: { kind: 'buyWildcard' as const, pileId },
        label: `Comprar de ${PILE_LABELS[pileId]}`,
        targetKind: 'pile' as const,
        targetId: pileId,
      })),
      ...state.board.pokemonZone.map((zoneInstanceId) => ({
        action: { kind: 'buyWildcard' as const, pileId: 'zone' as const, zoneInstanceId },
        label: `Comprar ${displayCard(zoneInstanceId)} da Zona Pokémon`,
        targetKind: 'zone-card' as const,
        targetId: zoneInstanceId,
      })),
    ];
  }
  if (special === 'switchWildcard' && owner.wildcards.switch && !owner.roundFlags.recoveryActionOnly) {
    return owner.bench.map((benchPokemonId) => ({
      action: { kind: 'switchWildcard' as const, benchPokemonId },
      label: `Trocar com ${pokemonDisplayName(state!, cards, benchPokemonId)}`,
      targetKind: 'pokemon' as const,
      targetId: benchPokemonId,
    }));
  }
  if (special === 'reuseAttack' && owner.wildcards.attack && !owner.roundFlags.recoveryActionOnly && state.round > 1) {
    const active = owner.activePokemonId ? state.pokemon[owner.activePokemonId] : undefined;
    if (!active || active.flags.cannotAttackThisRound) return [];
    const result: ActionCandidate[] = [];
    for (const attack of active.attacks) {
      for (const target of legalAttackTargets(state, cards, playerId)) {
        result.push({
          action: { kind: 'reuseAttack' as const, level: attack.level, targetPokemonId: target.pokemonId },
          label: `Reutilizar N${attack.level} em ${target.label}`,
          targetKind: 'pokemon' as const,
          targetId: target.pokemonId,
        });
      }
    }
    return result;
  }
  return [];
}

function resolveActionCandidates(playerId: PlayerId, slot: ActionSlot, sourceCardIds: string[], specialLabel: string | undefined, candidates: ActionCandidate[]) {
  if (!candidates.length) return;
  if (candidates.length === 1 && candidates[0]!.targetKind === 'none') {
    commitProgrammedAction(playerId, slot, candidates[0]!.action);
    return;
  }
  if (contextualCandidates(candidates)) {
    pendingProgram = {
      playerId,
      slot,
      sourceCardIds,
      specialLabel,
      prompt: contextualPrompt(candidates[0]!.targetKind, slot),
      presentation: 'context',
      candidates,
    };
    render();
    return;
  }
  pendingProgram = {
    playerId,
    slot,
    sourceCardIds,
    specialLabel,
    prompt: `Escolha como usar ${specialLabel ?? sourceCardIds.map(displayCard).join(' + ')}.`,
    presentation: 'list',
    candidates,
  };
  render();
}

function commitProgrammedAction(playerId: PlayerId, slot: ActionSlot, action: ProgrammedAction) {
  if (!state) return;
  if (!programPlayerAction(state, playerId, slot, action)) {
    alert('Essa jogada não é permitida neste momento.');
    return;
  }
  pendingProgram = null;
  const player = playerById(playerId);
  if (player && slot === 'primary' && !player.roundFlags.recoveryActionOnly && !player.programmed.secondary) armedSlot = 'secondary';
  autosave();
  render();
}

function attemptPreparationCardSelection(playerId: PlayerId, slot: ActionSlot, newCardId: string) {
  const player = playerById(playerId);
  if (!player || !player.hand.includes(newCardId)) return;
  const currentSource = pendingProgram?.playerId === playerId && pendingProgram.slot === slot
    ? pendingProgram.sourceCardIds
    : actionSourceCards(slot === 'primary' ? player.programmed.primary : player.programmed.secondary);
  const sourceSets: string[][] = [];
  if (currentSource.length === 1 && currentSource[0] !== newCardId) sourceSets.push([currentSource[0], newCardId]);
  sourceSets.push([newCardId]);
  for (const sourceCardIds of sourceSets) {
    const candidates = buildActionCandidatesFromCards(playerId, sourceCardIds);
    if (!candidates.length) continue;
    selectedHandCardId = newCardId;
    setPreview(newCardId);
    armedSlot = slot;
    resolveActionCandidates(playerId, slot, sourceCardIds, undefined, candidates);
    return;
  }
  alert('Essa carta não tem uma jogada válida para este slot na situação atual.');
}

function choosePendingProgramTarget(targetKind: CandidateTargetKind, targetId: string) {
  if (!pendingProgram) return;
  const candidate = pendingProgram.candidates.find((entry) => entry.targetKind === targetKind && entry.targetId === targetId);
  if (!candidate) return;
  commitProgrammedAction(pendingProgram.playerId, pendingProgram.slot, candidate.action);
}

function specialActionLabel(special: SpecialActionKind) {
  if (special === 'none') return 'Sem ação';
  if (special === 'buyWildcard') return 'Curinga de compra';
  if (special === 'switchWildcard') return 'Curinga de troca';
  if (special === 'reuseAttack') return 'Curinga de ataque';
  return 'Resolução manual';
}

function attemptSpecialAction(playerId: PlayerId, special: SpecialActionKind) {
  const player = playerById(playerId);
  if (!player) return;
  const slot = armedSlot ?? firstOpenSlot(player);
  const candidates = buildActionCandidatesFromSpecial(playerId, special);
  if (!candidates.length) {
    alert('Essa opção extra não está disponível neste momento.');
    return;
  }
  resolveActionCandidates(playerId, slot, [], specialActionLabel(special), candidates);
}

function clearProgrammedSlot(playerId: PlayerId, slot: ActionSlot) {
  const player = playerById(playerId);
  if (!player) return;
  if (pendingProgram?.playerId === playerId && pendingProgram.slot === slot) pendingProgram = null;
  if (slot === 'primary') delete player.programmed.primary;
  if (slot === 'secondary') delete player.programmed.secondary;
  armedSlot = slot;
  autosave();
  render();
}

function buildSupporterCandidates(playerId: PlayerId, supporterId: string): SupporterCandidate[] {
  const owner = playerById(playerId);
  const card = cardForInstance(supporterId);
  if (!owner || !card || card.data.cardType !== 'supporter') return [] as SupporterCandidate[];
  if (card.id === 'card-pjo-093') {
    const result: SupporterCandidate[] = [];
    for (const target of [owner.activePokemonId, ...owner.bench].filter(Boolean) as string[]) {
      result.push({
        choice: { kind: 'useSupporter' as const, supporterInstanceId: supporterId, targetPokemonId: target },
        label: `Nina → ${pokemonDisplayName(state!, cards, target)}`,
        prompt: 'Escolha qual dos seus Pokémon recebe o efeito.',
        targetKind: 'pokemon' as const,
        targetId: target,
      });
    }
    return result;
  }
  if (card.id === 'card-pjo-094') {
    const piles = Object.keys(PILE_LABELS) as PhysicalPileId[];
    const result: SupporterCandidate[] = [];
    for (let a = 0; a < piles.length; a += 1) {
      for (let b = a + 1; b < piles.length; b += 1) {
        result.push({
          choice: { kind: 'useSupporter' as const, supporterInstanceId: supporterId, pileIds: [piles[a]!, piles[b]!] },
          label: `Professor Órion → ${PILE_LABELS[piles[a]!]} + ${PILE_LABELS[piles[b]!]}`,
          targetKind: 'list' as const,
        });
      }
    }
    return result;
  }
  return [{ choice: { kind: 'useSupporter' as const, supporterInstanceId: supporterId }, label: `${displayCard(supporterId)} (manual)`, targetKind: 'none' as const }];
}

function attemptSupporterSelection(playerId: PlayerId, supporterId: string) {
  const candidates = buildSupporterCandidates(playerId, supporterId);
  if (!candidates.length) {
    alert('Esse Apoiador não está disponível neste momento.');
    return;
  }
  selectedSupporterCardId = supporterId;
  setPreview(supporterId);
  if (candidates.length === 1 && candidates[0]!.targetKind === 'none') {
    programSupporter(state!, playerId, candidates[0]!.choice);
    pendingSupporter = null;
    autosave();
    render();
    return;
  }
  if (contextualCandidates(candidates)) {
    pendingSupporter = {
      playerId,
      sourceCardId: supporterId,
      prompt: candidates[0]!.prompt ?? 'Escolha o alvo do Apoiador.',
      presentation: 'context',
      candidates,
    };
    render();
    return;
  }
  pendingSupporter = {
    playerId,
    sourceCardId: supporterId,
    prompt: `Escolha como usar ${displayCard(supporterId)}.`,
    presentation: 'list',
    candidates,
  };
  render();
}

function choosePendingSupporterTarget(targetKind: CandidateTargetKind, targetId: string) {
  if (!pendingSupporter || !state) return;
  const candidate = pendingSupporter.candidates.find((entry) => entry.targetKind === targetKind && entry.targetId === targetId);
  if (!candidate) return;
  programSupporter(state, pendingSupporter.playerId, candidate.choice);
  pendingSupporter = null;
  autosave();
  render();
}

function autosave() {
  if (!state) return;
  try { validateInvariants(state); } catch (error) { console.warn(error); }
  saveGameState(state);
}

function stopTimer() {
  if (timerInterval !== undefined) window.clearInterval(timerInterval);
  timerInterval = undefined;
  timerKey = null;
  timerDeadline = 0;
}

function syncOfficialTimer() {
  if (!state || state.timerMode !== 'official' || state.phase !== 'preparation' || !state.privateTurn?.visible) {
    stopTimer();
    return;
  }
  const current = state.players[state.privateTurn.playerIndex];
  if (!current) {
    stopTimer();
    return;
  }
  const key = `${state.id}:${state.round}:${current.id}:preparation`;
  if (timerKey !== key) {
    if (timerInterval !== undefined) window.clearInterval(timerInterval);
    timerInterval = undefined;
    timerKey = key;
    timerDeadline = Date.now() + officialTimerSeconds(state.round) * 1000;
  }
  const tick = () => {
    const readouts = qa<HTMLElement>('[data-role="timer-readout"]');
    const remaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
    readouts.forEach((node) => { node.textContent = `${remaining}s`; });
    if (remaining > 0 || !state || !state.privateTurn?.visible) return;
    current.programmed.primary ??= { kind: 'none' };
    current.programmed.secondary ??= { kind: 'none' };
    lockProgrammedActions(state, current.id);
    pendingProgram = null;
    selectedHandCardId = null;
    autosave();
    stopTimer();
    render();
  };
  tick();
  if (timerInterval === undefined) timerInterval = window.setInterval(tick, 250);
}

function cleanupDragState() {
  if (dragState?.ghost?.isConnected) dragState.ghost.remove();
  dragState = null;
  clearDropHighlights();
}

function clearDropHighlights() {
  qa<HTMLElement>('[data-slot-drop]').forEach((slot) => slot.classList.remove('is-valid-drop', 'is-invalid-drop'));
}

function updateDragGhostPosition(x: number, y: number) {
  if (!dragState) return;
  dragState.ghost.style.left = `${x}px`;
  dragState.ghost.style.top = `${y}px`;
}

function slotUnderPoint(x: number, y: number) {
  const element = document.elementFromPoint(x, y) as HTMLElement | null;
  return element?.closest<HTMLElement>('[data-slot-drop]') ?? null;
}

function canCardFitSlot(playerId: PlayerId, slot: ActionSlot, cardId: string) {
  const player = playerById(playerId);
  if (!player) return false;
  if (slot === 'secondary' && player.roundFlags.recoveryActionOnly) return false;
  if (buildActionCandidatesFromCards(playerId, [cardId]).length) return true;
  const currentSource = pendingProgram?.playerId === playerId && pendingProgram.slot === slot
    ? pendingProgram.sourceCardIds
    : actionSourceCards(slot === 'primary' ? player.programmed.primary : player.programmed.secondary);
  return currentSource.length === 1 && currentSource[0] !== cardId && buildActionCandidatesFromCards(playerId, [currentSource[0]!, cardId]).length > 0;
}

function updateDropHighlights(x: number, y: number) {
  if (!dragState) return;
  clearDropHighlights();
  const hovered = slotUnderPoint(x, y);
  if (!hovered) {
    dragState.hoveredSlot = null;
    return;
  }
  const slot = hovered.dataset.slotDrop as ActionSlot;
  const valid = canCardFitSlot(dragState.playerId, slot, dragState.cardId);
  hovered.classList.add(valid ? 'is-valid-drop' : 'is-invalid-drop');
  dragState.hoveredSlot = slot;
}

function startDrag(event: PointerEvent, cardId: string, playerId: PlayerId, origin: HTMLElement) {
  if (dragState) cleanupDragState();
  const ghost = document.createElement('div');
  ghost.className = 'journey-drag-ghost';
  ghost.innerHTML = renderCardButton(cardId, 'hand', 'public');
  document.body.append(ghost);
  dragState = {
    cardId,
    playerId,
    pointerId: event.pointerId,
    origin,
    ghost,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    hoveredSlot: null,
  };
  origin.setPointerCapture(event.pointerId);
  updateDragGhostPosition(event.clientX, event.clientY);
}

function finishDrag(event: PointerEvent) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const { moved, cardId, playerId, hoveredSlot } = dragState;
  cleanupDragState();
  if (!moved) return;
  suppressClickUntil = Date.now() + 250;
  if (hoveredSlot) attemptPreparationCardSelection(playerId, hoveredSlot, cardId);
}

root.addEventListener('change', (event) => {
  const target = event.target as HTMLElement;
  if (!target.matches('[name="collection"]')) return;
  const select = target as HTMLSelectElement;
  activeCollection = collections.find((collection) => collection.id === select.value) ?? activeCollection;
  if (activeCollection) cards = createLookup(activeCollection).cards;
  renderMenu();
});

root.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.matches('[data-role="start-form"]')) return;
  event.preventDefault();
  const formData = new FormData(form);
  activeCollection = collections.find((collection) => collection.id === formData.get('collection')) ?? collections[0] ?? null;
  if (!activeCollection) return;
  cards = createLookup(activeCollection).cards;
  const mode = formData.get('mode') === 'official' ? 'official' : 'test';
  const validation = validateFormation(createLookup(activeCollection).collection);
  if (mode === 'official' && Object.values(validation.officialMissing).some((count) => count > 0)) {
    alert('Formação Oficial inválida: ainda há componentes obrigatórios ausentes. Use Formação de Teste ou complete a coleção.');
    return;
  }
  state = createJourneyGame(activeCollection, {
    mode,
    timerMode: formData.get('timer') === 'official' ? 'official' : 'none',
    seed: String(formData.get('seed') || 'AUTO'),
    playerNames: ['player1', 'player2', 'player3', 'player4'].map((name) => String(formData.get(name) || '')),
    selectedLineIds: formData.getAll('line').map(String),
  });
  previewInstanceId = null;
  zoomInstanceId = null;
  logOpen = false;
  debugOpen = false;
  autosave();
  render();
});

root.addEventListener('pointerdown', (event) => {
  if (!state) return;
  const prepPlayer = state.phase === 'preparation' && state.privateTurn?.visible ? currentPreparationPlayer() : undefined;
  if (!prepPlayer) return;
  const handCard = (event.target as Element).closest<HTMLElement>('[data-drag-card-id]');
  if (!handCard?.dataset.dragCardId) return;
  startDrag(event, handCard.dataset.dragCardId, prepPlayer.id, handCard);
});

window.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  updateDragGhostPosition(event.clientX, event.clientY);
  const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
  if (distance > 8) {
    dragState.moved = true;
    dragState.ghost.classList.add('is-visible');
    updateDropHighlights(event.clientX, event.clientY);
  }
});

window.addEventListener('pointerup', finishDrag);
window.addEventListener('pointercancel', finishDrag);

root.addEventListener('click', async (event) => {
  if (Date.now() < suppressClickUntil) return;
  const button = (event.target as Element).closest<HTMLElement>('[data-command]');
  if (!button) return;
  const command = button.dataset.command;

  if (command === 'continue') {
    state = loadGameState();
    activeCollection = collections.find((collection) => collection.id === state?.collectionId) ?? collections[0] ?? null;
    if (activeCollection) cards = createLookup(activeCollection).cards;
    restoredNeedsNeutral = true;
    render();
    return;
  }
  if (command === 'ack-restore') {
    restoredNeedsNeutral = false;
    render();
    return;
  }
  if (command === 'delete-save') {
    clearGameState();
    state = null;
    render();
    return;
  }
  if (!state) return;

  if (command === 'open-card') {
    const instanceId = button.dataset.instanceId;
    if (instanceId) {
      setPreview(instanceId);
      zoomInstanceId = instanceId;
      render();
    }
    return;
  }

  if (command === 'close-zoom') {
    zoomInstanceId = null;
    render();
    return;
  }

  if (command === 'toggle-log') {
    logOpen = !logOpen;
    render();
    return;
  }

  if (command === 'toggle-debug') {
    debugOpen = !debugOpen;
    render();
    return;
  }

  if (command === 'select-hand-card') {
    const prepPlayer = state.phase === 'preparation' && state.privateTurn?.visible ? currentPreparationPlayer() : undefined;
    const instanceId = button.dataset.instanceId;
    if (!prepPlayer || !instanceId) return;
    if (selectedHandCardId === instanceId) {
      zoomInstanceId = instanceId;
    } else {
      selectedHandCardId = instanceId;
      setPreview(instanceId);
      armedSlot ??= firstOpenSlot(prepPlayer);
    }
    render();
    return;
  }

  if (command === 'arm-slot') {
    const prepPlayer = state.phase === 'preparation' && state.privateTurn?.visible ? currentPreparationPlayer() : undefined;
    const slot = button.dataset.slot as ActionSlot;
    if (!prepPlayer || !slot) return;
    if (selectedHandCardId) {
      attemptPreparationCardSelection(prepPlayer.id, slot, selectedHandCardId);
      return;
    }
    armedSlot = slot;
    render();
    return;
  }

  if (command === 'clear-slot') {
    const prepPlayer = state.phase === 'preparation' && state.privateTurn?.visible ? currentPreparationPlayer() : undefined;
    const slot = button.dataset.slot as ActionSlot;
    if (!prepPlayer || !slot) return;
    clearProgrammedSlot(prepPlayer.id, slot);
    return;
  }

  if (command === 'assign-special-action') {
    const prepPlayer = state.phase === 'preparation' && state.privateTurn?.visible ? currentPreparationPlayer() : undefined;
    const special = button.dataset.special as SpecialActionKind;
    if (!prepPlayer || !special) return;
    attemptSpecialAction(prepPlayer.id, special);
    return;
  }

  if (command === 'cancel-pending-program') {
    pendingProgram = null;
    render();
    return;
  }

  if (command === 'choose-context-target') {
    const targetKind = button.dataset.targetKind as CandidateTargetKind;
    const targetId = button.dataset.targetId;
    if (targetKind && targetId) choosePendingProgramTarget(targetKind, targetId);
    return;
  }

  if (command === 'apply-program-candidate' && pendingProgram) {
    const action = decodeValue<ProgrammedAction>(button.dataset.actionJson);
    commitProgrammedAction(pendingProgram.playerId, pendingProgram.slot, action);
    return;
  }

  if (command === 'select-supporter-card') {
    const current = state.phase === 'confrontation' && state.confrontation?.visible ? currentConfrontationPlayer() : undefined;
    const instanceId = button.dataset.instanceId;
    if (!current || !instanceId) return;
    if (selectedSupporterCardId === instanceId) {
      zoomInstanceId = instanceId;
      render();
      return;
    }
    attemptSupporterSelection(current.id, instanceId);
    return;
  }

  if (command === 'cancel-pending-supporter') {
    pendingSupporter = null;
    render();
    return;
  }

  if (command === 'choose-context-supporter') {
    const targetKind = button.dataset.targetKind as CandidateTargetKind;
    const targetId = button.dataset.targetId;
    if (targetKind && targetId) choosePendingSupporterTarget(targetKind, targetId);
    return;
  }

  if (command === 'apply-supporter-candidate' && pendingSupporter) {
    const choice = decodeValue<SupporterProgram>(button.dataset.supporterChoice);
    programSupporter(state, pendingSupporter.playerId, choice);
    pendingSupporter = null;
    autosave();
    render();
    return;
  }

  if (command === 'lock-actions') {
    const current = state.phase === 'preparation' && state.privateTurn?.visible ? currentPreparationPlayer() : undefined;
    if (!current || current.id !== button.dataset.playerId) return;
    if (pendingProgram) {
      alert('Escolha o alvo ou cancele a seleção pendente antes de confirmar.');
      return;
    }
  }

  if (command === 'lock-supporter') {
    const current = state.phase === 'confrontation' && state.confrontation?.visible ? currentConfrontationPlayer() : undefined;
    if (!current || current.id !== button.dataset.playerId) return;
    if (pendingSupporter) {
      alert('Conclua a seleção contextual do Apoiador antes de confirmar.');
      return;
    }
  }

  if (command === 'reveal-initial') setPrivateVisible(state, 'initial', true);
  if (command === 'choose-initial') chooseInitialPokemon(state, cards, button.dataset.playerId as PlayerId, button.dataset.instanceId!);
  if (command === 'reveal-preparation') setPrivateVisible(state, 'preparation', true);
  if (command === 'program-action') programPlayerAction(state, button.dataset.playerId as PlayerId, button.dataset.slot as ActionSlot, decodeValue<ProgrammedAction>(button.dataset.actionJson));
  if (command === 'lock-actions') lockProgrammedActions(state, button.dataset.playerId as PlayerId);
  if (command === 'reveal-actions') revealActions(state);
  if (command === 'reveal-confrontation') setPrivateVisible(state, 'confrontation', true);
  if (command === 'program-supporter') programSupporter(state, button.dataset.playerId as PlayerId, decodeValue<SupporterProgram>(button.dataset.supporterJson));
  if (command === 'lock-supporter') lockSupporterChoice(state, cards, button.dataset.playerId as PlayerId);
  if (command === 'resolve-next') resolveNextAction(state, cards);
  if (command === 'reveal-pending-choice') pendingChoiceVisibleFor = button.dataset.choiceId ?? null;
  if (command === 'resolve-choice') {
    resolvePendingChoice(state, cards, button.dataset.choiceId!, [button.dataset.choiceOption!]);
    pendingChoiceVisibleFor = null;
  }
  if (command === 'resolve-choice-multi') {
    const ids = qa<HTMLInputElement>(`[data-pending-multi="${button.dataset.choiceId}"]:checked`).map((input) => input.value);
    resolvePendingChoice(state, cards, button.dataset.choiceId!, ids);
    pendingChoiceVisibleFor = null;
  }
  if (command === 'free-acquire') performFreeAcquisition(state, button.dataset.playerId as PlayerId, button.dataset.pileId as PhysicalPileId | 'zone', button.dataset.instanceId);
  if (command === 'reveal-acquisition') setPrivateVisible(state, 'acquisition', true);
  if (command === 'reveal-hand-limit') handLimitVisibleFor = button.dataset.playerId as PlayerId;
  if (command === 'apply-hand-limit') {
    const ids = qa<HTMLInputElement>(`[data-discard-limit="${button.dataset.playerId}"]:checked`).map((input) => input.value);
    enforceHandLimit(state, button.dataset.playerId as PlayerId, ids);
    handLimitVisibleFor = null;
  }
  if (command === 'finish-round') {
    advanceAfterHandLimit(state);
    startNextRound(state, cards);
  }
  if (command === 'start-round') startNextRound(state, cards);
  if (command === 'continue-phase' && state.phase === 'order') defineResolutionOrderWithCards(state, cards);
  if (command === 'copy-state') await navigator.clipboard?.writeText(exportGameState(state));
  if (command === 'copy-log') await navigator.clipboard?.writeText(state.log.map((entry) => `R${entry.round} ${phaseLabel(entry.phase)}: ${entry.message}`).join('\n'));
  if (command === 'toggle-piles') state.dev.revealPiles = !state.dev.revealPiles;
  if (command === 'finish-by-points') finishByPoints(state);
  if (command === 'open-import') q<HTMLDialogElement>('[data-role="import-dialog"]')?.showModal();
  if (command === 'close-dialog') q<HTMLDialogElement>('[data-role="import-dialog"]')?.close();
  if (command === 'confirm-import') {
    const imported = importGameState(q<HTMLTextAreaElement>('[data-role="import-json"]')?.value || '');
    state = imported;
    activeCollection = collections.find((collection) => collection.id === imported.collectionId) ?? collections[0] ?? null;
    if (activeCollection) cards = createLookup(activeCollection).cards;
  }
  if (command === 'manual-damage') manualAdjustDamage(state, cards, button.dataset.pokemonId!, Number(button.dataset.delta || 0));
  if (command === 'manual-heal') manualHealDamage(state, cards, button.dataset.pokemonId!, Number(button.dataset.amount || 0));
  if (command === 'manual-stat') manualAdjustModifier(state, cards, button.dataset.pokemonId!, button.dataset.stat as 'offense' | 'defense' | 'speed', Number(button.dataset.delta || 0));
  if (command === 'manual-ko') manualSetKnockedOut(state, cards, button.dataset.pokemonId!, button.dataset.ko === 'true');
  if (command === 'manual-resurrection') manualToggleResurrection(state, cards, button.dataset.pokemonId!);
  if (command === 'manual-remove-effect') manualRemoveEffect(state, cards, button.dataset.pokemonId!, button.dataset.effectId!);
  if (command === 'manual-switch') manualSwitchActive(state, cards, button.dataset.playerId as PlayerId, button.dataset.pokemonId!);
  if (command === 'manual-note') manualLogNote(state, q<HTMLInputElement>('[data-role="manual-note"]')?.value || '');
  if (command === 'manual-points') manualAdjustPoints(state, button.dataset.playerId as PlayerId, Number(button.dataset.delta || 0));

  autosave();
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (zoomInstanceId) {
    zoomInstanceId = null;
    render();
    return;
  }
  if (pendingProgram) {
    pendingProgram = null;
    render();
    return;
  }
  if (pendingSupporter) {
    pendingSupporter = null;
    render();
  }
});

render();
