import { CARD_TYPE_LABELS } from '../types/card';
import type { CardData, CardType } from '../types/card';
import type { CardCollection, CollectionSize, ContentState, StoredCard } from '../types/collection';
import { COLLECTION_CATEGORY_ORDER, COLLECTION_TOTALS, getCategoryLimit, getCategoryStart } from '../data/gameConfig';

export const CONTENT_SCHEMA_VERSION = 1 as const;

export function createEmptyContentState(): ContentState {
  return { schemaVersion: CONTENT_SCHEMA_VERSION, generatedAt: new Date(0).toISOString(), collections: [] };
}

export function stableId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeForCode(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z ]+/g, ' ').trim().toUpperCase();
}

export function generateCollectionCode(name: string, existingCodes: string[]): string {
  const normalized = normalizeForCode(name);
  const words = normalized.split(/\s+/).filter(Boolean);
  const candidates: string[] = [];

  if (words.length >= 3) candidates.push((words[0][0] + words[1][0] + words[2][0]).slice(0, 3));
  if (words.length >= 2) {
    candidates.push((words[0].slice(0, 2) + words[1][0]).slice(0, 3));
    candidates.push((words[0][0] + words[1].slice(0, 2)).slice(0, 3));
  }
  if (words[0]) candidates.push(words[0].slice(0, 3));
  candidates.push(normalized.replace(/\s+/g, '').slice(0, 3));

  const used = new Set(existingCodes.map((code) => code.toUpperCase()));
  for (const candidate of candidates) {
    const code = candidate.replace(/[^A-Z]/g, '').padEnd(3, 'X').slice(0, 3);
    if (!used.has(code)) return code;
  }

  const base = (candidates.find(Boolean) || 'SET').replace(/[^A-Z]/g, '').padEnd(3, 'X').slice(0, 3);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < alphabet.length; i += 1) {
    for (let j = 0; j < alphabet.length; j += 1) {
      const code = `${base[0]}${alphabet[i]}${alphabet[j]}`;
      if (!used.has(code)) return code;
    }
  }
  throw new Error('Não foi possível gerar uma sigla única para a coleção.');
}

export function createCollection(name: string, size: CollectionSize, existing: CardCollection[]): CardCollection {
  const now = new Date().toISOString();
  return {
    id: stableId('collection'),
    name: name.trim(),
    code: generateCollectionCode(name, existing.map((collection) => collection.code)),
    size,
    createdAt: now,
    updatedAt: now,
    cards: [],
  };
}

export function countCardsByType(collection: CardCollection, type: CardType) {
  return collection.cards.filter((card) => card.data.cardType === type).length;
}

export function isCategoryFull(collection: CardCollection, type: CardType) {
  return countCardsByType(collection, type) >= getCategoryLimit(collection.size, type);
}

export function getNextCardNumber(collection: CardCollection, type: CardType) {
  const count = countCardsByType(collection, type);
  const limit = getCategoryLimit(collection.size, type);
  if (count >= limit) throw new Error(`${CARD_TYPE_LABELS[type]} está completo nesta coleção.`);
  return getCategoryStart(collection.size, type) + count;
}

export function applyCollectionMetadata<T extends CardData>(collection: CardCollection, data: T, number: number): T {
  return {
    ...data,
    cardNumber: number,
    setTotal: COLLECTION_TOTALS[collection.size],
    setCode: collection.code,
  } as T;
}

export function renumberCollection(collection: CardCollection): CardCollection {
  const cloned: CardCollection = structuredClone(collection);
  for (const type of COLLECTION_CATEGORY_ORDER) {
    const items = cloned.cards
      .filter((card) => card.data.cardType === type)
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
    const start = getCategoryStart(cloned.size, type);
    items.forEach((item, index) => {
      item.order = index;
      item.data = applyCollectionMetadata(cloned, item.data, start + index);
    });
  }
  cloned.cards.sort((a, b) => a.data.cardNumber - b.data.cardNumber || a.createdAt.localeCompare(b.createdAt));
  cloned.updatedAt = new Date().toISOString();
  return cloned;
}

export function upsertCard(collection: CardCollection, cardId: string | null, data: CardData): { collection: CardCollection; card: StoredCard } {
  const cloned: CardCollection = structuredClone(collection);
  const now = new Date().toISOString();
  let record = cardId ? cloned.cards.find((item) => item.id === cardId) : undefined;
  const previousType = record?.data.cardType;

  if (!record) {
    if (isCategoryFull(cloned, data.cardType)) throw new Error(`${CARD_TYPE_LABELS[data.cardType]} está completo nesta coleção.`);
    record = {
      id: stableId('card'),
      order: countCardsByType(cloned, data.cardType),
      createdAt: now,
      updatedAt: now,
      data,
    };
    cloned.cards.push(record);
  } else {
    if (previousType !== data.cardType && isCategoryFull(cloned, data.cardType)) {
      throw new Error(`${CARD_TYPE_LABELS[data.cardType]} está completo nesta coleção.`);
    }
    record.data = data;
    record.updatedAt = now;
    if (previousType !== data.cardType) record.order = countCardsByType(cloned, data.cardType) - (previousType === data.cardType ? 1 : 0);
  }

  const renumbered = renumberCollection(cloned);
  const saved = renumbered.cards.find((item) => item.id === record!.id)!;
  return { collection: renumbered, card: saved };
}

export function deleteCard(collection: CardCollection, cardId: string): CardCollection {
  const cloned: CardCollection = structuredClone(collection);
  cloned.cards = cloned.cards.filter((card) => card.id !== cardId);
  return renumberCollection(cloned);
}

export function validateCollection(collection: CardCollection): string[] {
  const errors: string[] = [];
  for (const type of COLLECTION_CATEGORY_ORDER) {
    const count = countCardsByType(collection, type);
    const limit = getCategoryLimit(collection.size, type);
    if (count > limit) errors.push(`${CARD_TYPE_LABELS[type]}: ${count}/${limit}`);
  }
  return errors;
}

export function cardDisplayName(data: CardData) {
  if (data.cardType === 'pokemon') return data.pokemonName;
  if (data.cardType === 'attack') return data.attackName;
  return data.name;
}
