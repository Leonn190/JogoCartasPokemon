import type { AttackCardData, PokemonCardData, StoredCard } from '../types/card';
import { calculateDamage, isKnockedOut, knockoutPointValue, pokemonHpRemaining } from './damage';
import { drawFromPhysicalPile, prepareInitialOptions, returnToPokemonReserve } from './setup';
import type {
  ActionSlot,
  GameState,
  PendingChoice,
  PhysicalPileId,
  PlayerId,
  PokemonEffectState,
  PokemonInPlay,
  ProgrammedAction,
  StadiumSlotId,
  SupporterProgram,
} from './types';
import { addLog, cardName, nextActivePlayerId, nextRandom, rollD6, shuffleInPlace } from './utils';

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

function setPendingChoice(state: GameState, choice: PendingChoice) {
  state.pendingChoice = choice;
  state.status = 'waitingForChoice';
  addLog(state, `Aguardando escolha: ${choice.prompt}`, choice.playerId);
}

function clearPendingChoice(state: GameState) {
  delete state.pendingChoice;
  if (state.status === 'waitingForChoice') state.status = 'playing';
}

function choiceId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isPhysicalPileId(value: string): value is PhysicalPileId {
  return value in PILE_LABELS;
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
    const active = entry.activePokemonId ? state.pokemon[entry.activePokemonId] : undefined;
    entry.roundFlags = {
      supporterUsed: false,
      firstAttackUsed: false,
      drawBlocked: false,
      recoveryActionOnly: !active || active.knockedOut,
      beforeActingDone: false,
    };
    if (entry.roundFlags.recoveryActionOnly) addLog(state, `${entry.name} está sem Ativo válido e terá somente uma ação de recuperação nesta Rodada.`);
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
  offerLucarioZBenchBoost(state, cards);
}

function offerLucarioZBenchBoost(state: GameState, cards: Record<string, StoredCard>) {
  if (state.pendingChoice) return;
  for (const owner of state.players) {
    const lucario = owner.bench
      .map((id) => state.pokemon[id])
      .find((mon) => {
        const data = mon ? pokemonCard(state, cards, mon) : undefined;
        return !!mon && !mon.knockedOut && data?.pokemonName === 'Lucario Z' && data.form === 'Mega';
      });
    if (!lucario) continue;
    setPendingChoice(state, {
      id: choiceId('lucario-z'),
      kind: 'attribute',
      playerId: owner.id,
      prompt: 'Lucario Z Mega está no Banco no início da Rodada: escolha um bônus persistente.',
      options: [
        { id: 'offense', label: '+10 Ofensividade' },
        { id: 'defense', label: '+10 Resistência' },
        { id: 'speed', label: '+10 Velocidade' },
      ],
      data: { action: 'lucarioZBenchBoost', pokemonId: lucario.pokemonId },
    });
    return;
  }
}

export function setPrivateVisible(state: GameState, area: 'initial' | 'preparation' | 'confrontation' | 'acquisition', visible: boolean) {
  if (area === 'initial' && state.initialChoice) state.initialChoice.visible = visible;
  if (area === 'preparation' && state.privateTurn) state.privateTurn.visible = visible;
  if (area === 'confrontation' && state.confrontation) state.confrontation.visible = visible;
  if (area === 'acquisition' && state.acquisition) state.acquisition.visible = visible;
}

