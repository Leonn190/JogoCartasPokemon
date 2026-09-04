import type { CardData, StoredCard } from '../types/card';
import type { CardInstance, GameLogEntry, GameState, PlayerId } from './types';

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createSeed(seed?: number | string) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.abs(Math.floor(seed)) || 1;
  if (typeof seed === 'string' && seed.trim() && seed.trim().toUpperCase() !== 'AUTO') {
    let hash = 2166136261;
    for (const char of seed.trim()) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0 || 1;
  }
  const random = globalThis.crypto?.getRandomValues?.(new Uint32Array(1))[0];
  return random || Math.floor(Date.now() % 2147483647) || 1;
}

export function nextRandom(state: GameState) {
  let value = state.rng.state >>> 0;
  value = Math.imul(1664525, value) + 1013904223;
  state.rng.state = value >>> 0;
  return state.rng.state / 0x100000000;
}

export function rollD6(state: GameState) {
  return Math.floor(nextRandom(state) * 6) + 1;
}

export function shuffleInPlace<T>(state: GameState, items: T[]) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export function cardName(data: CardData) {
  if (data.cardType === 'pokemon') return data.pokemonName || 'Pokémon';
  if (data.cardType === 'attack') return data.attackName || 'Ataque';
  return data.name || data.cardType;
}

export function instanceName(state: GameState, cards: Record<string, StoredCard>, instanceId?: string) {
  if (!instanceId) return 'Carta';
  const instance = state.instances[instanceId];
  const card = instance ? cards[instance.cardId] : undefined;
  return card ? cardName(card.data) : 'Carta';
}

export function activePlayerIds(state: GameState): PlayerId[] {
  return state.players.filter((player) => player.active).map((player) => player.id);
}

export function nextActivePlayerId(state: GameState, fromId: PlayerId) {
  const active = activePlayerIds(state);
  if (!active.length) return fromId;
  const index = state.players.findIndex((player) => player.id === fromId);
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const player = state.players[(index + offset + state.players.length) % state.players.length];
    if (player?.active) return player.id;
  }
  return active[0]!;
}

export function addLog(state: GameState, message: string, privateFor?: PlayerId) {
  const entry: GameLogEntry = {
    id: `log-${state.log.length + 1}-${Date.now().toString(36)}`,
    round: state.round,
    phase: state.phase,
    message,
    privateFor,
    createdAt: nowIso(),
  };
  state.log.push(entry);
  if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
  state.updatedAt = nowIso();
  return entry;
}

export function makeInstance(cardId: string, index: number, origin: string, ownerId: CardInstance['ownerId'] = 'central'): CardInstance {
  return {
    instanceId: `instance-${cardId}-${String(index).padStart(3, '0')}`,
    cardId,
    originalCardId: cardId,
    ownerId,
    origin,
  };
}

export function splitAlternating<T>(items: T[]) {
  const a: T[] = [];
  const b: T[] = [];
  items.forEach((item, index) => (index % 2 === 0 ? a : b).push(item));
  return [a, b] as const;
}

export function assertNever(value: never): never {
  throw new Error(`Caso não tratado: ${JSON.stringify(value)}`);
}
