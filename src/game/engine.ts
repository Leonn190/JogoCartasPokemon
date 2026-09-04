import type { AttackCardData, PokemonCardData, StoredCard } from '../types/card';
import { calculateDamage, isKnockedOut, knockoutPointValue, pokemonHpRemaining } from './damage';
import { drawFromPhysicalPile, prepareInitialOptions, returnToPokemonReserve } from './setup';
import type {
  ActionSlot,
  GameState,
  PhysicalPileId,
  PlayerId,
  PokemonEffectState,
  PokemonInPlay,
  ProgrammedAction,
  StadiumSlotId,
  SupporterProgram,
} from './types';
import { activePlayerIds, addLog, cardName, instanceName, nextActivePlayerId, rollD6, shuffleInPlace } from './utils';

export const PILE_LABELS: Record<PhysicalPileId, string> = {
  pokemonA: 'Pilha Pokémon A',
  pokemonB: 'Pilha Pokémon B',
  trainerA: 'Pilha Treinador A',
  trainerB: 'Pilha Treinador B',
  attackA: 'Pilha Ataque A',
  attackB: 'Pilha Ataque B',
};

export const STADIUM_CONNECTIONS: Record<StadiumSlotId, [number, number]> = {
  AB: [0, 1],
  BC: [1, 2],
  CD: [2, 3],
  DA: [3, 0],
};

function player(state: GameState, playerId: PlayerId) {
  const found = state.players.find((item) => item.id === playerId);
  if (!found) throw new Error(`Jogador inexistente: ${playerId}`);
  return found;
}

function cardForInstance(state: GameState, cards: Record<string, StoredCard>, instanceId?: string) {
  if (!instanceId) return undefined;
  const instance = state.instances[instanceId];
  return instance ? cards[instance.cardId] : undefined;
}

export function pokemonCard(state: GameState, cards: Record<string, StoredCard>, pokemon: PokemonInPlay) {
  const card = cardForInstance(state, cards, pokemon.currentCardInstanceId);
  return card?.data.cardType === 'pokemon' ? card.data : undefined;
}

export function attackCard(state: GameState, cards: Record<string, StoredCard>, instanceId?: string) {
  const card = cardForInstance(state, cards, instanceId);
  return card?.data.cardType === 'attack' ? card.data : undefined;
}

function activePokemon(state: GameState, playerId: PlayerId) {
  const id = player(state, playerId).activePokemonId;
  return id ? state.pokemon[id] : undefined;
}

export function pokemonDisplayName(state: GameState, cards: Record<string, StoredCard>, pokemonId?: string) {
  const pokemon = pokemonId ? state.pokemon[pokemonId] : undefined;
  const data = pokemon ? pokemonCard(state, cards, pokemon) : undefined;
  return data ? cardName(data) : 'Pokémon';
}

export function currentSpeed(state: GameState, cards: Record<string, StoredCard>, pokemon: PokemonInPlay) {
  const data = pokemonCard(state, cards, pokemon);
  if (!data) return 0;
  let speed = data.speed + pokemon.modifiers.speed + pokemon.temporaryModifiers.speed;
  for (const slot of Object.keys(state.board.stadiums) as StadiumSlotId[]) {
    const stadium = cardForInstance(state, cards, state.board.stadiums[slot] ?? undefined);
    if (stadium?.id !== 'card-pjo-095') continue;
    const [a, b] = STADIUM_CONNECTIONS[slot];
    const connected = [state.players[a]?.id, state.players[b]?.id];
    if (connected.includes(pokemon.ownerId)) speed += 20;
  }
  return speed;
}

export function legalAttackTargets(state: GameState, cards: Record<string, StoredCard>, attackerId: PlayerId) {
  const attacker = activePokemon(state, attackerId);
  const attackerCard = attacker ? pokemonCard(state, cards, attacker) : undefined;
  const targets: Array<{ pokemonId: string; label: string }> = [];
  for (const targetPlayer of state.players) {
    if (!targetPlayer.active || targetPlayer.id === attackerId) continue;
    const activeId = targetPlayer.activePokemonId;
    if (activeId && !state.pokemon[activeId]?.knockedOut) targets.push({ pokemonId: activeId, label: `${targetPlayer.name}: ${pokemonDisplayName(state, cards, activeId)} Ativo` });
    const canHitBench = attackerCard?.pokemonName === 'Fearow';
    if (canHitBench) {
      for (const benchId of targetPlayer.bench) {
        const bench = state.pokemon[benchId];
        const benchCard = bench ? pokemonCard(state, cards, bench) : undefined;
        if (!bench || !benchCard || bench.knockedOut) continue;
        const remaining = pokemonHpRemaining(bench, benchCard);
        const exRule = attackerCard.form === 'EX' ? bench.damage >= 30 : remaining <= 30;
        if (exRule) targets.push({ pokemonId: benchId, label: `${targetPlayer.name}: ${benchCard.pokemonName} no Banco` });
      }
    }
  }
  return targets;
}

export function compatibleAttack(pokemon: PokemonCardData, attack: AttackCardData) {
  if (attack.compatibilityMode === 'type') return pokemon.type === attack.compatibleType;
  return attack.compatiblePokemon.some((entry) => entry.id === pokemon.pokemonId || entry.name.toLowerCase() === pokemon.pokemonName.toLowerCase());
}

function removeFromHand(state: GameState, playerId: PlayerId, instanceId: string) {
  const owner = player(state, playerId);
  const index = owner.hand.indexOf(instanceId);
  if (index < 0) return false;
  owner.hand.splice(index, 1);
  const instance = state.instances[instanceId];
  if (instance) {
    instance.controllerId = playerId;
    instance.lastControllerId = playerId;
  }
  return true;
}

function discardInstance(state: GameState, instanceId: string, playerId: PlayerId, cause: string, origin = 'jogo') {
  const instance = state.instances[instanceId];
  if (!instance) return;
  instance.lastControllerId = playerId;
  delete instance.controllerId;
  state.board.discard.push({ instanceId, lastControllerId: playerId, origin, cause });
}