export function programPlayerAction(state: GameState, playerId: PlayerId, slot: ActionSlot, action: ProgrammedAction) {
  const owner = player(state, playerId);
  if (owner.roundFlags.recoveryActionOnly) {
    const isRecoveryAction = action.kind === 'none'
      || action.kind === 'buyWildcard'
      || action.kind === 'useItems'
      || action.kind === 'playPokemon';
    if (slot === 'secondary' && action.kind !== 'none') return false;
    if (!isRecoveryAction) return false;
  }
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
  current.programmed.secondary = current.roundFlags.recoveryActionOnly ? { kind: 'none' } : (current.programmed.secondary ?? { kind: 'none' });
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

function priorityOrderedPlayers(state: GameState): PlayerId[] {
  const start = state.players.findIndex((item) => item.id === state.priorityPlayerId);
  const ordered: PlayerId[] = [];
  for (let offset = 0; offset < state.players.length; offset += 1) {
    const candidate = state.players[(start + offset + state.players.length) % state.players.length];
    if (candidate?.active) ordered.push(candidate.id);
  }
  return ordered;
}

function resolveSupporters(state: GameState, cards: Record<string, StoredCard>) {
  resolveSupportersFromIndex(state, cards, 0);
}

function resolveSupportersFromIndex(state: GameState, cards: Record<string, StoredCard>, startIndex: number) {
  state.phase = 'order';
  const ordered = priorityOrderedPlayers(state);
  for (let index = startIndex; index < ordered.length; index += 1) {
    const playerId = ordered[index]!;
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
      addLog(state, `${owner.name} usou Professor Órion para comprar de duas pilhas e descartar uma carta.`);
      owner.roundFlags.supporterUsed = true;
      discardInstance(state, choice.supporterInstanceId, playerId, 'Apoiador usado');
      setPendingChoice(state, {
        id: choiceId('orion-discard'),
        kind: 'discard',
        playerId,
        prompt: 'Professor Órion: escolha 1 carta da sua mão para descartar.',
        options: owner.hand.map((id) => ({ id, label: cardForInstance(state, cards, id) ? cardName(cardForInstance(state, cards, id)!.data) : 'Carta' })),
        data: { action: 'orionDiscard', nextSupporterIndex: index + 1 },
      });
      return;
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
    .map((entry) => ({ playerId: entry.id, speed: activePokemon(state, entry.id) ? 0 : -1 }));
  for (const entry of entries) {
    const mon = activePokemon(state, entry.playerId);
    entry.speed = mon ? currentSpeed(state, cards, mon) : -1;
  }
  const bySpeed = new Map<number, typeof entries>();
  for (const entry of entries) bySpeed.set(entry.speed, [...(bySpeed.get(entry.speed) ?? []), entry]);
  const order = [...bySpeed.entries()]
    .sort((a, b) => b[0] - a[0])
    .flatMap(([speed, group]) => resolveSpeedTie(state, speed, group));
  state.resolution = { order, index: 0, slot: 'primary' };
  state.phase = 'resolution';
  addLog(state, `Ordem da Rodada: ${order.map((id) => player(state, id).name).join(' → ')}.`);
}

function resolveSpeedTie<T extends { playerId: PlayerId }>(state: GameState, speed: number, group: T[]): PlayerId[] {
  if (group.length <= 1) return group.map((entry) => entry.playerId);
  const pending = [...group];
  const resolved: PlayerId[] = [];
  while (pending.length) {
    const rolls = pending.map((entry) => ({ entry, roll: rollD6(state) }));
    addLog(state, `Empate de VEL ${speed}: ${rolls.map(({ entry, roll }) => `${player(state, entry.playerId).name} rolou ${roll}`).join(', ')}.`);
    const rollGroups = new Map<number, T[]>();
    for (const item of rolls) rollGroups.set(item.roll, [...(rollGroups.get(item.roll) ?? []), item.entry]);
    const highest = Math.max(...rollGroups.keys());
    const winners = rollGroups.get(highest) ?? [];
    if (winners.length === 1) {
      resolved.push(winners[0]!.playerId);
      pending.splice(0, pending.length, ...pending.filter((entry) => entry.playerId !== winners[0]!.playerId));
    } else if (winners.length === pending.length) {
      continue;
    } else {
      resolved.push(...resolveSpeedTie(state, speed, winners));
      const winnerIds = new Set(winners.map((entry) => entry.playerId));
      pending.splice(0, pending.length, ...pending.filter((entry) => !winnerIds.has(entry.playerId)));
    }
  }
  return resolved;
}

export function defineResolutionOrderWithCards(state: GameState, cards: Record<string, StoredCard>) {
  defineResolutionOrder(state, cards);
}

export function resolveNextAction(state: GameState, cards: Record<string, StoredCard>) {
  if (state.pendingChoice) return false;
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
  if (step.slot === 'primary' && !actor.roundFlags.beforeActingDone) {
    runBeforeActing(state, cards, actorId);
    actor.roundFlags.beforeActingDone = true;
    if (state.pendingChoice) return true;
  }
  const action = step.slot === 'primary' ? actor.programmed.primary : actor.programmed.secondary;
  addLog(state, `Resolvendo ${step.slot === 'primary' ? 'Principal' : 'Secundária'} de ${actor.name}.`);
  resolveProgrammedAction(state, cards, actorId, action ?? { kind: 'none' });
  if (state.pendingChoice) return true;
  advanceResolutionStep(state, cards);
  return true;
}

function advanceResolutionStep(state: GameState, cards: Record<string, StoredCard>) {
  const step = state.resolution;
  if (!step) return;
  if (step.slot === 'primary') step.slot = 'secondary';
  else {
    step.index += 1;
    step.slot = 'primary';
  }
  if (step.index >= step.order.length) finishResolution(state, cards);
}

function runBeforeActing(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId) {
  const owner = player(state, playerId);
  addLog(state, `ANTES DE AGIR: verificando efeitos de ${owner.name}.`);
  for (const pokemonId of [owner.activePokemonId, ...owner.bench].filter(Boolean) as string[]) {
    const mon = state.pokemon[pokemonId];
    const data = mon ? pokemonCard(state, cards, mon) : undefined;
    if (!mon || !data) continue;
    const removable = mon.effects.filter((effect) => effect.tone === 'negative' && effect.duration !== 'round');
    for (const effect of removable) {
      const roll = rollD6(state);
      addLog(state, `${data.pokemonName} tentou remover ${effect.name}: D6=${roll}.`);
      if (roll >= 5) {
        mon.effects = mon.effects.filter((entry) => entry.id !== effect.id);
        addLog(state, `${data.pokemonName} removeu ${effect.name}.`);
      }
    }
  }
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
  state.acquisition = { playerIndex: 0, visible: false, order: priorityOrderedPlayers(state) };
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
    case 'placeClimate':
      if (!removeFromHand(state, playerId, action.climateInstanceId)) return fail(state, `${owner.name}: Clima não está mais na mão.`);
      placeClimate(state, playerId, action.climateInstanceId);
      return;
    case 'attachTools':
      attachTools(state, cards, playerId, action.toolInstanceIds, action.targets);
      return;
    case 'useRareItem':
      useRareItem(state, cards, playerId, action.rareItemInstanceId, action.targetPokemonId);
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

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

export function performFreeAcquisition(state: GameState, playerId: PlayerId, source: PhysicalPileId | 'zone', zoneInstanceId?: string) {
  const order = state.acquisition?.order ?? priorityOrderedPlayers(state);
  const currentId = order[state.acquisition?.playerIndex ?? -1];
  if (!currentId || currentId !== playerId) return false;
  acquireToHand(state, playerId, source, zoneInstanceId);
  state.acquisition!.playerIndex += 1;
  state.acquisition!.visible = false;
  while (state.acquisition && state.acquisition.playerIndex < order.length && !player(state, order[state.acquisition.playerIndex]!).active) {
    state.acquisition.playerIndex += 1;
  }
  if (state.acquisition!.playerIndex >= order.length) {
    delete state.acquisition;
    state.phase = 'handLimit';
    addLog(state, 'Aquisições gratuitas concluídas.');
  }
  return true;
}

export function resolvePendingChoice(state: GameState, cards: Record<string, StoredCard>, choiceIdValue: string, selectedIds: string[]) {
  const choice = state.pendingChoice;
  if (!choice || choice.id !== choiceIdValue) return false;
  const selected = selectedIds.filter((id) => choice.options.some((option) => option.id === id && !option.disabled));
  const action = String(choice.data?.action ?? '');
  if (action === 'orionDiscard') {
    const playerId = choice.playerId;
    const discardId = selected[0];
    if (!playerId || !discardId || !removeFromHand(state, playerId, discardId)) return false;
    discardInstance(state, discardId, playerId, 'Professor Órion');
    addLog(state, `${player(state, playerId).name} descartou 1 carta por Professor Órion.`, playerId);
    const nextIndex = Number(choice.data?.nextSupporterIndex ?? 0);
    clearPendingChoice(state);
    resolveSupportersFromIndex(state, cards, nextIndex);
    return true;
  }
  if (action === 'scannerOrder') {
    const pileId = String(choice.data?.pileId ?? '');
    const chosenOrder = selected[0]?.split('|') ?? [];
    const held = Array.isArray(choice.data?.cards) ? choice.data.cards : [];
    if (!isPhysicalPileId(pileId) || !chosenOrder.length || chosenOrder.some((id) => !held.includes(id))) return false;
    state.board.piles[pileId].unshift(...chosenOrder);
    addLog(state, `${player(state, choice.playerId!).name} reorganizou o topo de ${PILE_LABELS[pileId]} com Scanner de Rotas.`, choice.playerId);
    const remainingItemIds = Array.isArray(choice.data?.remainingItemIds) ? choice.data.remainingItemIds : [];
    const targetsJson = String(choice.data?.targetsJson ?? '{}');
    clearPendingChoice(state);
    if (choice.playerId && remainingItemIds.length) {
      useItems(state, cards, choice.playerId, remainingItemIds, JSON.parse(targetsJson) as Record<string, string>);
      if (state.pendingChoice) return true;
    }
    advanceResolutionStep(state, cards);
    return true;
  }
  if (action === 'koReplacement') {
    const playerId = choice.playerId;
    const replacementId = selected[0];
    if (!playerId || !replacementId) return false;
    promoteAfterKnockout(state, cards, playerId, replacementId);
    clearPendingChoice(state);
    advanceResolutionStep(state, cards);
    return true;
  }
  if (action === 'swinubDamage') {
    const attackerId = choice.data?.attackerId as PlayerId | undefined;
    const attackerPokemonId = String(choice.data?.attackerPokemonId ?? '');
    const targetPokemonId = String(choice.data?.targetPokemonId ?? '');
    const attacker = state.pokemon[attackerPokemonId];
    const target = state.pokemon[targetPokemonId];
    if (!attackerId || !attacker || !target) return false;
    const baseDamage = Number(choice.data?.damage ?? 0);
    const accepted = selected[0] === 'yes';
    const damage = accepted ? Math.max(0, baseDamage - 20) : baseDamage;
    if (accepted) {
      target.flags.cannotAttackThisRound = true;
      addLog(state, 'Swinub reduziu 20 de dano e não poderá atacar nesta Rodada.', target.ownerId);
    } else {
      addLog(state, 'Swinub não usou sua redução de dano.', target.ownerId);
    }
    clearPendingChoice(state);
    markAttackUsed(state, attackerId, attacker);
    addLog(state, `${player(state, attackerId).name} concluiu ${String(choice.data?.attackName ?? 'Ataque')} após a escolha de Swinub.`);
    const knockedOut = applyDamageToPokemon(state, cards, target, damage, attackerId, 'Ataque');
    applyAfterAttackHitAbilities(state, cards, attacker, target);
    if (knockedOut && !state.pendingChoice) offerMegaGalladeReward(state, cards, attacker);
    const continuationKind = String(choice.data?.continuationKind ?? 'none');
    if (continuationKind === 'learn') {
      const attackInstanceId = String(choice.data?.attackInstanceId ?? '');
      const attack = attackCard(state, cards, attackInstanceId);
      if (attack) finishLearnAttack(state, cards, attackerId, attacker, attackInstanceId, attack);
    }
    if (continuationKind === 'reuse') {
      const level = Number(choice.data?.level ?? 0) as 1 | 2 | 3;
      const slot = attacker.attacks.find((entry) => entry.level === level);
      const attack = attackCard(state, cards, slot?.attackInstanceId);
      if (attack) finishReuseAttack(state, cards, attackerId, attacker, level, attack);
    }
    if (!state.pendingChoice) advanceResolutionStep(state, cards);
    return true;
  }
  if (action === 'golurkRedirect') {
    const attackerId = choice.data?.attackerId as PlayerId | undefined;
    const attackerPokemonId = String(choice.data?.attackerPokemonId ?? '');
    const targetPokemonId = String(choice.data?.targetPokemonId ?? '');
    const guardianPokemonId = String(choice.data?.guardianPokemonId ?? '');
    const attacker = state.pokemon[attackerPokemonId];
    const originalTarget = state.pokemon[targetPokemonId];
    const guardian = state.pokemon[guardianPokemonId];
    if (!attackerId || !attacker || !originalTarget || !guardian) return false;
    const guardianData = pokemonCard(state, cards, guardian);
    const baseDamage = Number(choice.data?.damage ?? 0);
    const redirect = selected[0] === 'yes';
    const finalTarget = redirect ? guardian : originalTarget;
    const damage = redirect ? Math.max(0, baseDamage - (guardianData?.form === 'EX' ? 20 : 10)) : baseDamage;
    clearPendingChoice(state);
    markAttackUsed(state, attackerId, attacker);
    addLog(state, redirect ? 'Golurk redirecionou o dano para si.' : 'Golurk não redirecionou o dano.', originalTarget.ownerId);
    const knockedOut = applyDamageToPokemon(state, cards, finalTarget, damage, attackerId, 'Ataque');
    applyAfterAttackHitAbilities(state, cards, attacker, originalTarget);
    if (knockedOut && !state.pendingChoice) offerMegaGalladeReward(state, cards, attacker);
    const continuationKind = String(choice.data?.continuationKind ?? 'none');
    if (continuationKind === 'learn') {
      const attackInstanceId = String(choice.data?.attackInstanceId ?? '');
      const attack = attackCard(state, cards, attackInstanceId);
      if (attack) finishLearnAttack(state, cards, attackerId, attacker, attackInstanceId, attack);
    }
    if (continuationKind === 'reuse') {
      const level = Number(choice.data?.level ?? 0) as 1 | 2 | 3;
      const slot = attacker.attacks.find((entry) => entry.level === level);
      const attack = attackCard(state, cards, slot?.attackInstanceId);
      if (attack) finishReuseAttack(state, cards, attackerId, attacker, level, attack);
    }
    if (!state.pendingChoice) advanceResolutionStep(state, cards);
    return true;
  }
  if (action === 'luxrayDiscard') {
    const playerId = choice.playerId;
    const attackerPokemonId = String(choice.data?.attackerPokemonId ?? '');
    const targetPokemonId = String(choice.data?.targetPokemonId ?? '');
    const attacker = state.pokemon[attackerPokemonId];
    if (!playerId || !attacker) return false;
    const attackerData = pokemonCard(state, cards, attacker);
    const legalDiscardIds = selectedIds.filter((id) => player(state, playerId).hand.includes(id));
    for (const id of legalDiscardIds) {
      removeFromHand(state, playerId, id);
      discardInstance(state, id, playerId, 'Luxray');
    }
    attacker.flags.luxrayDiscardResolved = true;
    attacker.flags.luxrayDamageBonus = legalDiscardIds.length * (attackerData?.form === 'EX' ? 20 : 10);
    addLog(state, `${attackerData?.form === 'EX' ? 'Luxray EX' : 'Luxray'} descartou ${legalDiscardIds.length} carta(s) para +${attacker.flags.luxrayDamageBonus} dano.`, playerId);
    const continuationKind = String(choice.data?.continuationKind ?? 'none');
    clearPendingChoice(state);
    if (continuationKind === 'learn') {
      const attackInstanceId = String(choice.data?.attackInstanceId ?? '');
      const attack = attackCard(state, cards, attackInstanceId);
      if (attack) {
        const result = executeAttack(state, cards, playerId, attacker, attack, targetPokemonId, { kind: 'learn', attackInstanceId });
        if (result === 'resolved') finishLearnAttack(state, cards, playerId, attacker, attackInstanceId, attack);
      }
    } else if (continuationKind === 'reuse') {
      const level = Number(choice.data?.level ?? 0) as 1 | 2 | 3;
      const slot = attacker.attacks.find((entry) => entry.level === level);
      const attack = attackCard(state, cards, slot?.attackInstanceId);
      if (attack) {
        const result = executeAttack(state, cards, playerId, attacker, attack, targetPokemonId, { kind: 'reuse', level });
        if (result === 'resolved') finishReuseAttack(state, cards, playerId, attacker, level, attack);
      }
    }
    if (!state.pendingChoice) advanceResolutionStep(state, cards);
    return true;
  }
  if (action === 'scytherBlock') {
    const targetPlayerId = selected[0] as PlayerId | undefined;
    if (!targetPlayerId || !state.players.some((entry) => entry.id === targetPlayerId)) return false;
    player(state, targetPlayerId).roundFlags.drawBlocked = true;
    addLog(state, `Scyther bloqueou compras de ${player(state, targetPlayerId).name} até o fim da Rodada.`, choice.playerId);
    clearPendingChoice(state);
    advanceResolutionStep(state, cards);
    return true;
  }
  if (action === 'rowletChoosePile') {
    const pileId = selected[0] ?? '';
    if (!isPhysicalPileId(pileId)) return false;
    const top = state.board.piles[pileId].splice(0, 3);
    clearPendingChoice(state);
    if (!top.length) {
      addLog(state, `Rowlet olhou ${PILE_LABELS[pileId]}, mas a pilha estava vazia.`, choice.playerId);
      advanceResolutionStep(state, cards);
      return true;
    }
    setPendingChoice(state, {
      id: choiceId('rowlet-order'),
      kind: 'orderPile',
      playerId: choice.playerId,
      prompt: `Rowlet: reorganize as 3 primeiras cartas de ${PILE_LABELS[pileId]}.`,
      options: permutations(top).map((order) => ({ id: order.join('|'), label: order.map((id) => cardForInstance(state, cards, id) ? cardName(cardForInstance(state, cards, id)!.data) : 'Carta').join(' → ') })),
      data: { action: 'rowletOrder', pileId, cards: top },
    });
    return true;
  }
  if (action === 'rowletOrder') {
    const pileId = String(choice.data?.pileId ?? '');
    const chosenOrder = selected[0]?.split('|') ?? [];
    const held = Array.isArray(choice.data?.cards) ? choice.data.cards : [];
    if (!isPhysicalPileId(pileId) || !chosenOrder.length || chosenOrder.some((id) => !held.includes(id))) return false;
    state.board.piles[pileId].unshift(...chosenOrder);
    addLog(state, `Rowlet reorganizou o topo de ${PILE_LABELS[pileId]}.`, choice.playerId);
    clearPendingChoice(state);
    advanceResolutionStep(state, cards);
    return true;
  }
  if (action === 'mamoswineRemoveEffect' || action === 'mamoswineExRemoveEffect') {
    const selected = selectedIds[0] ?? 'skip';
    clearPendingChoice(state);
    if (selected !== 'skip') {
      const [pokemonId, effectId] = selected.split('|');
      const target = pokemonId ? state.pokemon[pokemonId] : undefined;
      if (target && effectId) {
        target.effects = target.effects.filter((effect) => effect.id !== effectId);
        addLog(state, 'Mamoswine removeu um efeito positivo e causou 10 de dano verdadeiro.');
        applyDamageToPokemon(state, cards, target, 10, choice.playerId, 'dano verdadeiro');
      }
    }
    if (!state.pendingChoice) advanceResolutionStep(state, cards);
    return true;
  }
  if (action === 'megaGalladeReward') {
    const pokemonId = String(choice.data?.pokemonId ?? '');
    const target = state.pokemon[pokemonId];
    const stat = selected[0] as 'offense' | 'defense' | 'speed' | undefined;
    if (!target || !stat || !['offense', 'defense', 'speed'].includes(stat)) return false;
    target.modifiers[stat] += 30;
    addLog(state, `Mega Gallade recebeu +30 em ${stat === 'offense' ? 'Ofensividade' : stat === 'defense' ? 'Resistência' : 'Velocidade'}.`, choice.playerId);
    clearPendingChoice(state);
    advanceResolutionStep(state, cards);
    return true;
  }
  if (action === 'lucarioZBenchBoost') {
    const pokemonId = String(choice.data?.pokemonId ?? '');
    const target = state.pokemon[pokemonId];
    const stat = selected[0] as 'offense' | 'defense' | 'speed' | undefined;
    if (!target || !stat || !['offense', 'defense', 'speed'].includes(stat)) return false;
    target.modifiers[stat] += 10;
    addLog(state, `Lucario Z Mega recebeu +10 em ${stat === 'offense' ? 'Ofensividade' : stat === 'defense' ? 'Resistência' : 'Velocidade'}.`, choice.playerId);
    clearPendingChoice(state);
    return true;
  }
  return false;
}

export function enforceHandLimit(state: GameState, playerId: PlayerId, discardIds: string[]) {
  const owner = player(state, playerId);
  const needed = Math.max(0, owner.hand.length - 12);
  const legal = discardIds.filter((id) => owner.hand.includes(id));
  if (legal.length < needed) {
    addLog(state, `${owner.name} precisa escolher ${needed} carta(s) para respeitar o limite de mão.`, playerId);
    return false;
  }
  for (const id of discardIds) {
    if (owner.hand.length <= 12) break;
    if (removeFromHand(state, playerId, id)) discardInstance(state, id, playerId, 'Limite de mão');
  }
  return owner.hand.length <= 12;
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

function placeClimate(state: GameState, playerId: PlayerId, instanceId: string) {
  const previous = state.board.climate;
  if (previous) discardInstance(state, previous, playerId, 'Clima substituído', 'clima global');
  state.board.climate = instanceId;
  addLog(state, `${player(state, playerId).name} posicionou um Clima global. Ele passa a valer após a resolução.`);
}

function attachTools(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, toolInstanceIds: string[], targets: Record<string, string>) {
  const owner = player(state, playerId);
  const tools = toolInstanceIds.slice(0, 2).filter((id) => owner.hand.includes(id) && cardForInstance(state, cards, id)?.data.cardType === 'tool');
  if (!tools.length) return fail(state, `${owner.name}: nenhuma Ferramenta disponível.`);
  for (const toolId of tools) {
    const target = state.pokemon[targets[toolId] ?? ''];
    if (!target || target.ownerId !== playerId) {
      fail(state, `${owner.name}: Ferramenta sem Pokémon alvo válido.`);
      continue;
    }
    removeFromHand(state, playerId, toolId);
    if (target.toolInstanceId) discardInstance(state, target.toolInstanceId, playerId, 'Ferramenta substituída');
    target.toolInstanceId = toolId;
    addLog(state, `${owner.name} anexou Ferramenta a ${pokemonDisplayName(state, cards, target.pokemonId)}.`);
  }
}

function useRareItem(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, rareItemInstanceId: string, targetPokemonId?: string) {
  const owner = player(state, playerId);
  const stored = cardForInstance(state, cards, rareItemInstanceId);
  if (stored?.data.cardType !== 'rareItem' || !removeFromHand(state, playerId, rareItemInstanceId)) {
    return fail(state, `${owner.name}: Item Raro não está disponível.`);
  }
  discardInstance(state, rareItemInstanceId, playerId, 'Item Raro usado');
  addLog(state, `${owner.name} usou Item Raro${targetPokemonId ? ` em ${pokemonDisplayName(state, cards, targetPokemonId)}` : ''}. Resolver pelo texto da carta quando existir.`);
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
    triggerEnterPlayAbility(state, playerId, pokemon, stored.data);
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
    healPokemon(target, amount);
    target.effects = target.effects.filter((effect) => effect.tone !== 'negative');
    addLog(state, `${targetCard.pokemonName}: cura ${amount} e remove efeitos negativos ao evoluir.`);
  }
  if (isKnockedOut(target, stored.data)) knockoutPokemon(state, cards, target, undefined);
}

function triggerEnterPlayAbility(state: GameState, playerId: PlayerId, pokemon: PokemonInPlay, data: PokemonCardData) {
  if (data.pokemonName === 'Scyther') {
    setPendingChoice(state, {
      id: choiceId('scyther'),
      kind: 'target',
      playerId,
      prompt: 'Scyther: escolha 1 jogador para bloquear compras até o fim da Rodada.',
      options: state.players.filter((entry) => entry.active).map((entry) => ({ id: entry.id, label: entry.name })),
      data: { action: 'scytherBlock' },
    });
  }
  if (data.pokemonName === 'Rowlet') {
    const options = (['attackA', 'attackB'] as PhysicalPileId[]).filter((pileId) => state.board.piles[pileId].length > 0);
    if (!options.length) return;
    setPendingChoice(state, {
      id: choiceId('rowlet-pile'),
      kind: 'target',
      playerId,
      prompt: 'Rowlet: escolha uma Pilha de Ataques para olhar e reorganizar as 3 primeiras cartas.',
      options: options.map((pileId) => ({ id: pileId, label: PILE_LABELS[pileId] })),
      data: { action: 'rowletChoosePile', pokemonId: pokemon.pokemonId },
    });
  }
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
  if (mon.flags.cannotAttackThisRound) return fail(state, `${monCard.pokemonName} não pode atacar nesta Rodada.`);
  if (!attack || !owner.hand.includes(attackInstanceId)) return fail(state, `${owner.name}: Ataque não está mais na mão.`);
  if (mon.attacks.length >= 3) return fail(state, `${monCard.pokemonName} já possui 3 Ataques.`);
  if (!compatibleAttack(monCard, attack)) {
    addLog(state, `${owner.name} tentou usar ${attack.attackName}, mas ${monCard.pokemonName} é incompatível. A carta voltou para a mão.`);
    return;
  }
  const result = executeAttack(state, cards, playerId, mon, attack, targetPokemonId, { kind: 'learn', attackInstanceId });
  if (result === 'resolved') finishLearnAttack(state, cards, playerId, mon, attackInstanceId, attack);
}

function reuseAttack(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, level: 1 | 2 | 3, targetPokemonId: string) {
  const owner = player(state, playerId);
  if (!owner.wildcards.attack) return fail(state, `${owner.name}: Curinga de Ataque já foi usado.`);
  const mon = activePokemon(state, playerId);
  const slot = mon?.attacks.find((entry) => entry.level === level);
  const attack = attackCard(state, cards, slot?.attackInstanceId);
  if (!mon || !slot || !attack) return fail(state, `${owner.name}: Ataque aprendido não disponível.`);
  const monCard = pokemonCard(state, cards, mon);
  if (monCard && mon.flags.cannotAttackThisRound) return fail(state, `${monCard.pokemonName} não pode atacar nesta Rodada.`);
  owner.wildcards.attack = false;
  const result = executeAttack(state, cards, playerId, mon, attack, targetPokemonId, { kind: 'reuse', level });
  if (result === 'resolved') finishReuseAttack(state, cards, playerId, mon, level, attack);
}

type AttackContinuation =
  | { kind: 'learn'; attackInstanceId: string }
  | { kind: 'reuse'; level: 1 | 2 | 3 }
  | { kind: 'none' };

type AttackResult = 'resolved' | 'pending' | 'failed';

function executeAttack(
  state: GameState,
  cards: Record<string, StoredCard>,
  playerId: PlayerId,
  attacker: PokemonInPlay,
  attack: AttackCardData,
  targetPokemonId: string,
  continuation: AttackContinuation = { kind: 'none' },
): AttackResult {
  const target = state.pokemon[targetPokemonId];
  const attackerData = pokemonCard(state, cards, attacker);
  const targetData = target ? pokemonCard(state, cards, target) : undefined;
  if (!attackerData || !target || !targetData || target.knockedOut) {
    fail(state, `${player(state, playerId).name}: alvo de Ataque inválido.`);
    return 'failed';
  }
  if (attackerData.pokemonName === 'Luxray' && !attacker.flags.luxrayDiscardResolved) {
    const owner = player(state, playerId);
    const excluded = continuation.kind === 'learn' ? continuation.attackInstanceId : '';
    const discardable = owner.hand.filter((id) => id !== excluded);
    if (discardable.length) {
      setPendingChoice(state, {
        id: choiceId('luxray-discard'),
        kind: 'discard',
        playerId,
        prompt: `${attackerData.form === 'EX' ? 'Luxray EX' : 'Luxray'}: descarte qualquer número de cartas para aumentar o dano.`,
        options: discardable.map((id) => ({ id, label: cardForInstance(state, cards, id) ? cardName(cardForInstance(state, cards, id)!.data) : 'Carta' })),
        data: {
          action: 'luxrayDiscard',
          multi: true,
          attackerPokemonId: attacker.pokemonId,
          targetPokemonId,
          continuationKind: continuation.kind,
          attackInstanceId: continuation.kind === 'learn' ? continuation.attackInstanceId : undefined,
          level: continuation.kind === 'reuse' ? continuation.level : undefined,
        },
      });
      return 'pending';
    }
    attacker.flags.luxrayDiscardResolved = true;
  }
  const powerOverride = attackPowerWithStadium(state, cards, playerId, attack.power);
  let finalModifier = 0;
  if (attacker.flags.luxrayDamageBonus) {
    finalModifier += Number(attacker.flags.luxrayDamageBonus);
    delete attacker.flags.luxrayDamageBonus;
    delete attacker.flags.luxrayDiscardResolved;
  }
  if (attackerData.pokemonName === 'Piloswine' && attacker.flags.nextAttackPlus20) {
    finalModifier += 20;
    delete attacker.flags.nextAttackPlus20;
  }
  if (attack.attackKind === 'special' && hasAllyNamed(state, cards, target.ownerId, 'Gardevoir')) {
    finalModifier -= 20;
    addLog(state, `Gardevoir reduziu em 20 o dano Especial contra ${targetData.pokemonName}.`);
    for (const ally of alliedPokemon(state, target.ownerId)) {
      const allyData = pokemonCard(state, cards, ally);
      if (allyData?.pokemonName === 'Gardevoir' && allyData.form === 'Mega') {
        ally.modifiers.offense += 10;
        addLog(state, 'Mega Gardevoir recebeu +10 Ofensividade.');
      }
    }
  }
  const breakdown = calculateDamage({ attacker, defender: target, attackerStats: attackerData, defenderStats: targetData, attack, round: state.round, powerOverride, finalModifier });
  const damage = applyBeforeDamageAbilities(state, cards, playerId, attacker, target, attack, breakdown.finalDamage, continuation);
  if (state.pendingChoice) return 'pending';
  markAttackUsed(state, playerId, attacker);
  addLog(state, `${player(state, playerId).name} usou ${attack.attackName} com ${attackerData.pokemonName}.`);
  addLog(state, `Dano Bruto ${breakdown.rawDamage}; Defesa ${breakdown.defensiveStat}; Dano Base +${breakdown.roundBaseDamage}; Modificadores ${breakdown.finalModifier}; Dano Final ${damage}.`);
  const knockedOut = applyDamageToPokemon(state, cards, target, damage, playerId, 'Ataque');
  applyAfterAttackHitAbilities(state, cards, attacker, target);
  if (knockedOut && !state.pendingChoice) offerMegaGalladeReward(state, cards, attacker);
  delete attacker.flags.luxrayDiscardResolved;
  return 'resolved';
}

function markAttackUsed(state: GameState, playerId: PlayerId, attacker: PokemonInPlay) {
  attacker.attackedThisRound = true;
  attacker.flags.attackedOnceThisRound = true;
  player(state, playerId).roundFlags.firstAttackUsed = true;
}

function finishLearnAttack(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, mon: PokemonInPlay, attackInstanceId: string, attack: AttackCardData) {
  const monCard = pokemonCard(state, cards, mon);
  if (!monCard || !removeFromHand(state, playerId, attackInstanceId)) return;
  mon.attacks.push({ level: (mon.attacks.length + 1) as 1 | 2 | 3, attackInstanceId, state: 'learned', summoned: false });
  addLog(state, `${monCard.pokemonName} aprendeu ${attack.attackName} no Nível ${mon.attacks.length}.`);
}

function finishReuseAttack(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, mon: PokemonInPlay, level: 1 | 2 | 3, attack: AttackCardData) {
  const slot = mon.attacks.find((entry) => entry.level === level);
  if (slot?.state === 'learned') {
    slot.state = 'mastered';
    addLog(state, `${attack.attackName} tornou-se Dominado no Nível ${level}.`);
    summonEvolution(state, cards, playerId, mon, level);
  }
}

function applyDamageToPokemon(state: GameState, cards: Record<string, StoredCard>, target: PokemonInPlay, damage: number, responsiblePlayerId?: PlayerId, cause = 'dano') {
  const targetData = pokemonCard(state, cards, target);
  if (!targetData || damage <= 0) return false;
  const before = pokemonHpRemaining(target, targetData);
  target.flags.startedDamageBeforeHit = target.damage;
  target.damage += damage;
  applySurvivalAbilities(state, target, targetData);
  const after = pokemonHpRemaining(target, targetData);
  addLog(state, `${targetData.pokemonName}: ${before} → ${after} HP (${cause}).`);
  if (target.damage >= targetData.hp) {
    knockoutPokemon(state, cards, target, responsiblePlayerId);
    return true;
  }
  return false;
}

function alliedPokemon(state: GameState, playerId: PlayerId) {
  const owner = player(state, playerId);
  return [owner.activePokemonId, ...owner.bench]
    .filter(Boolean)
    .map((id) => state.pokemon[id as string])
    .filter((mon): mon is PokemonInPlay => !!mon && !mon.knockedOut);
}

function offerMegaGalladeReward(state: GameState, cards: Record<string, StoredCard>, attacker: PokemonInPlay) {
  const data = pokemonCard(state, cards, attacker);
  if (data?.pokemonName !== 'Gallade' || data.form !== 'Mega') return;
  setPendingChoice(state, {
    id: choiceId('mega-gallade'),
    kind: 'attribute',
    playerId: attacker.ownerId,
    prompt: 'Mega Gallade nocauteou um Pokémon: escolha um bônus persistente.',
    options: [
      { id: 'offense', label: '+30 Ofensividade' },
      { id: 'defense', label: '+30 Resistência' },
      { id: 'speed', label: '+30 Velocidade' },
    ],
    data: { action: 'megaGalladeReward', pokemonId: attacker.pokemonId },
  });
}

function applyAfterAttackHitAbilities(state: GameState, cards: Record<string, StoredCard>, attacker: PokemonInPlay, target: PokemonInPlay) {
  const attackerData = pokemonCard(state, cards, attacker);
  const targetData = pokemonCard(state, cards, target);
  if (!attackerData || !targetData) return;
  if (attackerData.pokemonName === 'Scizor' && attackerData.form === 'Mega') {
    const removed = Math.max(0, target.modifiers.offense) + Math.max(0, target.modifiers.defense) + Math.max(0, target.modifiers.speed);
    target.modifiers.offense = Math.min(0, target.modifiers.offense);
    target.modifiers.defense = Math.min(0, target.modifiers.defense);
    target.modifiers.speed = Math.min(0, target.modifiers.speed);
    if (removed > 0) addLog(state, `Mega Scizor zerou aumentos positivos de atributos de ${targetData.pokemonName}.`);
  }
  if (attackerData.pokemonName === 'Mamoswine') {
    const targetOwner = player(state, target.ownerId);
    const options = targetOwner.bench.flatMap((pokemonId) => {
      const mon = state.pokemon[pokemonId];
      const data = mon ? pokemonCard(state, cards, mon) : undefined;
      if (!mon || !data || mon.knockedOut) return [];
      return mon.effects
        .filter((effect) => effect.tone === 'positive')
        .map((effect) => ({ id: `${pokemonId}|${effect.id}`, label: `${data.pokemonName}: remover ${effect.name}` }));
    });
    if (options.length) {
      setPendingChoice(state, {
        id: choiceId('mamoswine'),
        kind: 'target',
        playerId: attacker.ownerId,
        prompt: 'Mamoswine: remover 1 efeito positivo de um Pokémon no Banco do jogador atingido?',
        options: [{ id: 'skip', label: 'Não usar' }, ...options],
        data: { action: attackerData.form === 'EX' ? 'mamoswineExRemoveEffect' : 'mamoswineRemoveEffect' },
      });
    }
  }
}

function hasAllyNamed(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, name: string) {
  const owner = player(state, playerId);
  return [owner.activePokemonId, ...owner.bench].filter(Boolean).some((pokemonId) => {
    const mon = state.pokemon[pokemonId as string];
    const data = mon ? pokemonCard(state, cards, mon) : undefined;
    return !!data && !mon?.knockedOut && data.pokemonName === name;
  });
}

function applySurvivalAbilities(state: GameState, target: PokemonInPlay, data: PokemonCardData) {
  if (target.damage < data.hp) return;
  if (data.pokemonName === 'Ralts' && target.flags.startedDamageBeforeHit === 0) {
    target.damage = Math.max(0, data.hp - 10);
    addLog(state, 'Ralts sobreviveu com 10 HP.');
  }
  if (data.pokemonName === 'Kirlia' && target.flags.startedRoundWithoutDamage) {
    target.damage = Math.max(0, data.hp - 10);
    addLog(state, 'Kirlia não pôde ser nocauteada nesta Rodada e ficou com 10 HP.');
  }
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
  continuation: AttackContinuation,
) {
  const targetData = pokemonCard(state, cards, target);
  const attackerData = pokemonCard(state, cards, attacker);
  if (!targetData || !attackerData) return incomingDamage;
  let damage = incomingDamage;
  const targetOwner = player(state, target.ownerId);
  const targetIsBench = targetOwner.bench.includes(target.pokemonId);

  if (targetIsBench) {
    const golett = alliedPokemon(state, target.ownerId).find((mon) => {
      const data = pokemonCard(state, cards, mon);
      return data?.pokemonName === 'Golett' && !mon.flags.golettReducedBenchDamageThisRound;
    });
    if (golett && damage > 0) {
      golett.flags.golettReducedBenchDamageThisRound = true;
      damage = Math.max(0, damage - 10);
      addLog(state, 'Golett reduziu em 10 o primeiro dano recebido por um Pokémon aliado no Banco.');
    }
  }

  const guardian = activePokemon(state, target.ownerId);
  const guardianData = guardian ? pokemonCard(state, cards, guardian) : undefined;
  if (guardian && guardian.pokemonId !== target.pokemonId && guardianData?.pokemonName === 'Golurk' && damage > 0) {
    setPendingChoice(state, {
      id: choiceId('golurk'),
      kind: 'confirm',
      playerId: target.ownerId,
      prompt: `${guardianData.form === 'EX' ? 'Golurk EX' : 'Golurk'}: redirecionar o dano para Golurk?`,
      options: [
        { id: 'yes', label: `Sim, redirecionar e reduzir ${guardianData.form === 'EX' ? 20 : 10}` },
        { id: 'no', label: 'Não redirecionar' },
      ],
      data: {
        action: 'golurkRedirect',
        attackerId,
        attackerPokemonId: attacker.pokemonId,
        targetPokemonId: target.pokemonId,
        guardianPokemonId: guardian.pokemonId,
        damage,
        attackName: attack.attackName,
        continuationKind: continuation.kind,
        attackInstanceId: continuation.kind === 'learn' ? continuation.attackInstanceId : undefined,
        level: continuation.kind === 'reuse' ? continuation.level : undefined,
      },
    });
    return damage;
  }

  if (!target.flags.firstAttackChecked && ['Froakie', 'Frogadier', 'Greninja'].includes(targetData.pokemonName)) {
    target.flags.firstAttackChecked = true;
    let minimum = targetData.pokemonName === 'Froakie' ? 6 : targetData.pokemonName === 'Frogadier' ? 5 : 4;
    if (targetData.form === 'EX') {
      const speedDiff = currentSpeed(state, cards, target) - currentSpeed(state, cards, attacker);
      minimum = Math.max(1, 6 - Math.floor(Math.max(0, speedDiff) / 20));
    }
    const roll = rollD6(state);
    addLog(state, `${targetData.pokemonName} rolou D6 para esquiva: ${roll}.`);
    if (roll >= minimum) {
      addLog(state, `${targetData.pokemonName} evitou o dano do Ataque.`);
      return 0;
    }
  }

  if (targetData.pokemonName === 'Phantump' && !target.flags.phantumpChecked) {
    target.flags.phantumpChecked = true;
    const roll = rollD6(state);
    addLog(state, `Phantump rolou D6 ao ser atacado: ${roll}.`);
    if (roll >= 5) {
      const attackerOwner = player(state, attackerId);
      if (attackerOwner.hand.length) {
        const stolenIndex = Math.floor(nextRandom(state) * attackerOwner.hand.length);
        const [stolen] = attackerOwner.hand.splice(stolenIndex, 1);
        if (stolen) {
          player(state, target.ownerId).hand.push(stolen);
          state.instances[stolen]!.controllerId = target.ownerId;
          state.instances[stolen]!.lastControllerId = target.ownerId;
          addLog(state, 'Phantump roubou 1 carta aleatória da mão do atacante.');
        }
      } else {
        addLog(state, 'Phantump ativou, mas o atacante não tinha cartas na mão.');
      }
    }
  }

  if (targetData.pokemonName === 'Swinub' && !target.flags.damagedByAttackThisRound && damage > 0) {
    target.flags.damagedByAttackThisRound = true;
    setPendingChoice(state, {
      id: choiceId('swinub'),
      kind: 'confirm',
      playerId: target.ownerId,
      prompt: 'Usar a habilidade de Swinub para reduzir 20 de dano? Se usar, Swinub não poderá atacar nesta Rodada.',
      options: [
        { id: 'yes', label: 'Sim, reduzir 20' },
        { id: 'no', label: 'Não, receber dano normal' },
      ],
      data: {
        action: 'swinubDamage',
        attackerId,
        attackerPokemonId: attacker.pokemonId,
        targetPokemonId: target.pokemonId,
        damage,
        attackName: attack.attackName,
        continuationKind: continuation.kind,
        attackInstanceId: continuation.kind === 'learn' ? continuation.attackInstanceId : undefined,
        level: continuation.kind === 'reuse' ? continuation.level : undefined,
      },
    });
    return damage;
  }
  if (targetData.pokemonName === 'Shinx' && damage === 10) damage = 0;
  if (targetData.pokemonName === 'Luxio' && damage <= 20) damage = 0;
  if (attackerData.pokemonName === 'Kleavor') {
    const before = target.modifiers.defense;
    adjustPokemonModifier(state, cards, target, 'defense', -10, 'Kleavor');
    if (target.modifiers.defense !== before) target.flags[`kleavorReductions:${attacker.pokemonId}`] = Number(target.flags[`kleavorReductions:${attacker.pokemonId}`] ?? 0) + 1;
    damage += Number(target.flags[`kleavorReductions:${attacker.pokemonId}`] ?? 0) * 10;
  }
  if (targetData.pokemonName === 'Piloswine') {
    const order = state.resolution?.order ?? [];
    if (order.indexOf(target.ownerId) > order.indexOf(attackerId)) target.flags.nextAttackPlus20 = true;
  }
  return Math.max(0, damage);
}

function healPokemon(pokemon: PokemonInPlay, amount: number) {
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
    const replacements = owner.bench.filter((id) => !state.pokemon[id]?.knockedOut);
    if (replacements.length === 1) {
      promoteAfterKnockout(state, cards, owner.id, replacements[0]!);
    } else if (replacements.length > 1) {
      setPendingChoice(state, {
        id: choiceId('ko-replacement'),
        kind: 'replacement',
        playerId: owner.id,
        prompt: 'Escolha seu novo Pokémon Ativo.',
        options: replacements.map((id) => ({ id, label: pokemonDisplayName(state, cards, id) })),
        data: { action: 'koReplacement', knockedOutPokemonId: pokemon.pokemonId },
      });
    } else {
      owner.activePokemonId = undefined;
      addLog(state, `${owner.name} ficou sem Pokémon Ativo válido.`);
    }
  }
}

function promoteAfterKnockout(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, replacementPokemonId: string) {
  const owner = player(state, playerId);
  const knockedOutId = owner.activePokemonId;
  if (!knockedOutId || !owner.bench.includes(replacementPokemonId)) return fail(state, `${owner.name}: substituição por KO sem alvo válido.`);
  owner.bench = owner.bench.filter((id) => id !== replacementPokemonId);
  owner.bench.push(knockedOutId);
  owner.activePokemonId = replacementPokemonId;
  addLog(state, `${owner.name} promoveu ${pokemonDisplayName(state, cards, replacementPokemonId)} após KO.`);
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
  for (let itemIndex = 0; itemIndex < playable.length; itemIndex += 1) {
    const itemId = playable[itemIndex]!;
    const stored = cardForInstance(state, cards, itemId);
    if (stored?.data.cardType !== 'item') continue;
    removeFromHand(state, playerId, itemId);
    if (stored.id === 'card-pjo-089' || stored.data.name === 'Spray de Emergência') {
      const target = state.pokemon[targets[itemId] ?? ''];
      if (target?.ownerId === playerId) {
        healPokemon(target, 30);
        addLog(state, `${owner.name} usou Spray de Emergência e curou 30 de ${pokemonDisplayName(state, cards, target.pokemonId)}.`);
      }
    } else if (stored.id === 'card-pjo-090' || stored.data.name === 'Passagem Secreta') {
      const benchId = targets[itemId];
      if (benchId) {
        switchActive(state, cards, playerId, benchId, 'switch');
        const active = activePokemon(state, playerId);
        if (active) {
          active.temporaryModifiers.speed += 10;
          addLog(state, 'Passagem Secreta deu +10 VEL ao novo Ativo até o fim da Rodada.');
        }
      }
    } else if (stored.id === 'card-pjo-091' || stored.data.name === 'Caixa de Reposição') {
      const discardId = targets[itemId];
      const index = state.board.discard.findIndex((entry) => entry.instanceId === discardId && entry.lastControllerId === playerId && cardForInstance(state, cards, entry.instanceId)?.data.cardType === 'attack');
      if (index >= 0) owner.hand.push(state.board.discard.splice(index, 1)[0]!.instanceId);
      addLog(state, `${owner.name} usou Caixa de Reposição.`);
    } else if (stored.id === 'card-pjo-092' || stored.data.name === 'Scanner de Rotas') {
      const pileId = (targets[itemId] as PhysicalPileId) || 'pokemonA';
      if (!isPhysicalPileId(pileId)) {
        discardInstance(state, itemId, playerId, 'Item usado');
        return fail(state, `${owner.name}: Scanner de Rotas sem pilha válida.`);
      }
      const pile = state.board.piles[pileId];
      const top = pile.splice(0, 3);
      discardInstance(state, itemId, playerId, 'Item usado');
      if (!top.length) {
        addLog(state, `${owner.name} usou Scanner de Rotas, mas ${PILE_LABELS[pileId]} estava vazia.`);
        continue;
      }
      setPendingChoice(state, {
        id: choiceId('scanner'),
        kind: 'orderPile',
        playerId,
        prompt: `Scanner de Rotas: reorganize o topo de ${PILE_LABELS[pileId]}.`,
        options: permutations(top).map((order) => ({ id: order.join('|'), label: order.map((id) => cardForInstance(state, cards, id) ? cardName(cardForInstance(state, cards, id)!.data) : 'Carta').join(' → ') })),
        data: {
          action: 'scannerOrder',
          pileId,
          cards: top,
          remainingItemIds: playable.slice(itemIndex + 1),
          targetsJson: JSON.stringify(targets),
        },
      });
      return;
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
  applyActiveExitAbilities(state, cards, previous, reason);
  if (reason === 'switch') applySwitchStadiums(state, cards, playerId, benchPokemonId);
  return true;
}

function applyActiveExitAbilities(state: GameState, cards: Record<string, StoredCard>, outgoingPokemonId: string, reason: 'switch' | 'koReplacement') {
  const outgoing = state.pokemon[outgoingPokemonId];
  const outgoingData = outgoing ? pokemonCard(state, cards, outgoing) : undefined;
  if (!outgoing || !outgoingData || outgoing.knockedOut) return;
  for (const observer of Object.values(state.pokemon)) {
    const observerData = pokemonCard(state, cards, observer);
    if (!observerData || observer.knockedOut || observerData.pokemonName !== 'Decidueye') continue;
    const owner = player(state, observer.ownerId);
    if (owner.activePokemonId !== observer.pokemonId && !owner.bench.includes(observer.pokemonId)) continue;
    const amount = observerData.form === 'EX' && owner.activePokemonId === observer.pokemonId ? 20 : 10;
    addLog(state, `Decidueye puniu ${outgoingData.pokemonName} por sair de Ativo (${reason}).`);
    applyDamageToPokemon(state, cards, outgoing, amount, observer.ownerId, 'dano verdadeiro');
    if (state.pendingChoice) return;
  }
}

function applySwitchStadiums(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, incomingPokemonId: string) {
  for (const slot of Object.keys(state.board.stadiums) as StadiumSlotId[]) {
    const stadium = cardForInstance(state, cards, state.board.stadiums[slot] ?? undefined);
    if (stadium?.id !== 'card-pjo-095') continue;
    const [a, b] = STADIUM_CONNECTIONS[slot];
    if (![state.players[a]?.id, state.players[b]?.id].includes(playerId)) continue;
    const incoming = state.pokemon[incomingPokemonId];
    if (incoming) {
      healPokemon(incoming, 10);
      addLog(state, 'Passarela dos Ventos curou 10 do Pokémon que entrou.');
    }
  }
}

function adjustPokemonModifier(
  state: GameState,
  cards: Record<string, StoredCard>,
  pokemon: PokemonInPlay,
  stat: 'offense' | 'defense' | 'speed',
  delta: number,
  source: string,
) {
  const data = pokemonCard(state, cards, pokemon);
  if (!data || delta === 0) return;
  if (delta < 0 && data.pokemonName === 'Scizor') {
    addLog(state, `${source}: Scizor ignorou um efeito negativo.`);
    return;
  }
  if (stat === 'speed' && delta < 0) {
    const protection = pokemon.effects.find((effect) => effect.data?.ignoreNextSpeedReduction);
    if (protection) {
      protection.data = { ...protection.data, ignoreNextSpeedReduction: false };
      addLog(state, `${source}: ${data.pokemonName} ignorou a primeira redução de VEL.`);
      return;
    }
  }
  pokemon.modifiers[stat] += delta;
  addLog(state, `${source}: ${data.pokemonName} recebeu ${delta >= 0 ? '+' : ''}${delta} em ${stat === 'offense' ? 'Ofensividade' : stat === 'defense' ? 'Resistência' : 'VEL'}.`);
}

export function manualAdjustDamage(state: GameState, cards: Record<string, StoredCard>, pokemonId: string, delta: number) {
  const target = state.pokemon[pokemonId];
  if (!target) return;
  target.damage = Math.max(0, target.damage + delta);
  addLog(state, `AJUSTE MANUAL DE TESTE: ${pokemonDisplayName(state, cards, pokemonId)} recebeu ajuste de dano ${delta}.`);
}

export function manualHealDamage(state: GameState, cards: Record<string, StoredCard>, pokemonId: string, amount: number) {
  const target = state.pokemon[pokemonId];
  if (!target) return;
  healPokemon(target, amount);
  addLog(state, `AJUSTE MANUAL DE TESTE: ${pokemonDisplayName(state, cards, pokemonId)} curou ${amount}.`);
}

export function manualAdjustModifier(state: GameState, cards: Record<string, StoredCard>, pokemonId: string, stat: 'offense' | 'defense' | 'speed', delta: number) {
  const target = state.pokemon[pokemonId];
  if (!target) return;
  adjustPokemonModifier(state, cards, target, stat, delta, 'AJUSTE MANUAL DE TESTE');
}

export function manualAdjustPoints(state: GameState, playerId: PlayerId, delta: number) {
  player(state, playerId).points += delta;
  addLog(state, `AJUSTE MANUAL DE TESTE: pontos de ${player(state, playerId).name} ${delta >= 0 ? '+' : ''}${delta}.`);
}

export function manualSetKnockedOut(state: GameState, cards: Record<string, StoredCard>, pokemonId: string, knockedOut: boolean) {
  const target = state.pokemon[pokemonId];
  if (!target) return;
  target.knockedOut = knockedOut;
  if (knockedOut) {
    const data = pokemonCard(state, cards, target);
    if (data) target.damage = Math.max(target.damage, data.hp);
  }
  addLog(state, `AJUSTE MANUAL DE TESTE: ${pokemonDisplayName(state, cards, pokemonId)} foi marcado como ${knockedOut ? 'KO' : 'não KO'}.`);
}

export function manualToggleResurrection(state: GameState, cards: Record<string, StoredCard>, pokemonId: string) {
  const target = state.pokemon[pokemonId];
  if (!target) return;
  target.resurrectionUsed = !target.resurrectionUsed;
  addLog(state, `AJUSTE MANUAL DE TESTE: ressurreição de ${pokemonDisplayName(state, cards, pokemonId)} = ${target.resurrectionUsed ? 'usada' : 'disponível'}.`);
}

export function resurrectPokemon(state: GameState, cards: Record<string, StoredCard>, pokemonId: string, hp: number) {
  const target = state.pokemon[pokemonId];
  const data = target ? pokemonCard(state, cards, target) : undefined;
  if (!target || !data || target.resurrectionUsed || target.knockoutCount > 1) return false;
  target.resurrectionUsed = true;
  target.knockedOut = false;
  target.damage = Math.max(0, data.hp - Math.max(1, Math.min(data.hp, hp)));
  addLog(state, `${data.pokemonName} usou Ressurreição e voltou com ${Math.max(1, Math.min(data.hp, hp))} HP.`);
  return true;
}

export function manualRemoveEffect(state: GameState, cards: Record<string, StoredCard>, pokemonId: string, effectId: string) {
  const target = state.pokemon[pokemonId];
  if (!target) return false;
  const before = target.effects.length;
  target.effects = target.effects.filter((effect) => effect.id !== effectId);
  if (target.effects.length !== before) addLog(state, `AJUSTE MANUAL DE TESTE: efeito removido de ${pokemonDisplayName(state, cards, pokemonId)}.`);
  return target.effects.length !== before;
}

export function manualSwitchActive(state: GameState, cards: Record<string, StoredCard>, playerId: PlayerId, benchPokemonId: string) {
  const switched = switchActive(state, cards, playerId, benchPokemonId, 'switch');
  addLog(state, `AJUSTE MANUAL DE TESTE: troca ativa solicitada para ${player(state, playerId).name}.`);
  return switched;
}

export function manualLogNote(state: GameState, note: string) {
  addLog(state, `AJUSTE MANUAL DE TESTE: ${note || 'nota sem texto'}.`);
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
