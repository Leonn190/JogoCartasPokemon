import assert from 'node:assert/strict';
import { calculateDamage, knockoutPointValue } from '../src/game/damage';
import {
  defineResolutionOrderWithCards,
  enforceHandLimit,
  performFreeAcquisition,
  programPlayerAction,
  resolveNextAction,
  resolvePendingChoice,
  resurrectPokemon,
  validateInvariants,
} from '../src/game/engine';
import type { AttackCardData, CardData, PokemonCardData, StoredCard } from '../src/types/card';
import type { CardInstance, GameState, PlayerId, PokemonInPlay } from '../src/game/types';

function pokemonData(name: string, overrides: Partial<PokemonCardData> = {}): PokemonCardData {
  return {
    cardType: 'pokemon',
    artwork: '',
    artworkTransform: { scale: 1, x: 0, y: 0 },
    cardNumber: 1,
    setTotal: 1,
    setCode: 'T',
    pokemonId: overrides.pokemonId ?? 1,
    pokemonName: name,
    form: overrides.form ?? 'Normal',
    rarity: overrides.rarity ?? 'common',
    type: overrides.type ?? 'Fogo',
    stage: overrides.stage ?? 'BÁSICO',
    previousEvolution: overrides.previousEvolution ?? '',
    previousEvolutionImage: '',
    expandedArtwork: false,
    pokedexNumber: null,
    genus: '',
    height: '',
    weight: '',
    region: '',
    abilityName: '',
    abilityDescription: '',
    flavorText: '',
    hp: overrides.hp ?? 100,
    attack: overrides.attack ?? 70,
    defense: overrides.defense ?? 60,
    specialAttack: overrides.specialAttack ?? 70,
    specialDefense: overrides.specialDefense ?? 60,
    speed: overrides.speed ?? 50,
  };
}

function attackData(name: string, overrides: Partial<AttackCardData> = {}): AttackCardData {
  return {
    cardType: 'attack',
    artwork: '',
    artworkTransform: { scale: 1, x: 0, y: 0 },
    cardNumber: 1,
    setTotal: 1,
    setCode: 'T',
    attackKind: overrides.attackKind ?? 'normal',
    attackName: name,
    attackDescription: '',
    power: overrides.power ?? 150,
    type: overrides.type ?? 'Fogo',
    compatibilityMode: overrides.compatibilityMode ?? 'type',
    compatiblePokemon: overrides.compatiblePokemon ?? [],
    compatibleType: overrides.compatibleType ?? 'Fogo',
  };
}

function stored(id: string, data: CardData): StoredCard {
  return { id, collectionId: 'test', createdAt: '', updatedAt: '', data };
}

function instance(instanceId: string, cardId: string, controllerId?: PlayerId): CardInstance {
  return { instanceId, cardId, originalCardId: cardId, ownerId: controllerId ?? 'central', controllerId, lastControllerId: controllerId, origin: 'test' };
}

function mon(pokemonId: string, ownerId: PlayerId, instanceId: string): PokemonInPlay {
  return {
    pokemonId,
    ownerId,
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
    flags: { startedRoundWithoutDamage: true },
  };
}