function drawToHand(state: GameState, playerId: PlayerId, pileId: PhysicalPileId) {
  const id = drawFromPhysicalPile(state, pileId);
  if (!id) return false;
  const instance = state.instances[id];
  if (instance) {
    instance.controllerId = playerId;
    instance.lastControllerId = playerId;
  }
  player(state, playerId).hand.push(id);
  return true;
}

function drawPokemonToHand(state: GameState, playerId: PlayerId) {
  return drawToHand(state, playerId, state.board.piles.pokemonA.length >= state.board.piles.pokemonB.length ? 'pokemonA' : 'pokemonB');
}

function createPokemonInPlay(state: GameState, playerId: PlayerId, instanceId: string) {
  const pokemonId = `pokemon-${instanceId}`;
  state.instances[instanceId]!.controllerId = playerId;
  state.instances[instanceId]!.lastControllerId = playerId;
  state.pokemon[pokemonId] = {
    pokemonId,
    ownerId: playerId,
    currentCardInstanceId: instanceId,
    evolutionStack: [instanceId],
    damage: 0,
    modifiers: { offense: 0, defense: 0, speed: 0 },
    temporaryModifiers: { offense: 0, defense: 0, speed: 0 },
    effects: [],
    attacks: [],
    evolvedThisRound: false,
    attackedThisRound: false,
    resurrectionUsed: false,
    knockoutCount: 0,
    knockedOut: false,
    flags: {},
  };
  return state.pokemon[pokemonId]!;
}

export function chooseInitialPokemon(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, instanceId: string) {
  const choice = state.initialChoice;
  if (!choice) return false;
  const current = state.players[choice.playerIndex];
  if (!current || current.id !== playerId || !choice.options.includes(instanceId)) return false;
  const chosenCard = cardForInstance(state, cards, instanceId);
  if (chosenCard?.data.cardType !== 'pokemon' || chosenCard.data.stage !== 'BÁSICO' || !['common', 'uncommon'].includes(chosenCard.data.rarity)) {
    addLog(state, 'Escolha inicial inválida: selecione um Pokémon Básico Comum ou Incomum.', playerId);
    return false;
  }
  const pokemon = createPokemonInPlay(state, playerId, instanceId);
  current.activePokemonId = pokemon.pokemonId;
  returnToPokemonReserve(state, choice.options.filter((id) => id !== instanceId));
  addLog(state, `${current.name} escolheu seu Pokémon inicial.`, playerId);

  drawPokemonToHand(state, playerId);
  drawToHand(state, playerId, 'attackA') || drawToHand(state, playerId, 'attackB');
  drawToHand(state, playerId, 'trainerA') || drawToHand(state, playerId, 'trainerB');
  addLog(state, 'Campeão de Teste comprou 1 Pokémon, 1 Ataque e 1 Treinador.', playerId);

  choice.playerIndex += 1;
  choice.visible = false;
  if (choice.playerIndex >= state.players.length) {
    delete state.initialChoice;
    while (state.board.pokemonZone.length < 3) {
      const id = drawPokemonReserveForZone(state);
      if (!id) break;
      state.board.pokemonZone.push(id);
    }
    state.status = 'playing';
    beginRound(state, cards);
  } else {
    choice.options = [];
    choice.mulligans = 0;
    prepareInitialOptions(state, cards);
  }
  return true;
}

function drawPokemonReserveForZone(state: GameState) {
  const id = state.board.piles.pokemonA.length >= state.board.piles.pokemonB.length
    ? state.board.piles.pokemonA.shift()
    : state.board.piles.pokemonB.shift();
  return id;
}

export function beginRound(state: GameState, cards: Record<string, StoredCard>) {
  state.phase = 'roundStart';
  state.status = 'playing';
  for (const pokemon of Object.values(state.pokemon)) {
    pokemon.temporaryModifiers = { offense: 0, defense: 0, speed: 0 };
    pokemon.evolvedThisRound = false;
    pokemon.attackedThisRound = false;
    pokemon.flags = { ...pokemon.flags, attackedOnceThisRound: false, damagedByAttackThisRound: false, startedRoundWithoutDamage: pokemon.damage === 0 };
  }
  for (const entry of state.players) {
    entry.wildcards = { attack: true, draw: true, switch: true };
    entry.programmed = { locked: false };
    entry.supporterChoice = undefined;
    entry.roundFlags = { supporterUsed: false, firstAttackUsed: false, drawBlocked: false };
  }
  for (const pokemon of Object.values(state.pokemon)) {
    const data = pokemonCard(state, cards, pokemon);
    if (!data) continue;
    if (data.pokemonName === 'Lucario' && data.form === 'Mega' && activePokemon(state, pokemon.ownerId)?.pokemonId === pokemon.pokemonId) {
      pokemon.modifiers.offense += 10;
      addLog(state, `Mega Lucario recebeu +10 Ofensividade no início da Rodada.`);
    }
  }
  addLog(state, `Rodada ${state.round} iniciada.`);
  state.phase = 'preparation';
  state.privateTurn = { playerIndex: 0, visible: false };
}

export function setPrivateVisible(state: GameState, area: 'initial' | 'preparation' | 'confrontation' | 'acquisition', visible: boolean) {
  if (area === 'initial' && state.initialChoice) state.initialChoice.visible = visible;
  if (area === 'preparation' && state.privateTurn) state.privateTurn.visible = visible;
  if (area === 'confrontation' && state.confrontation) state.confrontation.visible = visible;
  if (area === 'acquisition' && state.acquisition) state.acquisition.visible = visible;
}

