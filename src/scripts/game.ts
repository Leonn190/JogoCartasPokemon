import { validateFormation } from '../game/setup';
import { createJourneyGame, createLookup, officialTimerSeconds } from '../game/setup';
import {
  PILE_LABELS,
  STADIUM_CONNECTIONS,
  advanceAfterHandLimit,
  chooseInitialPokemon,
  currentSpeed,
  defineResolutionOrderWithCards,
  enforceHandLimit,
  finishByPoints,
  legalAttackTargets,
  lockProgrammedActions,
  lockSupporterChoice,
  manualAdjustDamage,
  manualAdjustModifier,
  manualHealDamage,
  manualLogNote,
  manualRemoveEffect,
  manualAdjustPoints,
  manualSetKnockedOut,
  manualSwitchActive,
  manualToggleResurrection,
  performFreeAcquisition,
  pokemonCard,
  pokemonDisplayName,
  programPlayerAction,
  programSupporter,
  revealActions,
  resolvePendingChoice,
  resolveNextAction,
  setPrivateVisible,
  startNextRound,
  validateInvariants,
  compatibleAttack,
} from '../game/engine';
import { clearGameState, exportGameState, importGameState, loadGameState, saveGameState } from '../game/persistence';
import type { CardCollection, StoredCard } from '../types/card';
import type { ActionSlot, GameState, PhysicalPileId, PlayerId, PokemonInPlay, ProgrammedAction, StadiumSlotId, SupporterProgram } from '../game/types';
import { cardName } from '../game/utils';

const q = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector);
const qa = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(selector));

const root = q<HTMLElement>('[data-role="game-root"]')!;
const baseUrl = document.documentElement.dataset.baseUrl || '/';
const collections = JSON.parse(q<HTMLScriptElement>('#published-collections')?.textContent || '[]') as CardCollection[];
let state: GameState | null = null;
let cards: Record<string, StoredCard> = {};
let activeCollection = collections[0] ?? null;
let restoredNeedsNeutral = false;
let pendingChoiceVisibleFor: string | null = null;
let handLimitVisibleFor: PlayerId | null = null;
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

function cardForInstance(instanceId?: string) {
  if (!state || !instanceId) return undefined;
  const instance = state.instances[instanceId];
  return instance ? cards[instance.cardId] : undefined;
}

function displayCard(instanceId?: string) {
  const card = cardForInstance(instanceId);
  return card ? cardName(card.data) : 'Carta';
}

function pileButtons(prefix = '') {
  const ids: PhysicalPileId[] = ['pokemonA', 'pokemonB', 'trainerA', 'trainerB', 'attackA', 'attackB'];
  return ids.map((id) => `<button class="journey-choice" type="button" ${prefix} data-pile-id="${id}">${PILE_LABELS[id]} <small>${state?.board.piles[id].length ?? 0}</small></button>`).join('');
}

function playerName(playerId: PlayerId) {
  return state?.players.find((player) => player.id === playerId)?.name ?? playerId;
}

function normalizePokemonName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isLegalEvolutionUi(currentName: string, currentPokemonId: number | null, previousEvolution: string, nextForm: string, nextPokemonId: number | null) {
  return normalizePokemonName(previousEvolution) === normalizePokemonName(currentName)
    || (nextForm !== 'Normal' && nextPokemonId !== null && nextPokemonId === currentPokemonId);
}

function render() {
  if (!state) {
    renderMenu();
    return;
  }
  if (restoredNeedsNeutral) {
    root.innerHTML = `<section class="journey-neutral">
      <span class="journey-eyebrow">JORNADA RESTAURADA</span>
      <h1>Partida carregada.</h1>
      <p>A tela privada permanece escondida. Passe o computador para o jogador indicado quando necessário.</p>
      <button class="journey-button primary" type="button" data-command="ack-restore">Continuar com tela neutra</button>
    </section>`;
    return;
  }
  root.innerHTML = `<div class="journey-shell">
    ${renderTopbar()}
    <main class="journey-table">
      ${renderPlayerPanels()}
      ${renderCentralBoard()}
      ${renderPhasePanel()}
      ${renderLog()}
    </main>
  </div>
  <dialog class="journey-dialog" data-role="import-dialog"><div class="journey-dialog-inner"><h3>Importar GameState</h3><textarea data-role="import-json" rows="10"></textarea><div class="journey-dialog-actions"><button class="journey-button" data-command="close-dialog" type="button">Cancelar</button><button class="journey-button primary" data-command="confirm-import" type="button">Importar</button></div></div></dialog>`;
  syncOfficialTimer();
}

function appHref(path: string) {
  return `${baseUrl.replace(/\/?$/, '/')}${path.replace(/^\//, '')}`;
}

