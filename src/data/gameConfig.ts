import type { CardCollection, CardType, CollectionSize } from '../types/card';

export const COLLECTION_CATEGORY_ORDER: CardType[] = [
  'pokemon',
  'attack',
  'item',
  'supporter',
  'stadium',
  'tool',
  'rareItem',
  'climate',
  'champion',
];

type CollectionPreset = {
  total: number;
  limits: Record<CardType, number>;
};

export const COLLECTION_PRESETS: Record<CollectionSize, CollectionPreset> = {
  large: {
    total: 160,
    limits: {
      pokemon: 68,
      attack: 48,
      item: 8,
      supporter: 8,
      stadium: 6,
      tool: 6,
      rareItem: 6,
      climate: 5,
      champion: 5,
    },
  },
  normal: {
    total: 130,
    limits: {
      pokemon: 64,
      attack: 36,
      item: 6,
      supporter: 6,
      stadium: 4,
      tool: 4,
      rareItem: 3,
      climate: 3,
      champion: 4,
    },
  },
};

export function collectionTotal(size: CollectionSize) {
  return COLLECTION_PRESETS[size].total;
}

export function categoryLimit(size: CollectionSize, cardType: CardType) {
  return COLLECTION_PRESETS[size].limits[cardType];
}

export function categoryStart(size: CollectionSize, cardType: CardType) {
  let start = 1;
  for (const type of COLLECTION_CATEGORY_ORDER) {
    if (type === cardType) return start;
    start += categoryLimit(size, type);
  }
  return start;
}

export function categoryEnd(size: CollectionSize, cardType: CardType) {
  return categoryStart(size, cardType) + categoryLimit(size, cardType) - 1;
}

export function categoryCount(collection: CardCollection, cardType: CardType) {
  return collection.cards.filter((entry) => entry.data.cardType === cardType).length;
}

export function categoryFull(collection: CardCollection, cardType: CardType) {
  return categoryCount(collection, cardType) >= categoryLimit(collection.size, cardType);
}

/**
 * Referência histórica do Modo Jornada preservada para consumidores antigos.
 * Os presets de edição/publicação acima são independentes desta composição de mesa.
 */
export const GAME_COLLECTION_REFERENCE = {
  pokemon: {
    basics: {
      common: { unique: 8, copiesEach: 3, totalCopies: 24 },
      uncommon: { unique: 7, copiesEach: 2, totalCopies: 14 },
      rare: { unique: 5, copiesEach: 1, totalCopies: 5 },
      uniqueTotal: 20,
      basicCopiesTotal: 43,
    },
    specialFinalForms: { copiesEach: 1 },
    totalCopies: 'variable',
  },
  attacks: { unique: 48, copiesEach: 2, totalCopies: 96 },
  trainers: {
    item: { unique: 8, copiesEach: 4, totalCopies: 32 },
    supporter: { unique: 8, copiesEach: 3, totalCopies: 24 },
    stadium: { unique: 6, copiesEach: 2, totalCopies: 12 },
    tool: { unique: 6, copiesEach: 3, totalCopies: 18 },
    rareItem: { unique: 6, copiesEach: 2, totalCopies: 12 },
    uniqueTotal: 34,
    pileCopiesTotal: 98,
  },
  champions: { unique: 5, copiesEach: 1, inTrainerPile: false },
} as const;