export function programPlayerAction(state: GameState, playerId: PlayerId, slot: ActionSlot, action: ProgrammedAction) {
  const owner = player(state, playerId);
  if (state.round === 1 && (action.kind === 'learnAttack' || action.kind === 'reuseAttack')) return false;
  if (action.kind === 'learnAttack' || action.kind === 'reuseAttack') {
    const other = slot === 'primary' ? owner.programmed.secondary : owner.programmed.primary;
    if (other?.kind === 'learnAttack' || other?.kind === 'reuseAttack') return false;
  }
  owner.programmed[slot] = action;
  return true;
}

export function lockProgrammedActions(state: GameState, playerId: PlayerId) {
  const turn = state.privateTurn;
  if (!turn) return false;
  const current = state.players[turn.playerIndex];
  if (!current || current.id !== playerId) return false;
  current.programmed.primary ??= { kind: 'none' };
  current.programmed.secondary ??= { kind: 'none' };
  current.programmed.locked = true;
  addLog(state, `${current.name} travou suas ações.`, playerId);
  turn.playerIndex += 1;
  turn.visible = false;
  if (turn.playerIndex >= state.players.length) {
    delete state.privateTurn;
    state.phase = 'reveal';
    addLog(state, 'Todos os jogadores programaram. Ações prontas para revelação simultânea.');
  }
  return true;
}

export function revealActions(state: GameState) {
  state.phase = 'onReveal';
  addLog(state, 'Ações reveladas simultaneamente. Nenhum gatilho AO REVELAR automatizado nesta coleção.');
  state.phase = 'confrontation';
  state.confrontation = { playerIndex: 0, visible: false };
}

export function programSupporter(state: GameState, playerId: PlayerId, choice: SupporterProgram) {
  player(state, playerId).supporterChoice = choice;
}

export function lockSupporterChoice(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId) {
  const turn = state.confrontation;
  if (!turn) return false;
  const current = state.players[turn.playerIndex];
  if (!current || current.id !== playerId) return false;
  current.supporterChoice ??= { kind: 'none' };
  addLog(state, `${current.name} concluiu a janela de Apoiador.`, playerId);
  turn.playerIndex += 1;
  turn.visible = false;
  if (turn.playerIndex >= state.players.length) {
    delete state.confrontation;
    resolveSupporters(state, cards);
  }
  return true;
}

function priorityOrderedPlayers(state: GameState) {
  const start = state.players.findIndex((item) => item.id === state.priorityPlayerId);
  const ordered = [];
  for (let offset = 0; offset < state.players.length; offset += 1) {
    const candidate = state.players[(start + offset + state.players.length) % state.players.length];
    if (candidate?.active) ordered.push(candidate.id);
  }
  return ordered;
}

function resolveSupporters(state: GameState, cards: Record<string, StoredCard>) {
  state.phase = 'order';
  for (const playerId of priorityOrderedPlayers(state)) {
    const owner = player(state, playerId);
    const choice = owner.supporterChoice;
    if (!choice || choice.kind === 'none') continue;
    if (owner.roundFlags.supporterUsed || !removeFromHand(state, playerId, choice.supporterInstanceId)) {
      addLog(state, `${owner.name}: Apoiador falhou porque a carta não estava mais disponível.`);
      continue;
    }
    const cardId = state.instances[choice.supporterInstanceId]?.cardId;
    if (cardId === 'card-pjo-093' && choice.targetPokemonId && state.pokemon[choice.targetPokemonId]?.ownerId === playerId) {
      state.pokemon[choice.targetPokemonId]!.temporaryModifiers.speed += 20;
      state.pokemon[choice.targetPokemonId]!.effects.push({
        id: `nina-${state.round}`,
        name: 'Nina: passos leves',
        tone: 'positive',
        source: choice.supporterInstanceId,
        duration: 'round',
        roundApplied: state.round,
        data: { ignoreNextSpeedReduction: true },
      });
      addLog(state, `${owner.name} usou Nina: +20 VEL até o fim da Rodada.`);
    } else if (cardId === 'card-pjo-094' && choice.pileIds?.length === 2 && choice.pileIds[0] !== choice.pileIds[1]) {
      drawToHand(state, playerId, choice.pileIds[0]);
      drawToHand(state, playerId, choice.pileIds[1]);
      const discardId = choice.discardInstanceId && owner.hand.includes(choice.discardInstanceId) ? choice.discardInstanceId : owner.hand[0];
      if (discardId) {
        removeFromHand(state, playerId, discardId);
        discardInstance(state, discardId, playerId, 'Professor Órion');
      }
      addLog(state, `${owner.name} usou Professor Órion para comprar de duas pilhas e descartar uma carta.`);
    } else {
      addLog(state, `${owner.name}: Apoiador sem automação completa, resolvido manualmente pelo texto.`);
    }
    owner.roundFlags.supporterUsed = true;
    discardInstance(state, choice.supporterInstanceId, playerId, 'Apoiador usado');
  }
  defineResolutionOrderWithCards(state, cards);
}

function defineResolutionOrder(state: GameState, cards: Record<string, StoredCard>) {
  state.phase = 'order';
  const entries = state.players
    .filter((entry) => entry.active)
    .map((entry) => ({ playerId: entry.id, speed: activePokemon(state, entry.id) ? 0 : -1, tie: 0 }));
  for (const entry of entries) {
    const mon = activePokemon(state, entry.playerId);
    entry.speed = mon ? currentSpeed(state, cards, mon) : -1;
  }
  const groups = new Map<number, typeof entries>();
  for (const entry of entries) groups.set(entry.speed, [...(groups.get(entry.speed) ?? []), entry]);
  for (const [speed, group] of groups) {
    if (group.length <= 1) continue;
    for (const entry of group) entry.tie = rollD6(state);
    addLog(state, `Empate de VEL ${speed}: ${group.map((entry) => `${player(state, entry.playerId).name} rolou ${entry.tie}`).join(', ')}.`);
  }
  const order = entries.sort((a, b) => b.speed - a.speed || b.tie - a.tie).map((entry) => entry.playerId);
  state.resolution = { order, index: 0, slot: 'primary' };
  state.phase = 'resolution';
  addLog(state, `Ordem da Rodada: ${order.map((id) => player(state, id).name).join(' → ')}.`);
}