function renderMenu() {
  const saved = loadGameState();
  const selected = activeCollection ?? collections[0];
  const validation = selected ? validateFormation(createLookup(selected).collection) : null;
  root.innerHTML = `<section class="journey-menu">
    <div class="journey-menu-copy">
      <span class="journey-eyebrow">CARD FORGE / JORNADA</span>
      <h1>Jogar Jornada</h1>
      <p>Inicie uma partida local para 4 jogadores em modo jogue-e-passe usando as coleções publicadas em <code>public/conteudo</code>.</p>
      <div class="journey-menu-actions">
        ${saved ? '<button class="journey-button primary" type="button" data-command="continue">Continuar Jornada</button><button class="journey-button danger" type="button" data-command="delete-save">Apagar Jornada atual</button>' : ''}
        <a class="journey-button" href="${appHref('/')}">Explorar coleções</a>
      </div>
    </div>
    <form class="journey-start-card" data-role="start-form">
      <label><span>Coleção</span><select name="collection">${collections.map((collection) => `<option value="${escapeHtml(collection.id)}" ${collection.id === selected?.id ? 'selected' : ''}>${escapeHtml(collection.name)}</option>`).join('')}</select></label>
      <label><span>Formação</span><select name="mode"><option value="test" selected>Teste</option><option value="official">Oficial</option></select></label>
      <div class="journey-formation-note">
        <strong>Formação de Teste</strong>
        <p>Permite jogar mesmo sem Campeões, Climas, Ferramentas e outros componentes oficiais.</p>
        ${validation ? `<small>Linhas Básicas: ${validation.lines.length}/24 · Ataques: ${validation.counts.attack}/50 · Itens: ${validation.counts.item}/8 · Apoiadores: ${validation.counts.supporter}/8 · Estádios: ${validation.counts.stadium}/6 · Campeões: ${validation.counts.champion}/5</small>` : ''}
        ${validation ? `<small>Faltas oficiais: ${Object.entries(validation.officialMissing).filter(([, count]) => count > 0).map(([key, count]) => `${key}: ${count}`).join(' · ') || 'nenhuma'}</small>` : ''}
      </div>
      ${validation ? `<details class="journey-line-picker" open><summary>Linhas Pokémon da Jornada</summary><div>${validation.lines.slice(0, 36).map((line, index) => `<label><input type="checkbox" name="line" value="${escapeHtml(line.id)}" ${index < 24 ? 'checked' : ''} /> <span>${escapeHtml(line.name)}</span><small>${line.branches.length ? `ramificações: ${line.branches.map((branch) => branch.map((id) => cardName(cards[id]?.data ?? selected!.cards.find((entry) => entry.id === id)!.data)).join(' / ')).join(' · ')}` : line.cards.map((id) => cardName(cards[id]?.data ?? selected!.cards.find((entry) => entry.id === id)!.data)).join(' → ')}</small></label>`).join('')}</div></details>` : ''}
      <div class="journey-player-grid">
        <label><span>Jogador A</span><input name="player1" value="Jogador 1" /></label>
        <label><span>Jogador B</span><input name="player2" value="Jogador 2" /></label>
        <label><span>Jogador C</span><input name="player3" value="Jogador 3" /></label>
        <label><span>Jogador D</span><input name="player4" value="Jogador 4" /></label>
      </div>
      <label><span>Cronômetro de teste</span><select name="timer"><option value="none" selected>Sem limite</option><option value="official">Oficial</option></select></label>
      <label><span>Seed</span><input name="seed" placeholder="AUTO" /></label>
      <button class="journey-button primary" type="submit">Nova Jornada</button>
    </form>
  </section>`;
}