function state(cards: Record<string, StoredCard>): GameState {
  const instances: Record<string, CardInstance> = {};
  for (const id of Object.keys(cards)) instances[`i-${id}`] = instance(`i-${id}`, id);
  const p1 = mon('p1-active', 'player-1', 'i-basic');
  const p2 = mon('p2-active', 'player-2', 'i-target');
  instances['i-basic']!.controllerId = 'player-1';
  instances['i-target']!.controllerId = 'player-2';
  return {
    schemaVersion: 1,
    id: 'test-state',
    status: 'playing',
    collectionId: 'test',
    collectionName: 'Test',
    round: 4,
    phase: 'resolution',
    priorityPlayerId: 'player-3',
    players: [
      { id: 'player-1', name: 'A', active: true, championId: 'c', championName: 'C', points: 0, victoryPieces: 0, defeatPieces: 0, hand: [], activePokemonId: p1.pokemonId, bench: [], wildcards: { attack: true, draw: true, switch: true }, programmed: { locked: true }, roundFlags: { supporterUsed: false, firstAttackUsed: false, drawBlocked: false, recoveryActionOnly: false, beforeActingDone: true } },
      { id: 'player-2', name: 'B', active: true, championId: 'c', championName: 'C', points: 0, victoryPieces: 0, defeatPieces: 0, hand: [], activePokemonId: p2.pokemonId, bench: [], wildcards: { attack: true, draw: true, switch: true }, programmed: { locked: true }, roundFlags: { supporterUsed: false, firstAttackUsed: false, drawBlocked: false, recoveryActionOnly: false, beforeActingDone: true } },
      { id: 'player-3', name: 'C', active: true, championId: 'c', championName: 'C', points: 0, victoryPieces: 0, defeatPieces: 0, hand: [], bench: [], wildcards: { attack: true, draw: true, switch: true }, programmed: { locked: true }, roundFlags: { supporterUsed: false, firstAttackUsed: false, drawBlocked: false, recoveryActionOnly: false, beforeActingDone: true } },
      { id: 'player-4', name: 'D', active: false, championId: 'c', championName: 'C', points: 0, victoryPieces: 0, defeatPieces: 0, hand: [], bench: [], wildcards: { attack: true, draw: true, switch: true }, programmed: { locked: true }, roundFlags: { supporterUsed: false, firstAttackUsed: false, drawBlocked: false, recoveryActionOnly: false, beforeActingDone: true } },
    ],
    board: { piles: { pokemonA: [], pokemonB: [], trainerA: [], trainerB: [], attackA: [], attackB: [] }, pokemonZone: [], discard: [], stadiums: { AB: null, BC: null, CD: null, DA: null }, climate: null },
    instances,
    pokemon: { [p1.pokemonId]: p1, [p2.pokemonId]: p2 },
    formation: { mode: 'test', collectionId: 'test', collectionName: 'Test', selectedLineIds: [], diagnostics: [], officialMissing: {} },
    evolutionLines: [{ id: 'line-basic', basicCardId: 'basic', name: 'Basic', rarity: 'common', cards: ['basic', 'stage1'], futureByLevel: ['stage1'], branches: [] }],
    rng: { seed: 1, state: 1 },
    timerMode: 'none',
    resolution: { order: ['player-1'], index: 0, slot: 'primary' },
    ranking: [],
    log: [],
    createdAt: '',
    updatedAt: '',
    dev: { snapshots: [], revealPiles: false, interpretations: [] },
  };
}

const cards = {
  basic: stored('basic', pokemonData('Basic', { pokemonId: 1 })),
  stage1: stored('stage1', pokemonData('Stage1', { pokemonId: 1, stage: 'ESTÁGIO 1', previousEvolution: 'Basic', hp: 130 })),
  target: stored('target', pokemonData('Target', { pokemonId: 2, hp: 100, defense: 60, specialDefense: 40 })),
  attack: stored('attack', attackData('Hit')),
  badAttack: stored('badAttack', attackData('Bad', { compatibleType: 'Água' })),
  scanner: stored('scanner', { cardType: 'item', name: 'Scanner de Rotas', effectText: '', usageText: '', artwork: '', artworkTransform: { scale: 1, x: 0, y: 0 }, cardNumber: 92, setTotal: 96, setCode: 'T' }),
  stadium: stored('stadium', { cardType: 'stadium', name: 'Estádio', effectText: '', usageText: '', artwork: '', artworkTransform: { scale: 1, x: 0, y: 0 }, cardNumber: 95, setTotal: 96, setCode: 'T' }),
  climate: stored('climate', { cardType: 'climate', name: 'Clima', effectText: '', artwork: '', artworkTransform: { scale: 1, x: 0, y: 0 }, cardNumber: 1, setTotal: 1, setCode: 'T' }),
  tool: stored('tool', { cardType: 'tool', name: 'Ferramenta', effectText: '', usageText: '', artwork: '', artworkTransform: { scale: 1, x: 0, y: 0 }, cardNumber: 1, setTotal: 1, setCode: 'T' }),
} satisfies Record<string, StoredCard>;

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