export function defineResolutionOrderWithCards(state: GameState, cards: Record<string, StoredCard>) {
  defineResolutionOrder(state, cards);
}

export function resolveNextAction(state: GameState, cards: Record<string, StoredCard>) {
  if (!state.resolution) return false;
  const step = state.resolution;
  const actorId = step.order[step.index];
  if (!actorId) {
    finishResolution(state, cards);
    return true;
  }
  const actor = player(state, actorId);
  if (!actor.active) {
    step.index += 1;
    step.slot = 'primary';
    return true;
  }
  const action = step.slot === 'primary' ? actor.programmed.primary : actor.programmed.secondary;
  addLog(state, `Resolvendo ${step.slot === 'primary' ? 'Principal' : 'Secundária'} de ${actor.name}.`);
  resolveProgrammedAction(state, cards, actorId, action ?? { kind: 'none' });
  if (step.slot === 'primary') step.slot = 'secondary';
  else {
    step.index += 1;
    step.slot = 'primary';
  }
  if (step.index >= step.order.length) finishResolution(state, cards);
  return true;
}

function finishResolution(state: GameState, cards: Record<string, StoredCard>) {
  delete state.resolution;
  state.phase = 'roundEnd';
  for (const pokemon of Object.values(state.pokemon)) {
    const data = pokemonCard(state, cards, pokemon);
    if (data?.pokemonName === 'Spearow' && !pokemon.attackedThisRound && pokemon.effects.length < 3) {
      pokemon.effects.push({ id: `voando-${state.round}`, name: 'Voando', tone: 'positive', source: pokemon.currentCardInstanceId, duration: 'persistent', roundApplied: state.round });
      addLog(state, 'Spearow recebeu o efeito positivo Voando.');
    }
    pokemon.effects = pokemon.effects.filter((effect) => effect.duration !== 'round');
    pokemon.temporaryModifiers = { offense: 0, defense: 0, speed: 0 };
  }
  addLog(state, 'Fim da Rodada resolvido.');
  state.phase = 'acquisitions';
  state.acquisition = { playerIndex: 0, visible: false };
}

function resolveProgrammedAction(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, action: ProgrammedAction) {
  const owner = player(state, playerId);
  if (!owner.active) return;
  switch (action.kind) {
    case 'none':
      addLog(state, `${owner.name} não fez ação.`);
      return;
    case 'manual':
      addLog(state, `AJUSTE MANUAL DE TESTE: ${action.note || 'ação marcada para resolução manual'}.`);
      return;
    case 'buyWildcard':
      if (!owner.wildcards.draw) return fail(state, `${owner.name}: Curinga de Compra já foi usado.`);
      owner.wildcards.draw = false;
      acquireToHand(state, playerId, action.pileId, action.zoneInstanceId);
      return;
    case 'switchWildcard':
      if (!owner.wildcards.switch) return fail(state, `${owner.name}: Curinga de Troca já foi usado.`);
      owner.wildcards.switch = false;
      switchActive(state, cards, playerId, action.benchPokemonId, 'switch');
      return;
    case 'placeStadium':
      if (!removeFromHand(state, playerId, action.stadiumInstanceId)) return fail(state, `${owner.name}: Estádio não está mais na mão.`);
      placeStadium(state, playerId, action.stadiumInstanceId, action.slotId);
      return;
    case 'playPokemon':
      playPokemonCard(state, cards, playerId, action.cardInstanceId, action.targetPokemonId);
      return;
    case 'learnAttack':
      useNewAttack(state, cards, playerId, action.attackInstanceId, action.targetPokemonId);
      return;
    case 'reuseAttack':
      reuseAttack(state, cards, playerId, action.level, action.targetPokemonId);
      return;
    case 'useItems':
      useItems(state, cards, playerId, action.itemInstanceIds, action.targets);
      return;
  }
}

function fail(state: GameState, message: string) {
  addLog(state, `Ação falhou porque o alvo deixou de ser válido. ${message}`);
}

function acquireToHand(state: GameState, playerId: PlayerId, source: PhysicalPileId | 'zone', zoneInstanceId?: string) {
  const owner = player(state, playerId);
  if (owner.roundFlags.drawBlocked) {
    addLog(state, `${owner.name} está com compras bloqueadas até o fim da Rodada.`);
    return false;
  }
  if (source === 'zone') {
    const index = zoneInstanceId ? state.board.pokemonZone.indexOf(zoneInstanceId) : 0;
    if (index < 0) return fail(state, `${owner.name}: Pokémon da Zona não está disponível.`);
    const [id] = state.board.pokemonZone.splice(index, 1);
    if (!id) return false;
    state.instances[id]!.controllerId = playerId;
    state.instances[id]!.lastControllerId = playerId;
    owner.hand.push(id);
    addLog(state, `${owner.name} adquiriu um Pokémon da Zona Pokémon.`);
    return true;
  }
  const ok = drawToHand(state, playerId, source);
  addLog(state, ok ? `${owner.name} comprou de ${PILE_LABELS[source]}.` : `${PILE_LABELS[source]} está vazia.`);
  return ok;
}

export function performFreeAcquisition(state: GameState, playerId: PlayerId, source: PhysicalPileId | 'zone', zoneInstanceId?: string) {
  const current = state.acquisition ? state.players[state.acquisition.playerIndex] : undefined;
  if (!current || current.id !== playerId) return false;
  acquireToHand(state, playerId, source, zoneInstanceId);
  state.acquisition!.playerIndex += 1;
  state.acquisition!.visible = false;
  while (state.acquisition && state.acquisition.playerIndex < state.players.length && !state.players[state.acquisition.playerIndex]?.active) {
    state.acquisition.playerIndex += 1;
  }
  if (state.acquisition!.playerIndex >= state.players.length) {
    delete state.acquisition;
    state.phase = 'handLimit';
    addLog(state, 'Aquisições gratuitas concluídas.');
  }
  return true;
}