function renderTopbar() {
  return `<header class="journey-topbar">
    <a class="journey-brand" href="${appHref('/')}"><span>✦</span><strong>Card Forge / Jornada</strong></a>
    <div class="journey-top-stats">
      <span>Rodada <strong>${state!.round}</strong></span>
      <span>Fase <strong>${phaseLabel(state!.phase)}</strong></span>
      <span>Prioridade <strong>${escapeHtml(playerName(state!.priorityPlayerId))}</strong></span>
      <span>Dano Base <strong>+${state!.round >= 8 ? 40 : state!.round >= 6 ? 30 : state!.round >= 4 ? 20 : state!.round >= 2 ? 10 : 0}</strong></span>
      <span>Tempo <strong data-role="timer-readout">${state!.timerMode === 'official' ? `${officialTimerSeconds(state!.round)}s` : 'sem limite'}</strong></span>
    </div>
    <details class="journey-dev">
      <summary>Ferramentas</summary>
      <div class="journey-dev-panel">
        <p>Seed: <strong>${state!.rng.seed}</strong></p>
        <button type="button" data-command="copy-state">Exportar GameState JSON</button>
        <button type="button" data-command="open-import">Importar GameState JSON</button>
        <button type="button" data-command="copy-log">Copiar log</button>
        <button type="button" data-command="toggle-piles">${state!.dev.revealPiles ? 'Ocultar pilhas' : 'Revelar pilhas'}</button>
        <button type="button" data-command="finish-by-points">Encerrar teste e classificar por pontos</button>
        <input data-role="manual-note" placeholder="Nota de teste" />
        <button type="button" data-command="manual-note">Registrar nota</button>
      </div>
    </details>
  </header>`;
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

function renderPlayerPanels() {
  return `<section class="journey-players">${state!.players.map((player, index) => {
    const active = player.activePokemonId ? state!.pokemon[player.activePokemonId] : undefined;
    const activeCard = active ? pokemonCard(state!, cards, active) : undefined;
    return `<article class="journey-player player-${index + 1} ${player.active ? '' : 'is-inactive'}">
      <div class="journey-player-head"><strong>${escapeHtml(player.name)}</strong><span>${player.points} pts</span></div>
      <p class="journey-champion">${escapeHtml(player.championName)}</p>
      <div class="journey-active">${active && activeCard ? renderPokemonMini(active, activeCard, true) : '<em>Sem Ativo válido</em>'}</div>
      <div class="journey-bench">${player.bench.map((id) => {
        const mon = state!.pokemon[id];
        const data = mon ? pokemonCard(state!, cards, mon) : undefined;
        return mon && data ? renderPokemonMini(mon, data, false) : '';
      }).join('') || '<small>Banco vazio</small>'}</div>
      <div class="journey-player-foot"><span>Mão: ${player.hand.length}</span><span>Curingas: ${player.wildcards.attack ? 'A' : '-'} ${player.wildcards.draw ? 'C' : '-'} ${player.wildcards.switch ? 'T' : '-'}</span><span>${player.programmed.locked ? 'Ações travadas' : 'Ações abertas'}</span><button type="button" data-command="manual-points" data-player-id="${player.id}" data-delta="1">+1 pt</button><button type="button" data-command="manual-points" data-player-id="${player.id}" data-delta="-1">-1 pt</button></div>
    </article>`;
  }).join('')}</section>`;
}

function renderPokemonMini(mon: PokemonInPlay, data: NonNullable<ReturnType<typeof pokemonCard>>, big: boolean) {
  const hp = Math.max(0, data.hp - mon.damage);
  const speed = currentSpeed(state!, cards, mon);
  return `<div class="journey-pokemon ${big ? 'is-active' : ''} ${mon.knockedOut ? 'is-ko' : ''}" data-pokemon-id="${mon.pokemonId}">
    <div><strong>${escapeHtml(data.pokemonName)}</strong><span>${escapeHtml(data.form)} · ${escapeHtml(data.type)}</span></div>
    <meter min="0" max="${Math.max(1, data.hp)}" value="${hp}"></meter>
    <small>HP ${hp}/${data.hp} · Dano ${mon.damage} · VEL ${speed}</small>
    <small>ATK ${data.attack + mon.modifiers.offense + mon.temporaryModifiers.offense} · DEF ${data.defense + mon.modifiers.defense + mon.temporaryModifiers.defense} · SP ${data.specialAttack}/${data.specialDefense}</small>
    <small>${mon.attacks.map((slot) => `N${slot.level} ${displayCard(slot.attackInstanceId)} ${slot.state === 'mastered' ? 'Dominado' : 'Aprendido'}`).join(' · ') || 'Sem Ataques aprendidos'}</small>
    <small>${mon.effects.map((effect) => effect.name).join(' · ') || 'Sem efeitos'}</small>
    <div class="journey-mini-tools">
      <button type="button" data-command="manual-damage" data-pokemon-id="${mon.pokemonId}" data-delta="10">+10 dano</button>
      <button type="button" data-command="manual-damage" data-pokemon-id="${mon.pokemonId}" data-delta="-10">-10 dano</button>
      <button type="button" data-command="manual-heal" data-pokemon-id="${mon.pokemonId}" data-amount="30">cura</button>
      <button type="button" data-command="manual-stat" data-pokemon-id="${mon.pokemonId}" data-stat="offense" data-delta="10">+OF</button>
      <button type="button" data-command="manual-stat" data-pokemon-id="${mon.pokemonId}" data-stat="defense" data-delta="10">+RE</button>
      <button type="button" data-command="manual-stat" data-pokemon-id="${mon.pokemonId}" data-stat="speed" data-delta="10">+VE</button>
      <button type="button" data-command="manual-stat" data-pokemon-id="${mon.pokemonId}" data-stat="offense" data-delta="-10">-OF</button>
      <button type="button" data-command="manual-stat" data-pokemon-id="${mon.pokemonId}" data-stat="defense" data-delta="-10">-RE</button>
      <button type="button" data-command="manual-stat" data-pokemon-id="${mon.pokemonId}" data-stat="speed" data-delta="-10">-VE</button>
      <button type="button" data-command="manual-ko" data-pokemon-id="${mon.pokemonId}" data-ko="${mon.knockedOut ? 'false' : 'true'}">${mon.knockedOut ? 'desKO' : 'KO'}</button>
      <button type="button" data-command="manual-resurrection" data-pokemon-id="${mon.pokemonId}">ress</button>
      ${mon.effects.map((effect) => `<button type="button" data-command="manual-remove-effect" data-pokemon-id="${mon.pokemonId}" data-effect-id="${escapeHtml(effect.id)}">rem ${escapeHtml(effect.name)}</button>`).join('')}
      ${big ? '' : `<button type="button" data-command="manual-switch" data-player-id="${mon.ownerId}" data-pokemon-id="${mon.pokemonId}">ativo</button>`}
    </div>
  </div>`;
}

function renderCentralBoard() {
  const pile = (id: PhysicalPileId) => `<button class="journey-pile" type="button" disabled><strong>${PILE_LABELS[id]}</strong><span>${state!.board.piles[id].length} cartas</span>${state!.dev.revealPiles ? `<small>${state!.board.piles[id].slice(0, 3).map(displayCard).join(' / ')}</small>` : ''}</button>`;
  return `<section class="journey-center">
    <div class="journey-piles">${(['pokemonA', 'pokemonB', 'trainerA', 'trainerB', 'attackA', 'attackB'] as PhysicalPileId[]).map(pile).join('')}</div>
    <div class="journey-zone"><h2>Zona Pokémon</h2><div>${state!.board.pokemonZone.map((id) => `<span class="journey-zone-card">${escapeHtml(displayCard(id))}</span>`).join('') || '<span>Vazia</span>'}</div></div>
    <div class="journey-stadiums">${(Object.keys(state!.board.stadiums) as StadiumSlotId[]).map((slot) => {
      const connected = STADIUM_CONNECTIONS[slot].map((i) => state!.players[i]?.name).join(' / ');
      return `<div class="journey-stadium"><strong>${slot}</strong><span>${escapeHtml(displayCard(state!.board.stadiums[slot] ?? undefined))}</span><small>${escapeHtml(connected)}</small></div>`;
    }).join('')}</div>
    <div class="journey-climate"><strong>Clima</strong><span>${state!.board.climate ? escapeHtml(displayCard(state!.board.climate)) : 'Vazio'}</span></div>
  </section>`;
}

function renderPhasePanel() {
  if (state!.pendingChoice) return renderPendingChoice();
  if (state!.phase === 'initialPokemon') return renderInitialChoice();
  if (state!.phase === 'preparation') return renderPreparation();
  if (state!.phase === 'reveal') return renderReveal();
  if (state!.phase === 'confrontation') return renderConfrontation();
  if (state!.phase === 'resolution') return renderResolution();
  if (state!.phase === 'acquisitions') return renderAcquisition();
  if (state!.phase === 'handLimit') return renderHandLimit();
  if (state!.phase === 'roundStart') return `<section class="journey-phase"><h2>Rodada ${state!.round} pronta</h2><button class="journey-button primary" type="button" data-command="start-round">Começar Preparação</button></section>`;
  if (state!.phase === 'gameOver') return `<section class="journey-phase"><h2>Fim de Jogo</h2><p>${state!.ranking.map((id, index) => `${index + 1}º ${playerName(id)}`).join(' · ')}</p></section>`;
  return `<section class="journey-phase"><h2>${phaseLabel(state!.phase)}</h2><button class="journey-button primary" type="button" data-command="continue-phase">Continuar</button></section>`;
}

function renderPendingChoice() {
  const choice = state!.pendingChoice!;
  const ownerName = choice.playerId ? playerName(choice.playerId) : 'jogador responsável';
  if (pendingChoiceVisibleFor !== choice.id) {
    return `<section class="journey-phase private">
      <span class="journey-eyebrow">ESCOLHA PRIVADA</span>
      <h2>Passe para ${escapeHtml(ownerName)}</h2>
      <p>Há uma decisão pendente durante a resolução. As opções só aparecem quando o jogador confirmar.</p>
      <button class="journey-button primary" type="button" data-command="reveal-pending-choice" data-choice-id="${choice.id}">Estou pronto</button>
    </section>`;
  }
  return `<section class="journey-phase private wide">
    <span class="journey-eyebrow">ESCOLHA PRIVADA</span>
    <h2>Passe para ${escapeHtml(ownerName)}</h2>
    <p>${escapeHtml(choice.prompt)}</p>
    ${choice.kind === 'discard' && choice.data?.multi
      ? `<div class="journey-hand">${choice.options.map((option) => `<label class="journey-hand-card"><input type="checkbox" value="${escapeHtml(option.id)}" data-pending-multi="${choice.id}" ${option.disabled ? 'disabled' : ''} /> <strong>${escapeHtml(option.label)}</strong></label>`).join('')}</div><button class="journey-button primary full" type="button" data-command="resolve-choice-multi" data-choice-id="${choice.id}">Confirmar escolha</button>`
      : `<div class="journey-action-list">
        ${choice.options.map((option) => `<button type="button" data-command="resolve-choice" data-choice-id="${choice.id}" data-choice-option="${escapeHtml(option.id)}" ${option.disabled ? 'disabled' : ''}>${escapeHtml(option.label)}</button>`).join('')}
      </div>`}
  </section>`;
}

function renderInitialChoice() {
  const choice = state!.initialChoice!;
  const current = state!.players[choice.playerIndex]!;
  if (!choice.visible) {
    return `<section class="journey-phase private"><span class="journey-eyebrow">ESCOLHA PRIVADA</span><h2>Passe o computador para ${escapeHtml(current.name)}</h2><p>Escolha exatamente 1 Pokémon Básico Comum ou Incomum. As outras cartas voltam à reserva.</p><button class="journey-button primary" type="button" data-command="reveal-initial">Estou pronto</button></section>`;
  }
  return `<section class="journey-phase private"><h2>${escapeHtml(current.name)}, escolha seu Pokémon inicial</h2><div class="journey-hand">${choice.options.map((id) => {
    const card = cardForInstance(id);
    const valid = card?.data.cardType === 'pokemon' && card.data.stage === 'BÁSICO' && ['common', 'uncommon'].includes(card.data.rarity);
    return `<button class="journey-hand-card" type="button" data-command="choose-initial" data-player-id="${current.id}" data-instance-id="${id}" ${valid ? '' : 'disabled'}><strong>${escapeHtml(displayCard(id))}</strong><small>${card?.data.cardType === 'pokemon' ? `${card.data.stage} · ${card.data.rarity}` : ''}</small></button>`;
  }).join('')}</div></section>`;
}

function renderPreparation() {
  const turn = state!.privateTurn!;
  const current = state!.players[turn.playerIndex]!;
  if (!turn.visible) {
    return `<section class="journey-phase private"><span class="journey-eyebrow">TURNO DE PROGRAMAÇÃO</span><h2>Passe o computador para ${escapeHtml(current.name)}</h2><p>Rodada ${state!.round}. ${state!.timerMode === 'none' ? `Sem limite no teste; tempo oficial seria ${officialTimerSeconds(state!.round)}s.` : `Tempo oficial: ${officialTimerSeconds(state!.round)}s.`}</p><button class="journey-button primary" type="button" data-command="reveal-preparation">Revelar minha mão</button></section>`;
  }
  return `<section class="journey-phase private wide"><h2>${escapeHtml(current.name)} está programando</h2><p>Escolha 1 Ação Principal e 1 Ação Secundária. Ataques estão bloqueados na Rodada 1.</p>
    <div class="journey-private-layout">
      <div><h3>Mão</h3>${renderPrivateHand(current.id)}</div>
      <div>${renderActionChooser(current.id, 'primary')}${renderActionChooser(current.id, 'secondary')}<button class="journey-button primary full" type="button" data-command="lock-actions" data-player-id="${current.id}">Travar ações</button></div>
    </div>
  </section>`;
}

function renderPrivateHand(playerId: PlayerId) {
  const owner = state!.players.find((item) => item.id === playerId)!;
  return `<div class="journey-hand">${owner.hand.map((id) => {
    const card = cardForInstance(id);
    return `<div class="journey-hand-card"><strong>${escapeHtml(displayCard(id))}</strong><small>${escapeHtml(card?.data.cardType ?? '')}</small></div>`;
  }).join('') || '<p>Mão vazia.</p>'}</div>`;
}

function renderActionChooser(playerId: PlayerId, slot: ActionSlot) {
  const owner = state!.players.find((item) => item.id === playerId)!;
  const selected = slot === 'primary' ? owner.programmed.primary : owner.programmed.secondary;
  return `<section class="journey-action-box"><h3>${slot === 'primary' ? 'Ação Principal' : 'Ação Secundária'}</h3><p>Selecionado: <strong>${selected ? actionLabel(selected) : 'Nada'}</strong></p><div class="journey-action-list">${actionButtons(playerId, slot)}</div></section>`;
}

function actionButtons(playerId: PlayerId, slot: ActionSlot) {
  const owner = state!.players.find((item) => item.id === playerId)!;
  if (owner.roundFlags.recoveryActionOnly && slot === 'secondary') {
    return `<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'none' })}">Não agir</button>`;
  }
  const buttons: string[] = [`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'none' })}">Não agir</button>`];
  for (const pileId of Object.keys(PILE_LABELS) as PhysicalPileId[]) {
    if (!owner.wildcards.draw) continue;
    buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'buyWildcard', pileId })}">Comprar via Curinga: ${PILE_LABELS[pileId]}</button>`);
  }
  if (owner.wildcards.draw) for (const zoneId of state!.board.pokemonZone) buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'buyWildcard', pileId: 'zone', zoneInstanceId: zoneId })}">Comprar via Curinga: Zona (${displayCard(zoneId)})</button>`);
  if (!owner.roundFlags.recoveryActionOnly && owner.wildcards.switch) for (const benchId of owner.bench) buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'switchWildcard', benchPokemonId: benchId })}">Trocar via Curinga: ${pokemonDisplayName(state!, cards, benchId)}</button>`);

  const ownPokemon = [owner.activePokemonId, ...owner.bench].filter(Boolean) as string[];
  const active = owner.activePokemonId ? state!.pokemon[owner.activePokemonId] : undefined;
  const activeCard = active ? pokemonCard(state!, cards, active) : undefined;
  for (const id of owner.hand) {
    const card = cardForInstance(id);
    if (!card) continue;
    if (card.data.cardType === 'pokemon') {
      if (card.data.stage === 'BÁSICO' && (!owner.activePokemonId || owner.bench.length < 3)) buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'playPokemon', cardInstanceId: id })}">Posicionar ${displayCard(id)}</button>`);
      else if (!owner.roundFlags.recoveryActionOnly) for (const target of ownPokemon) {
        const targetMon = state!.pokemon[target];
        const targetCard = targetMon ? pokemonCard(state!, cards, targetMon) : undefined;
        if (targetCard && isLegalEvolutionUi(targetCard.pokemonName, targetCard.pokemonId, card.data.previousEvolution, card.data.form, card.data.pokemonId)) {
          buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'playPokemon', cardInstanceId: id, targetPokemonId: target })}">Evoluir ${pokemonDisplayName(state!, cards, target)} para ${displayCard(id)}</button>`);
        }
      }
    }
    if (!owner.roundFlags.recoveryActionOnly && card.data.cardType === 'attack' && state!.round > 1 && active && activeCard && !active.flags.cannotAttackThisRound && compatibleAttack(activeCard, card.data)) {
      for (const target of legalAttackTargets(state!, cards, playerId)) buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'learnAttack', attackInstanceId: id, targetPokemonId: target.pokemonId })}">Usar novo Ataque ${displayCard(id)} → ${target.label}</button>`);
    }
    if (card.data.cardType === 'item') {
      buttons.push(...itemActionButtons(playerId, slot, id, card));
    }
    if (!owner.roundFlags.recoveryActionOnly && card.data.cardType === 'stadium') {
      for (const stadiumSlot of ['AB', 'BC', 'CD', 'DA'] as StadiumSlotId[]) buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'placeStadium', stadiumInstanceId: id, slotId: stadiumSlot })}">Posicionar ${displayCard(id)} em ${stadiumSlot}</button>`);
    }
    if (!owner.roundFlags.recoveryActionOnly && card.data.cardType === 'climate') {
      buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'placeClimate', climateInstanceId: id })}">Posicionar Clima ${displayCard(id)}</button>`);
    }
    if (card.data.cardType === 'tool') {
      for (const target of ownPokemon) buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'attachTools', toolInstanceIds: [id], targets: { [id]: target } })}">Anexar Ferramenta ${displayCard(id)} → ${pokemonDisplayName(state!, cards, target)}</button>`);
    }
    if (card.data.cardType === 'rareItem' && !owner.roundFlags.recoveryActionOnly) {
      buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'useRareItem', rareItemInstanceId: id })}">Usar Item Raro ${displayCard(id)}</button>`);
    }
  }
  const itemPrograms = owner.hand.flatMap((id) => {
    const card = cardForInstance(id);
    return card?.data.cardType === 'item' ? itemActionPrograms(playerId, id, card) : [];
  });
  for (const first of itemPrograms) {
    for (const second of itemPrograms) {
      if (first.itemId === second.itemId) continue;
      buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'useItems', itemInstanceIds: [first.itemId, second.itemId], targets: { ...first.targets, ...second.targets } })}">Usar 2 Itens: ${first.label} depois ${second.label}</button>`);
    }
  }
  if (!owner.roundFlags.recoveryActionOnly && active && state!.round > 1 && !active.flags.cannotAttackThisRound && owner.wildcards.attack) {
    for (const attack of active.attacks) {
      for (const target of legalAttackTargets(state!, cards, playerId)) buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'reuseAttack', level: attack.level, targetPokemonId: target.pokemonId })}">Reutilizar N${attack.level} via Curinga → ${target.label}</button>`);
    }
  }
  buttons.push(`<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'manual', note: 'Resolver esta ação manualmente pelo texto da carta/regra.' })}">Resolver manualmente</button>`);
  return buttons.join('');
}

