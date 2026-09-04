import { JOURNEY_PLAY_SET } from '../data/gameConfig';
import type { CardCollection, CardType, PokemonCardData, StoredCard } from '../types/card';
import type {
  CardInstance,
  CardLookup,
  EvolutionLine,
  FormationMode,
  GameState,
  JourneyFormation,
  PhysicalPileId,
  PlayerId,
  PlayerState,
  TimerMode,
} from './types';
import { addLog, clone, createSeed, makeInstance, nowIso, shuffleInPlace, splitAlternating } from './utils';

const PLAYER_IDS: PlayerId[] = ['player-1', 'player-2', 'player-3', 'player-4'];
const SPECIAL_FINAL_FORMS = new Set(['EX', 'Mega', 'Radiante', 'Gmax', 'Gigantamax']);

export function createLookup(collection: CardCollection): CardLookup {
  const cards: Record<string, StoredCard> = {};
  for (const stored of collection.cards) {
    if (!cards[stored.id]) cards[stored.id] = clone(stored);
  }
  return { collection: { ...collection, cards: Object.values(cards) }, cards };
}

function normalizedName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isBasicPokemon(card: StoredCard) {
  return card.data.cardType === 'pokemon' && card.data.stage === 'BÁSICO';
}

function isSpecialFinal(card: StoredCard) {
  return card.data.cardType === 'pokemon' && SPECIAL_FINAL_FORMS.has(String(card.data.form));
}

function pokemonCards(collection: CardCollection) {
  return collection.cards.filter((card) => card.data.cardType === 'pokemon') as Array<StoredCard & { data: PokemonCardData }>;
}

function cardCopiesForPokemon(card: StoredCard & { data: PokemonCardData }, basicRarity: PokemonCardData['rarity']) {
  if (SPECIAL_FINAL_FORMS.has(String(card.data.form))) return 1;
  if (basicRarity === 'common') return 3;
  if (basicRarity === 'uncommon') return 2;
  return 1;
}

export function buildEvolutionLines(collection: CardCollection): EvolutionLine[] {
  const pokemons = pokemonCards(collection).sort((a, b) => a.data.cardNumber - b.data.cardNumber || a.id.localeCompare(b.id));
  const byPrevious = new Map<string, Array<StoredCard & { data: PokemonCardData }>>();
  for (const card of pokemons) {
    const previous = normalizedName(card.data.previousEvolution || '');
    if (!previous) continue;
    const list = byPrevious.get(previous) ?? [];
    list.push(card);
    byPrevious.set(previous, list);
  }

  const result: EvolutionLine[] = [];
  for (const basic of pokemons.filter(isBasicPokemon)) {
    const chosen: string[] = [basic.id];
    const branches: string[][] = [];
    let cursorName = normalizedName(basic.data.pokemonName);
    const visited = new Set<string>([basic.id]);

    for (let depth = 0; depth < 4; depth += 1) {
      const options = (byPrevious.get(cursorName) ?? []).filter((card) => !visited.has(card.id));
      if (!options.length) break;
      const normalOptions = options.filter((card) => !isSpecialFinal(card));
      const specialOptions = options.filter(isSpecialFinal);
      const pool = normalOptions.length ? normalOptions : specialOptions;
      if (options.length > 1) branches.push(options.map((card) => card.id));
      const next = pool.sort((a, b) => a.data.cardNumber - b.data.cardNumber || a.id.localeCompare(b.id))[0]!;
      chosen.push(next.id);
      visited.add(next.id);
      cursorName = normalizedName(next.data.pokemonName);
      if (isSpecialFinal(next)) break;
    }

    const specialCandidates = pokemons
      .filter((card) => isSpecialFinal(card)
        && !chosen.includes(card.id)
        && (normalizedName(card.data.previousEvolution) === cursorName
          || card.data.pokemonId === (collection.cards.find((entry) => entry.id === chosen.at(-1))?.data as PokemonCardData | undefined)?.pokemonId));
    if (specialCandidates.length) {
      branches.push(specialCandidates.map((card) => card.id));
      chosen.push(specialCandidates.sort((a, b) => a.data.cardNumber - b.data.cardNumber || a.id.localeCompare(b.id))[0]!.id);
    }

    result.push({
      id: `line-${basic.id}`,
      basicCardId: basic.id,
      name: basic.data.pokemonName,
      rarity: basic.data.rarity,
      cards: chosen,
      futureByLevel: chosen.slice(1, 4),
      branches,
    });
  }
  return result.sort((a, b) => {
    const aCard = collection.cards.find((card) => card.id === a.basicCardId);
    const bCard = collection.cards.find((card) => card.id === b.basicCardId);
    return (aCard?.data.cardNumber ?? 0) - (bCard?.data.cardNumber ?? 0) || a.id.localeCompare(b.id);
  });
}