export function enforceHandLimit(state: GameState, playerId: PlayerId, discardIds: string[]) {
  const owner = player(state, playerId);
  for (const id of discardIds) {
    if (owner.hand.length <= 12) break;
    if (removeFromHand(state, playerId, id)) discardInstance(state, id, playerId, 'Limite de mão');
  }
  while (owner.hand.length > 12) {
    const id = owner.hand.pop();
    if (id) discardInstance(state, id, playerId, 'Limite de mão automático');
  }
}

export function advanceAfterHandLimit(state: GameState) {
  state.phase = 'priority';
  state.priorityPlayerId = nextActivePlayerId(state, state.priorityPlayerId);
  addLog(state, `Prioridade passou para ${player(state, state.priorityPlayerId).name}.`);
  state.phase = 'pokemonZone';
  if (state.board.pokemonZone.length < 5) {
    const id = drawPokemonReserveForZone(state);
    if (id) {
      state.board.pokemonZone.push(id);
      addLog(state, 'Zona Pokémon recebeu 1 novo Pokémon.');
    }
  }
  if (state.round >= 20) {
    finishByPoints(state);
    return;
  }
  state.round += 1;
  state.phase = 'roundStart';
}

export function startNextRound(state: GameState, cards: Record<string, StoredCard>) {
  beginRound(state, cards);
}

function placeStadium(state: GameState, playerId: PlayerId, instanceId: string, slotId: StadiumSlotId) {
  const previous = state.board.stadiums[slotId];
  if (previous) discardInstance(state, previous, playerId, 'Estádio substituído', `slot ${slotId}`);
  state.board.stadiums[slotId] = instanceId;
  addLog(state, `${player(state, playerId).name} posicionou Estádio em ${slotId}.`);
}

function playPokemonCard(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, instanceId: string, targetPokemonId?: string) {
  const owner = player(state, playerId);
  const stored = cardForInstance(state, cards, instanceId);
  if (stored?.data.cardType !== 'pokemon') return fail(state, `${owner.name}: a carta escolhida não é Pokémon.`);
  if (!owner.hand.includes(instanceId)) return fail(state, `${owner.name}: Pokémon não está mais na mão.`);
  if (stored.data.stage === 'BÁSICO') {
    if (owner.activePokemonId && owner.bench.length >= 3) return fail(state, `${owner.name}: Banco cheio.`);
    removeFromHand(state, playerId, instanceId);
    const pokemon = createPokemonInPlay(state, playerId, instanceId);
    if (!owner.activePokemonId) owner.activePokemonId = pokemon.pokemonId;
    else owner.bench.push(pokemon.pokemonId);
    addLog(state, `${owner.name} colocou ${stored.data.pokemonName} em campo.`);
    return;
  }
  const target = targetPokemonId ? state.pokemon[targetPokemonId] : undefined;
  const targetCard = target ? pokemonCard(state, cards, target) : undefined;
  if (!target || target.ownerId !== playerId || !targetCard || target.evolvedThisRound) return fail(state, `${owner.name}: evolução sem alvo legal.`);
  if (!isLegalEvolution(targetCard, stored.data)) return fail(state, `${stored.data.pokemonName} não evolui de ${targetCard.pokemonName}.`);
  removeFromHand(state, playerId, instanceId);
  target.currentCardInstanceId = instanceId;
  target.evolutionStack.push(instanceId);
  target.evolvedThisRound = true;
  addLog(state, `${owner.name} evoluiu ${targetCard.pokemonName} para ${stored.data.pokemonName}.`);
  if (['Riolu', 'Lucario'].includes(targetCard.pokemonName)) {
    const amount = targetCard.pokemonName === 'Riolu' ? 10 : 30;
    healPokemon(state, target, amount);
    target.effects = target.effects.filter((effect) => effect.tone !== 'negative');
    addLog(state, `${targetCard.pokemonName}: cura ${amount} e remove efeitos negativos ao evoluir.`);
  }
  if (isKnockedOut(target, stored.data)) knockoutPokemon(state, cards, target, undefined);
}

function isLegalEvolution(current: PokemonCardData, next: PokemonCardData) {
  const previous = next.previousEvolution.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const currentName = current.pokemonName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return previous === currentName || (next.form !== 'Normal' && next.pokemonId === current.pokemonId);
}

function useNewAttack(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, attackInstanceId: string, targetPokemonId: string) {
  const owner = player(state, playerId);
  const mon = activePokemon(state, playerId);
  const monCard = mon ? pokemonCard(state, cards, mon) : undefined;
  const attack = attackCard(state, cards, attackInstanceId);
  if (!mon || !monCard || mon.knockedOut) return fail(state, `${owner.name}: não possui Ativo válido.`);
  if (!attack || !owner.hand.includes(attackInstanceId)) return fail(state, `${owner.name}: Ataque não está mais na mão.`);
  if (mon.attacks.length >= 3) return fail(state, `${monCard.pokemonName} já possui 3 Ataques.`);
  if (!compatibleAttack(monCard, attack)) {
    addLog(state, `${owner.name} tentou usar ${attack.attackName}, mas ${monCard.pokemonName} é incompatível. A carta voltou para a mão.`);
    return;
  }
  const dealt = executeAttack(state, cards, playerId, mon, attack, targetPokemonId);
  if (dealt) {
    removeFromHand(state, playerId, attackInstanceId);
    mon.attacks.push({ level: (mon.attacks.length + 1) as 1 | 2 | 3, attackInstanceId, state: 'learned', summoned: false });
    addLog(state, `${monCard.pokemonName} aprendeu ${attack.attackName} no Nível ${mon.attacks.length}.`);
  }
}