function itemActionButtons(playerId: PlayerId, slot: ActionSlot, itemId: string, card: StoredCard) {
  return itemActionPrograms(playerId, itemId, card)
    .map((program) => `<button type="button" data-command="program-action" data-player-id="${playerId}" data-slot="${slot}" data-action-json="${encodeAction({ kind: 'useItems', itemInstanceIds: [itemId], targets: program.targets })}">${program.label}</button>`);
}

function itemActionPrograms(playerId: PlayerId, itemId: string, card: StoredCard) {
  const owner = state!.players.find((item) => item.id === playerId)!;
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

function actionLabel(action: ProgrammedAction) {
  if (action.kind === 'none') return 'Não agir';
  if (action.kind === 'learnAttack') return `Ataque novo ${displayCard(action.attackInstanceId)}`;
  if (action.kind === 'reuseAttack') return `Curinga de Ataque N${action.level}`;
  if (action.kind === 'playPokemon') return `Posicionar ${displayCard(action.cardInstanceId)}`;
  if (action.kind === 'useItems') return `Item ${action.itemInstanceIds.map(displayCard).join(' + ')}`;
  if (action.kind === 'attachTools') return `Ferramenta ${action.toolInstanceIds.map(displayCard).join(' + ')}`;
  if (action.kind === 'useRareItem') return `Item Raro ${displayCard(action.rareItemInstanceId)}`;
  if (action.kind === 'placeStadium') return `Estádio ${displayCard(action.stadiumInstanceId)} em ${action.slotId}`;
  if (action.kind === 'placeClimate') return `Clima ${displayCard(action.climateInstanceId)}`;
  if (action.kind === 'buyWildcard') return `Curinga de Compra ${action.pileId}`;
  if (action.kind === 'switchWildcard') return `Curinga de Troca`;
  return 'Manual';
}

function renderReveal() {
  return `<section class="journey-phase"><h2>Todos os jogadores concluíram</h2><div class="journey-reveal-grid">${state!.players.map((player) => `<div><strong>${escapeHtml(player.name)}</strong><span>Principal: ${player.programmed.primary ? actionLabel(player.programmed.primary) : 'Nada'}</span><span>Secundária: ${player.programmed.secondary ? actionLabel(player.programmed.secondary) : 'Nada'}</span></div>`).join('')}</div><button class="journey-button primary" type="button" data-command="reveal-actions">Revelar ações e ir ao Confronto</button></section>`;
}

function renderConfrontation() {
  const turn = state!.confrontation!;
  const current = state!.players[turn.playerIndex]!;
  if (!turn.visible) return `<section class="journey-phase private"><span class="journey-eyebrow">CONFRONTO</span><h2>Passe para ${escapeHtml(current.name)}</h2><p>Escolha secretamente até 1 Apoiador.</p><button class="journey-button primary" type="button" data-command="reveal-confrontation">Estou pronto</button></section>`;
  const supporters = current.hand.filter((id) => cardForInstance(id)?.data.cardType === 'supporter');
  return `<section class="journey-phase private wide"><h2>${escapeHtml(current.name)}: Apoiador</h2><div class="journey-action-list"><button type="button" data-command="program-supporter" data-player-id="${current.id}" data-supporter-json="${encodeAction({ kind: 'none' })}">Não usar Apoiador</button>${supporters.flatMap((id) => supporterButtons(current.id, id)).join('')}</div><p>Selecionado: ${supporterLabel(current.supporterChoice)}</p><button class="journey-button primary" type="button" data-command="lock-supporter" data-player-id="${current.id}">Travar Apoiador</button></section>`;
}

function supporterButtons(playerId: PlayerId, supporterId: string) {
  const card = cardForInstance(supporterId);
  const owner = state!.players.find((entry) => entry.id === playerId)!;
  if (card?.id === 'card-pjo-093') {
    return [owner.activePokemonId, ...owner.bench].filter(Boolean).map((target) => `<button type="button" data-command="program-supporter" data-player-id="${playerId}" data-supporter-json="${encodeAction({ kind: 'useSupporter', supporterInstanceId: supporterId, targetPokemonId: target })}">Nina → ${pokemonDisplayName(state!, cards, target)}</button>`);
  }
  if (card?.id === 'card-pjo-094') {
    const piles = Object.keys(PILE_LABELS) as PhysicalPileId[];
    const buttons: string[] = [];
    for (let a = 0; a < piles.length; a += 1) {
      for (let b = a + 1; b < piles.length; b += 1) {
        buttons.push(`<button type="button" data-command="program-supporter" data-player-id="${playerId}" data-supporter-json="${encodeAction({ kind: 'useSupporter', supporterInstanceId: supporterId, pileIds: [piles[a], piles[b]] })}">Professor Órion → ${PILE_LABELS[piles[a]!]} + ${PILE_LABELS[piles[b]!]}</button>`);
      }
    }
    return buttons;
  }
  return [`<button type="button" data-command="program-supporter" data-player-id="${playerId}" data-supporter-json="${encodeAction({ kind: 'useSupporter', supporterInstanceId: supporterId })}">${displayCard(supporterId)} (manual)</button>`];
}

function supporterLabel(choice?: SupporterProgram) {
  if (!choice || choice.kind === 'none') return 'Nenhum';
  return displayCard(choice.supporterInstanceId);
}

function renderResolution() {
  const step = state!.resolution!;
  const current = step.order[step.index];
  return `<section class="journey-phase"><h2>Resolução</h2><p>Ordem travada: ${step.order.map(playerName).join(' → ')}</p><p>Agora: <strong>${current ? `${playerName(current)} (${step.slot === 'primary' ? 'Principal' : 'Secundária'})` : 'fim'}</strong></p><button class="journey-button primary" type="button" data-command="resolve-next">Resolver próxima ação</button></section>`;
}

function renderAcquisition() {
  const turn = state!.acquisition!;
  const order = turn.order ?? state!.players.filter((player) => player.active).map((player) => player.id);
  const current = state!.players.find((player) => player.id === order[turn.playerIndex])!;
  if (!turn.visible) return `<section class="journey-phase private"><span class="journey-eyebrow">AQUISIÇÃO GRATUITA</span><h2>Passe para ${escapeHtml(current.name)}</h2><button class="journey-button primary" type="button" data-command="reveal-acquisition">Estou pronto</button></section>`;
  return `<section class="journey-phase private"><h2>${escapeHtml(current.name)}: escolha uma aquisição</h2><div class="journey-action-list">${pileButtons('data-command="free-acquire" data-player-id="' + current.id + '"')}${state!.board.pokemonZone.map((id) => `<button type="button" data-command="free-acquire" data-player-id="${current.id}" data-pile-id="zone" data-instance-id="${id}">Zona: ${displayCard(id)}</button>`).join('')}</div></section>`;
}

function renderHandLimit() {
  const over = state!.players.find((player) => player.hand.length > 12);
  if (!over) return `<section class="journey-phase"><h2>Limite de mão ok</h2><button class="journey-button primary" type="button" data-command="finish-round">Avançar Rodada</button></section>`;
  const needed = over.hand.length - 12;
  if (handLimitVisibleFor !== over.id) return `<section class="journey-phase private"><span class="journey-eyebrow">LIMITE DE MÃO</span><h2>Passe para ${escapeHtml(over.name)}</h2><p>Este jogador precisa descartar ${needed} carta(s).</p><button class="journey-button primary" type="button" data-command="reveal-hand-limit" data-player-id="${over.id}">Estou pronto</button></section>`;
  return `<section class="journey-phase private wide"><h2>${escapeHtml(over.name)} excedeu 12 cartas</h2><p>Selecione ${needed} carta(s) para descartar.</p><div class="journey-hand">${over.hand.map((id) => `<label class="journey-hand-card"><input type="checkbox" value="${id}" data-discard-limit="${over.id}" /> <strong>${displayCard(id)}</strong></label>`).join('')}</div><button class="journey-button primary" type="button" data-command="apply-hand-limit" data-player-id="${over.id}">Aplicar limite</button></section>`;
}

function renderLog() {
  const visible = state!.log.filter((entry) => !entry.privateFor);
  return `<aside class="journey-log"><h2>Log</h2>${visible.slice(-80).reverse().map((entry) => `<p><small>R${entry.round} · ${phaseLabel(entry.phase)}</small>${escapeHtml(entry.message)}</p>`).join('')}</aside>`;
}

function autosave() {
  if (state) {
    try { validateInvariants(state); } catch (error) { console.warn(error); }
    saveGameState(state);
  }
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
    const readout = q<HTMLElement>('[data-role="timer-readout"]');
    const remaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
    if (readout) readout.textContent = `${remaining}s`;
    if (remaining > 0 || !state || !state.privateTurn?.visible) return;
    current.programmed.primary ??= { kind: 'none' };
    current.programmed.secondary ??= { kind: 'none' };
    lockProgrammedActions(state, current.id);
    autosave();
    stopTimer();
    render();
  };
  tick();
  if (timerInterval === undefined) timerInterval = window.setInterval(tick, 250);
}

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
  const selectedLineIds = formData.getAll('line').map(String);
  state = createJourneyGame(activeCollection, {
    mode,
    timerMode: formData.get('timer') === 'official' ? 'official' : 'none',
    seed: String(formData.get('seed') || 'AUTO'),
    playerNames: ['player1', 'player2', 'player3', 'player4'].map((name) => String(formData.get(name) || '')),
    selectedLineIds,
  });
  autosave();
  render();
});

root.addEventListener('click', async (event) => {
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
  if (command === 'ack-restore') { restoredNeedsNeutral = false; render(); return; }
  if (command === 'delete-save') { clearGameState(); state = null; render(); return; }
  if (!state) return;
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
  if (command === 'finish-round') { advanceAfterHandLimit(state); startNextRound(state, cards); }
  if (command === 'start-round') startNextRound(state, cards);
  if (command === 'continue-phase' && state.phase === 'order') defineResolutionOrderWithCards(state, cards);
  if (command === 'copy-state') await navigator.clipboard?.writeText(exportGameState(state));
  if (command === 'copy-log') await navigator.clipboard?.writeText(state.log.map((entry) => `R${entry.round} ${phaseLabel(entry.phase)}: ${entry.message}`).join('\n'));
  if (command === 'toggle-piles') state.dev.revealPiles = !state.dev.revealPiles;
  if (command === 'finish-by-points') {
    finishByPoints(state);
  }
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

q<HTMLSelectElement>('[name="collection"]', root)?.addEventListener('change', (event) => {
  activeCollection = collections.find((collection) => collection.id === (event.target as HTMLSelectElement).value) ?? activeCollection;
  renderMenu();
});

render();