export function validateFormation(collection: CardCollection) {
  const uniqueCards = createLookup(collection).collection.cards;
  const counts: Record<CardType, number> = {
    pokemon: uniqueCards.filter((card) => card.data.cardType === 'pokemon').length,
    attack: uniqueCards.filter((card) => card.data.cardType === 'attack').length,
    item: uniqueCards.filter((card) => card.data.cardType === 'item').length,
    supporter: uniqueCards.filter((card) => card.data.cardType === 'supporter').length,
    stadium: uniqueCards.filter((card) => card.data.cardType === 'stadium').length,
    tool: uniqueCards.filter((card) => card.data.cardType === 'tool').length,
    rareItem: uniqueCards.filter((card) => card.data.cardType === 'rareItem').length,
    climate: uniqueCards.filter((card) => card.data.cardType === 'climate').length,
    champion: uniqueCards.filter((card) => card.data.cardType === 'champion').length,
  };
  const lines = buildEvolutionLines({ ...collection, cards: uniqueCards });
  const officialMissing = {
    pokemonBasics: Math.max(0, JOURNEY_PLAY_SET.pokemonBasics - lines.length),
    attacks: Math.max(0, JOURNEY_PLAY_SET.attacks - counts.attack),
    item: Math.max(0, JOURNEY_PLAY_SET.item - counts.item),
    supporter: Math.max(0, JOURNEY_PLAY_SET.supporter - counts.supporter),
    stadium: Math.max(0, JOURNEY_PLAY_SET.stadium - counts.stadium),
    tool: Math.max(0, JOURNEY_PLAY_SET.tool - counts.tool),
    rareItem: Math.max(0, JOURNEY_PLAY_SET.rareItem - counts.rareItem),
    climate: Math.max(0, JOURNEY_PLAY_SET.climate - counts.climate),
    champion: Math.max(0, JOURNEY_PLAY_SET.champion - counts.champion),
  };
  return { counts, lines, officialMissing };
}

function addCopies(instances: CardInstance[], cardId: string, count: number, origin: string) {
  for (let index = 1; index <= count; index += 1) {
    instances.push(makeInstance(cardId, index, origin));
  }
}

function createPlayers(names: string[]): PlayerState[] {
  return PLAYER_IDS.map((id, index) => ({
    id,
    name: names[index]?.trim() || `Jogador ${index + 1}`,
    active: true,
    championId: 'test-champion',
    championName: 'Campeão de Teste',
    points: 0,
    victoryPieces: 0,
    defeatPieces: 0,
    hand: [],
    bench: [],
    wildcards: { attack: true, draw: true, switch: true },
    programmed: { locked: false },
    roundFlags: { supporterUsed: false, firstAttackUsed: false, drawBlocked: false, recoveryActionOnly: false, beforeActingDone: false },
  }));
}

export function officialTimerSeconds(round: number) {
  if (round === 1) return 30;
  if (round <= 3) return 40;
  if (round <= 5) return 50;
  return 60;
}