function reuseAttack(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, level: 1 | 2 | 3, targetPokemonId: string) {
  const owner = player(state, playerId);
  if (!owner.wildcards.attack) return fail(state, `${owner.name}: Curinga de Ataque já foi usado.`);
  const mon = activePokemon(state, playerId);
  const slot = mon?.attacks.find((entry) => entry.level === level);
  const attack = attackCard(state, cards, slot?.attackInstanceId);
  if (!mon || !slot || !attack) return fail(state, `${owner.name}: Ataque aprendido não disponível.`);
  owner.wildcards.attack = false;
  const dealt = executeAttack(state, cards, playerId, mon, attack, targetPokemonId);
  if (dealt && slot.state === 'learned') {
    slot.state = 'mastered';
    addLog(state, `${attack.attackName} tornou-se Dominado no Nível ${level}.`);
    summonEvolution(state, cards, playerId, mon, level);
  }
}

function executeAttack(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, attacker: PokemonInPlay, attack: AttackCardData, targetPokemonId: string) {
  const target = state.pokemon[targetPokemonId];
  const attackerData = pokemonCard(state, cards, attacker);
  const targetData = target ? pokemonCard(state, cards, target) : undefined;
  if (!attackerData || !target || !targetData || target.knockedOut) {
    fail(state, `${player(state, playerId).name}: alvo de Ataque inválido.`);
    return false;
  }
  const powerOverride = attackPowerWithStadium(state, cards, playerId, attack.power);
  let finalModifier = 0;
  if (attackerData.pokemonName === 'Piloswine' && attacker.flags.nextAttackPlus20) {
    finalModifier += 20;
    delete attacker.flags.nextAttackPlus20;
  }
  if (targetData.pokemonName === 'Gardevoir' && attack.attackKind === 'special') finalModifier -= 20;
  const breakdown = calculateDamage({ attacker, defender: target, attackerStats: attackerData, defenderStats: targetData, attack, round: state.round, powerOverride, finalModifier });
  let damage = applyBeforeDamageAbilities(state, cards, playerId, attacker, target, attack, breakdown.finalDamage);
  attacker.attackedThisRound = true;
  attacker.flags.attackedOnceThisRound = true;
  player(state, playerId).roundFlags.firstAttackUsed = true;
  addLog(state, `${player(state, playerId).name} usou ${attack.attackName} com ${attackerData.pokemonName}.`);
  addLog(state, `Dano Bruto ${breakdown.rawDamage}; Defesa ${breakdown.defensiveStat}; Dano Base +${breakdown.roundBaseDamage}; Modificadores ${breakdown.finalModifier}; Dano Final ${damage}.`);
  if (damage > 0) {
    const before = pokemonHpRemaining(target, targetData);
    target.damage += damage;
    const after = pokemonHpRemaining(target, targetData);
    addLog(state, `${targetData.pokemonName}: ${before} → ${after} HP.`);
    if (target.damage >= targetData.hp) knockoutPokemon(state, cards, target, playerId);
  }
  return true;
}

function attackPowerWithStadium(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, basePower: number) {
  let power = basePower;
  for (const slot of Object.keys(state.board.stadiums) as StadiumSlotId[]) {
    const stadium = cardForInstance(state, cards, state.board.stadiums[slot] ?? undefined);
    if (stadium?.id !== 'card-pjo-096') continue;
    const [a, b] = STADIUM_CONNECTIONS[slot];
    const connected = [state.players[a]?.id, state.players[b]?.id];
    const owner = player(state, playerId);
    if (connected.includes(playerId) && !owner.roundFlags.firstAttackUsed) {
      power += 10;
      addLog(state, `Ruínas Ressonantes aumentou a potência do primeiro Ataque de ${owner.name} para ${power}%.`);
    }
  }
  return power;
}

function applyBeforeDamageAbilities(
  state: GameState,
  cards: Record<string, StoredCard>,
  attackerId: PlayerId,
  attacker: PokemonInPlay,
  target: PokemonInPlay,
  attack: AttackCardData,
  incomingDamage: number,
) {
  const targetData = pokemonCard(state, cards, target);
  const attackerData = pokemonCard(state, cards, attacker);
  if (!targetData || !attackerData) return incomingDamage;
  let damage = incomingDamage;

  if (!target.flags.firstAttackChecked && ['Froakie', 'Frogadier', 'Greninja'].includes(targetData.pokemonName)) {
    target.flags.firstAttackChecked = true;
    let minimum = targetData.pokemonName === 'Froakie' ? 6 : targetData.pokemonName === 'Frogadier' ? 5 : 4;
    if (targetData.form === 'EX') {
      const speedDiff = currentSpeed(state, cards, target) - currentSpeed(state, cards, attacker);
      minimum = Math.max(2, 6 - Math.floor(Math.max(0, speedDiff) / 20));
    }
    const roll = rollD6(state);
    addLog(state, `${targetData.pokemonName} rolou D6 para esquiva: ${roll}.`);
    if (roll >= minimum) {
      addLog(state, `${targetData.pokemonName} evitou o dano do Ataque.`);
      return 0;
    }
  }

  if (targetData.pokemonName === 'Swinub' && !target.flags.damagedByAttackThisRound && damage > 0) {
    damage = Math.max(0, damage - 20);
    target.flags.damagedByAttackThisRound = true;
    target.flags.cannotAttackThisRound = true;
    addLog(state, 'Swinub reduziu automaticamente 20 de dano. Interpretação de protótipo: aceitação automática.');
  }
  if (targetData.pokemonName === 'Shinx' && damage === 10) damage = 0;
  if (targetData.pokemonName === 'Luxio' && damage <= 20) damage = 0;
  if (attackerData.pokemonName === 'Kleavor') {
    target.modifiers.defense -= 10;
    target.flags[`kleavorReductions:${attacker.pokemonId}`] = Number(target.flags[`kleavorReductions:${attacker.pokemonId}`] ?? 0) + 1;
    damage += Number(target.flags[`kleavorReductions:${attacker.pokemonId}`] ?? 0) * 10;
  }
  if (targetData.pokemonName === 'Piloswine') {
    const order = state.resolution?.order ?? [];
    if (order.indexOf(target.ownerId) > order.indexOf(attackerId)) target.flags.nextAttackPlus20 = true;
  }
  return Math.max(0, damage);
}