test('dano clássico Normal com Dano Base', () => {
  const attacker = mon('a', 'player-1', 'i-basic');
  const defender = mon('d', 'player-2', 'i-target');
  const result = calculateDamage({ attacker, defender, attackerStats: cards.basic.data as PokemonCardData, defenderStats: cards.target.data as PokemonCardData, attack: cards.attack.data as AttackCardData, round: 4 });
  assert.equal(result.rawDamage, 100);
  assert.equal(result.roundBaseDamage, 20);
  assert.equal(result.finalDamage, 60);
});

test('dano Especial usa SPDEF e nunca fica negativo', () => {
  const attacker = mon('a', 'player-1', 'i-basic');
  const defender = mon('d', 'player-2', 'i-target');
  const weak = calculateDamage({ attacker, defender, attackerStats: pokemonData('A', { specialAttack: 10 }), defenderStats: pokemonData('D', { specialDefense: 200 }), attack: attackData('S', { attackKind: 'special' }), round: 1 });
  assert.equal(weak.finalDamage, 0);
});

test('pontos por estágio/forma e segunda derrota', () => {
  assert.equal(knockoutPointValue(pokemonData('E1', { stage: 'ESTÁGIO 1' })), 2);
  assert.equal(knockoutPointValue(pokemonData('EX', { form: 'EX' })), 5);
  assert.equal(knockoutPointValue(pokemonData('EX', { form: 'EX' }), 1), 2);
});

test('evolução preserva dano e pilha de evolução', () => {
  const s = state(cards);
  s.players[0]!.hand.push('i-stage1');
  s.instances['i-stage1']!.controllerId = 'player-1';
  s.pokemon['p1-active']!.damage = 30;
  programPlayerAction(s, 'player-1', 'primary', { kind: 'playPokemon', cardInstanceId: 'i-stage1', targetPokemonId: 'p1-active' });
  resolveNextAction(s, cards);
  assert.equal(s.pokemon['p1-active']!.currentCardInstanceId, 'i-stage1');
  assert.equal(s.pokemon['p1-active']!.damage, 30);
  assert.deepEqual(s.pokemon['p1-active']!.evolutionStack, ['i-basic', 'i-stage1']);
  validateInvariants(s);
});

test('ataque incompatível não é aprendido', () => {
  const s = state(cards);
  s.players[0]!.hand.push('i-badAttack');
  s.instances['i-badAttack']!.controllerId = 'player-1';
  programPlayerAction(s, 'player-1', 'primary', { kind: 'learnAttack', attackInstanceId: 'i-badAttack', targetPokemonId: 'p2-active' });
  resolveNextAction(s, cards);
  assert.equal(s.pokemon['p1-active']!.attacks.length, 0);
});

test('ataque compatível aprende, causa dano, domina ao reutilizar e convoca', () => {
  const s = state(cards);
  s.players[0]!.hand.push('i-attack');
  s.instances['i-attack']!.controllerId = 'player-1';
  programPlayerAction(s, 'player-1', 'primary', { kind: 'learnAttack', attackInstanceId: 'i-attack', targetPokemonId: 'p2-active' });
  resolveNextAction(s, cards);
  assert.equal(s.pokemon['p1-active']!.attacks[0]?.state, 'learned');
  s.resolution = { order: ['player-1'], index: 0, slot: 'primary' };
  s.players[0]!.programmed.primary = { kind: 'reuseAttack', level: 1, targetPokemonId: 'p2-active' };
  s.players[0]!.wildcards.attack = true;
  s.board.piles.pokemonA.push('i-stage1');
  resolveNextAction(s, cards);
  assert.equal(s.pokemon['p1-active']!.attacks[0]?.state, 'mastered');
  assert.ok(s.players[0]!.hand.includes('i-stage1'));
});