export function createJourneyGame(
  collection: CardCollection,
  options: { playerNames: string[]; mode: FormationMode; timerMode: TimerMode; seed?: string | number; selectedLineIds?: string[] },
) {
  const lookup = createLookup(collection);
  const diagnostics = validateFormation(lookup.collection);
  const selectedLines = diagnostics.lines
    .filter((line) => !options.selectedLineIds?.length || options.selectedLineIds.includes(line.id))
    .slice(0, JOURNEY_PLAY_SET.pokemonBasics);

  const formation: JourneyFormation = {
    mode: options.mode,
    collectionId: collection.id,
    collectionName: collection.name,
    selectedLineIds: selectedLines.map((line) => line.id),
    officialMissing: diagnostics.officialMissing,
    diagnostics: [
      options.mode === 'test'
        ? 'Formação de Teste — esta coleção ainda não possui os componentes necessários para uma Jornada oficial.'
        : 'Formação Oficial selecionada. Confira os componentes faltantes antes de validar torneios.',
      ...selectedLines.flatMap((line) => line.branches.length ? [`${line.name}: ramificações resolvidas automaticamente de forma determinística.`] : []),
    ],
  };

  const seed = createSeed(options.seed);
  const now = nowIso();
  const state: GameState = {
    schemaVersion: 1,
    id: `journey-${now.replace(/[^0-9]/g, '')}-${seed}`,
    status: 'setup',
    collectionId: collection.id,
    collectionName: collection.name,
    round: 1,
    phase: 'initialPokemon',
    priorityPlayerId: 'player-1',
    players: createPlayers(options.playerNames),
    board: {
      piles: { pokemonA: [], pokemonB: [], trainerA: [], trainerB: [], attackA: [], attackB: [] },
      pokemonZone: [],
      discard: [],
      stadiums: { AB: null, BC: null, CD: null, DA: null },
      climate: null,
    },
    instances: {},
    pokemon: {},
    formation,
    evolutionLines: selectedLines,
    rng: { seed, state: seed },
    timerMode: options.timerMode,
    initialChoice: { playerIndex: 0, visible: false, options: [], mulligans: 0 },
    ranking: [],
    log: [],
    createdAt: now,
    updatedAt: now,
    dev: {
      snapshots: [],
      revealPiles: false,
      interpretations: [
        'Matriz de fraqueza/resistência vazia até a tabela oficial existir.',
        'Ralts/Kirlia sobreviveriam com 10 HP quando a proteção automática for implementada por escolha.',
        'Substituição por KO é registrada separadamente de troca voluntária para efeitos de Estádio.',
      ],
    },
  };

  const pokemonInstances: CardInstance[] = [];
  const attackInstances: CardInstance[] = [];
  const trainerInstances: CardInstance[] = [];

  for (const line of selectedLines) {
    for (const cardId of line.cards) {
      const card = lookup.cards[cardId];
      if (card?.data.cardType !== 'pokemon') continue;
      addCopies(pokemonInstances, cardId, cardCopiesForPokemon(card as StoredCard & { data: PokemonCardData }, line.rarity), `linha ${line.name}`);
    }
  }
  for (const attack of lookup.collection.cards.filter((card) => card.data.cardType === 'attack')) addCopies(attackInstances, attack.id, 2, 'ataque de teste');
  for (const trainer of lookup.collection.cards.filter((card) => ['item', 'supporter', 'tool', 'rareItem'].includes(card.data.cardType))) {
    addCopies(trainerInstances, trainer.id, trainer.data.cardType === 'item' ? 4 : 3, `${trainer.data.cardType} de teste`);
  }
  for (const stadium of lookup.collection.cards.filter((card) => card.data.cardType === 'stadium')) addCopies(trainerInstances, stadium.id, 2, 'estádio de teste');
  for (const climate of lookup.collection.cards.filter((card) => card.data.cardType === 'climate')) addCopies(trainerInstances, climate.id, 2, 'clima de teste');

  for (const instance of [...pokemonInstances, ...attackInstances, ...trainerInstances]) state.instances[instance.instanceId] = instance;

  shuffleInPlace(state, pokemonInstances);
  shuffleInPlace(state, attackInstances);
  shuffleInPlace(state, trainerInstances);

  const [pokemonA, pokemonB] = splitAlternating(pokemonInstances.map((item) => item.instanceId));
  const [attackA, attackB] = splitAlternating(attackInstances.map((item) => item.instanceId));
  const [trainerA, trainerB] = splitAlternating(trainerInstances.map((item) => item.instanceId));
  state.board.piles.pokemonA = pokemonA;
  state.board.piles.pokemonB = pokemonB;
  state.board.piles.attackA = attackA;
  state.board.piles.attackB = attackB;
  state.board.piles.trainerA = trainerA;
  state.board.piles.trainerB = trainerB;

  shuffleInPlace(state, state.players);
  state.priorityPlayerId = state.players[0]!.id;
  addLog(state, `Jornada criada com seed ${seed}. Prioridade inicial: ${state.players[0]!.name}.`);
  addLog(state, formation.diagnostics[0]!);
  prepareInitialOptions(state, lookup.cards);
  return state;
}

export function drawFromPhysicalPile(state: GameState, pileId: PhysicalPileId) {
  return state.board.piles[pileId].shift();
}

export function drawPokemonReserve(state: GameState) {
  return drawFromPhysicalPile(state, state.board.piles.pokemonA.length >= state.board.piles.pokemonB.length ? 'pokemonA' : 'pokemonB');
}

export function returnToPokemonReserve(state: GameState, instanceIds: string[]) {
  for (const instanceId of instanceIds) {
    if (state.instances[instanceId]) state.board.piles.pokemonA.push(instanceId);
  }
  shuffleInPlace(state, state.board.piles.pokemonA);
}

export function prepareInitialOptions(state: GameState, cards: Record<string, StoredCard>) {
  const choice = state.initialChoice;
  if (!choice) return;
  const options: string[] = [];
  const skipped: string[] = [];
  while (options.length < 6 && (state.board.piles.pokemonA.length || state.board.piles.pokemonB.length)) {
    const instanceId = drawPokemonReserve(state);
    if (!instanceId) break;
    options.push(instanceId);
  }
  const hasValid = options.some((instanceId) => {
    const card = cards[state.instances[instanceId]?.cardId ?? ''];
    return card?.data.cardType === 'pokemon' && card.data.stage === 'BÁSICO' && ['common', 'uncommon'].includes(card.data.rarity);
  });
  if (!hasValid && options.length) {
    skipped.push(...options);
    returnToPokemonReserve(state, skipped);
    choice.mulligans += 1;
    return prepareInitialOptions(state, cards);
  }
  choice.options = options;
  choice.visible = false;
}