function healPokemon(state: GameState, pokemon: PokemonInPlay, amount: number) {
  pokemon.damage = Math.max(0, pokemon.damage - amount);
}

function knockoutPokemon(state: GameState, cards: Record<string, StoredCard>, pokemon: PokemonInPlay, responsiblePlayerId?: PlayerId) {
  const owner = player(state, pokemon.ownerId);
  const data = pokemonCard(state, cards, pokemon);
  if (!data || pokemon.knockedOut) return;
  pokemon.knockedOut = true;
  pokemon.knockoutCount += 1;
  const points = knockoutPointValue(data, pokemon.knockoutCount - 1);
  owner.points -= points;
  if (responsiblePlayerId && responsiblePlayerId !== owner.id) player(state, responsiblePlayerId).points += points;
  addLog(state, `${data.pokemonName} foi Nocauteado. ${owner.name} -${points}${responsiblePlayerId && responsiblePlayerId !== owner.id ? `; ${player(state, responsiblePlayerId).name} +${points}` : ''}.`);
  if (owner.activePokemonId === pokemon.pokemonId) {
    const replacement = owner.bench.find((id) => !state.pokemon[id]?.knockedOut);
    if (replacement) {
      owner.bench = owner.bench.filter((id) => id !== replacement);
      owner.bench.push(pokemon.pokemonId);
      owner.activePokemonId = replacement;
      state.pokemon[replacement]!.knockedOut = false;
      addLog(state, `${owner.name} promoveu ${pokemonDisplayName(state, cards, replacement)} automaticamente após KO. Resolução manual pode corrigir a escolha.`);
    } else {
      owner.activePokemonId = undefined;
      addLog(state, `${owner.name} ficou sem Pokémon Ativo válido.`);
    }
  }
}

function summonEvolution(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, pokemon: PokemonInPlay, level: 1 | 2 | 3) {
  const current = pokemonCard(state, cards, pokemon);
  const line = state.evolutionLines.find((entry) => entry.cards.includes(state.instances[pokemon.evolutionStack[0]!]!.cardId));
  const futureCardId = line?.futureByLevel[level - 1];
  if (!current || !futureCardId) {
    addLog(state, `Convocação de Nível ${level} falhou: não há evolução futura cadastrada.`);
    return;
  }
  const owner = player(state, playerId);
  if (owner.hand.some((id) => state.instances[id]?.cardId === futureCardId)) {
    addLog(state, `Convocação concluída: ${cards[futureCardId] ? cardName(cards[futureCardId]!.data) : 'evolução'} já estava na mão.`);
    return;
  }
  const found = findInstanceByCardId(state, futureCardId, playerId);
  if (!found) {
    addLog(state, 'Convocação falhou: todas as cópias disponíveis parecem estar em campo ou ausentes.');
    return;
  }
  owner.hand.push(found.instanceId);
  state.instances[found.instanceId]!.controllerId = playerId;
  state.instances[found.instanceId]!.lastControllerId = playerId;
  if (found.kind === 'pile') shuffleInPlace(state, state.board.piles[found.pileId!]);
  if (found.kind === 'otherHand' && found.previousOwner) {
    drawPokemonToHand(state, found.previousOwner);
    addLog(state, `${player(state, found.previousOwner).name} recebeu 1 compra Pokémon pela Convocação.`);
  }
  addLog(state, `Convocação: ${cardName(cards[futureCardId]!.data)} encontrado em ${found.label} e colocado na mão de ${owner.name}.`);
}

function findInstanceByCardId(state: GameState, cardId: string, playerId: PlayerId) {
  const zoneIndex = state.board.pokemonZone.findIndex((id) => state.instances[id]?.cardId === cardId);
  if (zoneIndex >= 0) return { instanceId: state.board.pokemonZone.splice(zoneIndex, 1)[0]!, kind: 'zone', label: 'Zona Pokémon' };
  for (const pileId of ['pokemonA', 'pokemonB'] as PhysicalPileId[]) {
    const index = state.board.piles[pileId].findIndex((id) => state.instances[id]?.cardId === cardId);
    if (index >= 0) return { instanceId: state.board.piles[pileId].splice(index, 1)[0]!, kind: 'pile', pileId, label: PILE_LABELS[pileId] };
  }
  const discardIndex = state.board.discard.findIndex((entry) => state.instances[entry.instanceId]?.cardId === cardId);
  if (discardIndex >= 0) return { instanceId: state.board.discard.splice(discardIndex, 1)[0]!.instanceId, kind: 'discard', label: 'Descarte Geral' };
  for (const other of state.players) {
    if (other.id === playerId) continue;
    const index = other.hand.findIndex((id) => state.instances[id]?.cardId === cardId);
    if (index >= 0) return { instanceId: other.hand.splice(index, 1)[0]!, kind: 'otherHand', previousOwner: other.id, label: `mão de ${other.name}` };
  }
  return null;
}

