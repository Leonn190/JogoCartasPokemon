import { CARD_TYPE_LABELS } from '../types/card';
import type { CardCollection, CardData, CardType, CollectionSize, StoredCard, WorkspaceState } from '../types/card';
import { COLLECTION_CATEGORY_ORDER, categoryLimit, categoryStart, collectionTotal } from '../data/gameConfig';

export function stableId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeCodeSource(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function baseCode(name: string) {
  const clean = normalizeCodeSource(name);
  const words = clean.split(' ').filter(Boolean);
  if (!words.length) return 'SET';
  if (words.length >= 3) return `${words[0]![0] ?? ''}${words[1]![0] ?? ''}${words[2]![0] ?? ''}`.padEnd(3, 'X').slice(0, 3);
  if (words.length === 2) {
    const first = words[0]!;
    const second = words[1]!;
    return (first.length > 6 ? `${first[0] ?? ''}${second.slice(0, 2)}` : `${first.slice(0, 2)}${second[0] ?? ''}`).padEnd(3, 'X').slice(0, 3);
  }
  return words[0]!.slice(0, 3).padEnd(3, 'X');
}

export function generateCollectionCode(name: string, existingCodes: string[]) {
  const used = new Set(existingCodes.map((code) => code.toUpperCase()));
  const clean = normalizeCodeSource(name).replace(/ /g, '');
  const primary = baseCode(name);
  if (!used.has(primary)) return primary;

  const candidates = new Set<string>();
  for (let i = 0; i < clean.length; i += 1) {
    for (let j = i + 1; j < clean.length; j += 1) {
      for (let k = j + 1; k < clean.length; k += 1) candidates.add(`${clean[i]}${clean[j]}${clean[k]}`);
    }
  }
  for (const candidate of candidates) if (!used.has(candidate)) return candidate;

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const letter of alphabet) {
    const candidate = `${primary.slice(0, 2)}${letter}`;
    if (!used.has(candidate)) return candidate;
  }
  for (const a of alphabet) for (const b of alphabet) for (const c of alphabet) {
    const candidate = `${a}${b}${c}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Não há mais siglas de três letras disponíveis.');
}

export function createCollection(name: string, size: CollectionSize, existing: CardCollection[]): CardCollection {
  const now = new Date().toISOString();
  return {
    id: stableId('collection'),
    name: name.trim() || 'Nova Coleção',
    code: generateCollectionCode(name, existing.map((item) => item.code)),
    size,
    createdAt: now,
    updatedAt: now,
    cards: [],
  };
}

export function createEmptyWorkspace(): WorkspaceState {
  return { schemaVersion: 1, revision: 0, updatedAt: new Date(0).toISOString(), collections: [] };
}

export function cardDisplayName(card: CardData) {
  if (card.cardType === 'pokemon') return card.pokemonName || 'Novo Pokémon';
  if (card.cardType === 'attack') return card.attackName || 'Novo Ataque';
  return card.name || CARD_TYPE_LABELS[card.cardType];
}

export function isFullArtCard(card: CardData) {
  return Boolean(card.expandedArtwork);
}

export function applyCollectionMetadata(card: CardData, collection: CardCollection, positionInCategory: number) {
  card.setCode = collection.code;
  card.setTotal = collectionTotal(collection.size);
  card.cardNumber = categoryStart(collection.size, card.cardType) + positionInCategory;
  return card;
}

function categoryOrder(type: CardType) {
  const index = COLLECTION_CATEGORY_ORDER.indexOf(type);
  return index >= 0 ? index : COLLECTION_CATEGORY_ORDER.length;
}

function sortCollectionCards(collection: CardCollection) {
  collection.cards.sort((a, b) =>
    a.data.cardNumber - b.data.cardNumber
    || categoryOrder(a.data.cardType) - categoryOrder(b.data.cardType)
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id));
}

export function renumberCategory(collection: CardCollection, type: CardType) {
  const entries = collection.cards
    .filter((entry) => entry.data.cardType === type && !isFullArtCard(entry.data))
    .sort((a, b) => a.data.cardNumber - b.data.cardNumber || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  entries.forEach((entry, index) => applyCollectionMetadata(entry.data, collection, index));
  collection.updatedAt = new Date().toISOString();
  return collection;
}

/**
 * A coleção-base continua terminando em 130/160. Full Arts são cartas extras:
 * 131+, 132+... ou 161+, 162+..., sempre agrupadas pela ordem oficial das
 * categorias (Pokémon → Ataque → Treinadores/Clima/Campeão).
 */
export function renumberCollection(collection: CardCollection) {
  for (const type of COLLECTION_CATEGORY_ORDER) renumberCategory(collection, type);

  const baseTotal = collectionTotal(collection.size);
  const bonusCards = collection.cards
    .filter((entry) => isFullArtCard(entry.data))
    .sort((a, b) =>
      categoryOrder(a.data.cardType) - categoryOrder(b.data.cardType)
      || a.createdAt.localeCompare(b.createdAt)
      || a.id.localeCompare(b.id));

  bonusCards.forEach((entry, index) => {
    entry.data.setCode = collection.code;
    entry.data.setTotal = baseTotal;
    entry.data.cardNumber = baseTotal + index + 1;
  });

  sortCollectionCards(collection);
  collection.updatedAt = new Date().toISOString();
  return collection;
}

export function prepareCardForCollection(card: CardData, collection: CardCollection, currentCardId?: string | null) {
  if (isFullArtCard(card)) {
    const bonusSiblings = collection.cards.filter((entry) => entry.id !== currentCardId && isFullArtCard(entry.data));
    card.setCode = collection.code;
    card.setTotal = collectionTotal(collection.size);
    card.cardNumber = collectionTotal(collection.size) + bonusSiblings.length + 1;
    return card;
  }

  const siblings = collection.cards.filter((entry) =>
    entry.id !== currentCardId
    && entry.data.cardType === card.cardType
    && !isFullArtCard(entry.data));

  if (siblings.length >= categoryLimit(collection.size, card.cardType)) {
    throw new Error(`${CARD_TYPE_LABELS[card.cardType]} está no limite da coleção.`);
  }
  return applyCollectionMetadata(card, collection, siblings.length);
}

export function upsertCard(collection: CardCollection, card: CardData, cardId?: string | null) {
  const now = new Date().toISOString();
  const data = prepareCardForCollection(structuredClone(card), collection, cardId);
  let stored = cardId ? collection.cards.find((entry) => entry.id === cardId) : undefined;
  if (stored) {
    stored.data = data;
    stored.updatedAt = now;
  } else {
    stored = { id: stableId('card'), collectionId: collection.id, createdAt: now, updatedAt: now, data };
    collection.cards.push(stored);
  }
  renumberCollection(collection);
  return stored;
}

export function deleteCard(collection: CardCollection, cardId: string) {
  collection.cards = collection.cards.filter((entry) => entry.id !== cardId);
  return renumberCollection(collection);
}