test('aquisição segue prioridade e ignora inativos', () => {
  const s = state(cards);
  s.phase = 'acquisitions';
  s.acquisition = { playerIndex: 0, visible: true, order: ['player-3', 'player-1', 'player-2'] };
  s.board.piles.attackA.push('i-attack');
  assert.equal(performFreeAcquisition(s, 'player-1', 'attackA'), false);
  assert.equal(performFreeAcquisition(s, 'player-3', 'attackA'), true);
  assert.ok(s.players[2]!.hand.includes('i-attack'));
});

test('limite de mão exige escolha suficiente', () => {
  const s = state(cards);
  for (let i = 0; i < 13; i += 1) {
    const id = `extra-${i}`;
    s.instances[id] = instance(id, 'attack', 'player-1');
    s.players[0]!.hand.push(id);
  }
  assert.equal(enforceHandLimit(s, 'player-1', []), false);
  assert.equal(s.players[0]!.hand.length, 13);
  assert.equal(enforceHandLimit(s, 'player-1', [s.players[0]!.hand[0]!]), true);
  assert.equal(s.players[0]!.hand.length, 12);
});

test('Scanner de Rotas reorganiza o topo escolhido', () => {
  const s = state(cards);
  s.players[0]!.hand.push('i-scanner');
  s.instances['i-scanner']!.controllerId = 'player-1';
  s.board.piles.attackA.push('top1', 'top2', 'top3', 'bottom');
  s.instances.top1 = instance('top1', 'attack');
  s.instances.top2 = instance('top2', 'badAttack');
  s.instances.top3 = instance('top3', 'attack');
  programPlayerAction(s, 'player-1', 'primary', { kind: 'useItems', itemInstanceIds: ['i-scanner'], targets: { 'i-scanner': 'attackA' } });
  resolveNextAction(s, cards);
  assert.equal(s.pendingChoice?.kind, 'orderPile');
  resolvePendingChoice(s, cards, s.pendingChoice!.id, ['top3|top1|top2']);
  assert.deepEqual(s.board.piles.attackA.slice(0, 4), ['top3', 'top1', 'top2', 'bottom']);
});

test('Estádio, Clima e Ferramenta substituem/anexam sem duplicar instância', () => {
  const s = state(cards);
  s.players[0]!.hand.push('i-stadium', 'i-climate', 'i-tool');
  s.instances['i-stadium']!.controllerId = 'player-1';
  s.instances['i-climate']!.controllerId = 'player-1';
  s.instances['i-tool']!.controllerId = 'player-1';
  programPlayerAction(s, 'player-1', 'primary', { kind: 'placeStadium', stadiumInstanceId: 'i-stadium', slotId: 'AB' });
  resolveNextAction(s, cards);
  s.resolution = { order: ['player-1'], index: 0, slot: 'primary' };
  s.players[0]!.programmed.primary = { kind: 'placeClimate', climateInstanceId: 'i-climate' };
  resolveNextAction(s, cards);
  s.resolution = { order: ['player-1'], index: 0, slot: 'primary' };
  s.players[0]!.programmed.primary = { kind: 'attachTools', toolInstanceIds: ['i-tool'], targets: { 'i-tool': 'p1-active' } };
  resolveNextAction(s, cards);
  assert.equal(s.board.stadiums.AB, 'i-stadium');
  assert.equal(s.board.climate, 'i-climate');
  assert.equal(s.pokemon['p1-active']!.toolInstanceId, 'i-tool');
  validateInvariants(s);
});

test('ressurreição normal só acontece uma vez', () => {
  const s = state(cards);
  s.pokemon['p1-active']!.knockedOut = true;
  s.pokemon['p1-active']!.knockoutCount = 1;
  assert.equal(resurrectPokemon(s, cards, 'p1-active', 40), true);
  assert.equal(resurrectPokemon(s, cards, 'p1-active', 40), false);
});

test('ordem por VEL fica travada mesmo se atributos mudarem depois', () => {
  const s = state(cards);
  defineResolutionOrderWithCards(s, cards);
  const firstOrder = s.resolution!.order.join(',');
  s.pokemon['p1-active']!.modifiers.speed += 1000;
  assert.equal(s.resolution!.order.join(','), firstOrder);
});

console.log('journey engine tests passed');