function useItems(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, itemIds: string[], targets: Record<string, string>) {
  const owner = player(state, playerId);
  const playable = itemIds.slice(0, 2).filter((id) => owner.hand.includes(id));
  if (!playable.length) return fail(state, `${owner.name}: nenhum Item disponível.`);
  for (const itemId of playable) {
    const stored = cardForInstance(state, cards, itemId);
    if (stored?.data.cardType !== 'item') continue;
    removeFromHand(state, playerId, itemId);
    if (stored.id === 'card-pjo-089') {
      const target = state.pokemon[targets[itemId] ?? ''];
      if (target?.ownerId === playerId) {
        healPokemon(state, target, 30);
        addLog(state, `${owner.name} usou Spray de Emergência e curou 30 de ${pokemonDisplayName(state, cards, target.pokemonId)}.`);
      }
    } else if (stored.id === 'card-pjo-090') {
      const benchId = targets[itemId];
      if (benchId) {
        switchActive(state, cards, playerId, benchId, 'switch');
        const active = activePokemon(state, playerId);
        if (active) {
          active.temporaryModifiers.speed += 10;
          addLog(state, 'Passagem Secreta deu +10 VEL ao novo Ativo até o fim da Rodada.');
        }
      }
    } else if (stored.id === 'card-pjo-091') {
      const discardId = targets[itemId];
      const index = state.board.discard.findIndex((entry) => entry.instanceId === discardId && entry.lastControllerId === playerId && cardForInstance(state, cards, entry.instanceId)?.data.cardType === 'attack');
      if (index >= 0) owner.hand.push(state.board.discard.splice(index, 1)[0]!.instanceId);
      addLog(state, `${owner.name} usou Caixa de Reposição.`);
    } else if (stored.id === 'card-pjo-092') {
      const pileId = (targets[itemId] as PhysicalPileId) || 'pokemonA';
      const pile = state.board.piles[pileId];
      const top = pile.splice(0, 3);
      pile.unshift(...top);
      addLog(state, `${owner.name} olhou as 3 cartas do topo de ${PILE_LABELS[pileId]}. Ordem mantida no protótipo; ferramenta manual permite ajustar.`);
    } else {
      addLog(state, `${stored.data.name}: resolver manualmente pelo texto da carta.`);
    }
    discardInstance(state, itemId, playerId, 'Item usado');
  }
}

function switchActive(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, benchPokemonId: string, reason: 'switch' | 'koReplacement') {
  const owner = player(state, playerId);
  if (!owner.activePokemonId || !owner.bench.includes(benchPokemonId)) return fail(state, `${owner.name}: troca sem Banco válido.`);
  const previous = owner.activePokemonId;
  owner.bench = owner.bench.filter((id) => id !== benchPokemonId);
  owner.bench.push(previous);
  owner.activePokemonId = benchPokemonId;
  addLog(state, `${owner.name} trocou ${pokemonDisplayName(state, cards, previous)} por ${pokemonDisplayName(state, cards, benchPokemonId)}.`);
  if (reason === 'switch') applySwitchStadiums(state, cards, playerId, benchPokemonId);
}

function applySwitchStadiums(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, incomingPokemonId: string) {
  for (const slot of Object.keys(state.board.stadiums) as StadiumSlotId[]) {
    const stadium = cardForInstance(state, cards, state.board.stadiums[slot] ?? undefined);
    if (stadium?.id !== 'card-pjo-095') continue;
    const [a, b] = STADIUM_CONNECTIONS[slot];
    if (![state.players[a]?.id, state.players[b]?.id].includes(playerId)) continue;
    const incoming = state.pokemon[incomingPokemonId];
    if (incoming) {
      healPokemon(state, incoming, 10);
      addLog(state, 'Passarela dos Ventos curou 10 do Pokémon que entrou.');
    }
  }
}

export function manualAdjustDamage(state: GameState, cards: Record<string, StoredCard>, pokemonId: string, delta: number) {
  const target = state.pokemon[pokemonId];
  if (!target) return;
  target.damage = Math.max(0, target.damage + delta);
  addLog(state, `AJUSTE MANUAL DE TESTE: ${pokemonDisplayName(state, cards, pokemonId)} recebeu ajuste de dano ${delta}.`);
}

export function manualAdjustPoints(state: GameState, playerId: PlayerId, delta: number) {
  player(state, playerId).points += delta;
  addLog(state, `AJUSTE MANUAL DE TESTE: pontos de ${player(state, playerId).name} ${delta >= 0 ? '+' : ''}${delta}.`);
}

export function addManualEffect(state: GameState, pokemonId: string, effect: Omit<PokemonEffectState, 'id' | 'roundApplied'>) {
  const target = state.pokemon[pokemonId];
  if (!target || target.effects.length >= 3) return false;
  target.effects.push({ ...effect, id: `manual-${Date.now().toString(36)}`, roundApplied: state.round });
  addLog(state, `AJUSTE MANUAL DE TESTE: efeito ${effect.name} aplicado.`);
  return true;
}

export function validateInvariants(state: GameState) {
  const locations = new Map<string, string>();
  const visit = (id: string, location: string) => {
    const previous = locations.get(id);
    if (previous) throw new Error(`Instância ${id} está em duas zonas: ${previous} e ${location}`);
    locations.set(id, location);
  };
  for (const pile of Object.values(state.board.piles)) for (const id of pile) visit(id, 'pilha');
  for (const id of state.board.pokemonZone) visit(id, 'zona');
  for (const entry of state.board.discard) visit(entry.instanceId, 'descarte');
  for (const owner of state.players) {
    if (owner.bench.length > 3) throw new Error(`${owner.name} tem Banco com mais de 3 Pokémon.`);
    for (const id of owner.hand) visit(id, `mão ${owner.name}`);
  }
  for (const pokemon of Object.values(state.pokemon)) {
    if (pokemon.attacks.length > 3) throw new Error('Pokémon com mais de 3 Ataques.');
    if (pokemon.effects.length > 3) throw new Error('Pokémon com mais de 3 efeitos.');
    for (const id of pokemon.evolutionStack) visit(id, 'campo');
    for (const attack of pokemon.attacks) visit(attack.attackInstanceId, 'ataque anexado');
    if (pokemon.toolInstanceId) visit(pokemon.toolInstanceId, 'ferramenta');
  }
}

export function finishByPoints(state: GameState) {
  state.phase = 'gameOver';
  state.status = 'finished';
  const remaining = state.players
    .filter((entry) => !state.ranking.includes(entry.id))
    .sort((a, b) => b.points - a.points)
    .map((entry) => entry.id);
  state.ranking = [...state.ranking, ...remaining];
  state.players.forEach((entry, index) => { entry.finalPosition = state.ranking.indexOf(entry.id) + 1 || index + 1; });
  addLog(state, 'Teste encerrado e jogadores classificados por Pontos de Nocaute.');
}
