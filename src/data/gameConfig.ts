import type { CardCollection, CardType } from '../types/card';

export const COLLECTION_CATEGORY_ORDER: CardType[] = [
  'pokemon', 'attack', 'item', 'supporter', 'stadium', 'tool', 'rareItem', 'climate', 'champion',
];

/** Estes números montam uma Jornada; não limitam o catálogo da coleção. */
export const JOURNEY_PLAY_SET = {
  pokemonBasics: 24,
  attacks: 50,
  item: 8,
  supporter: 8,
  stadium: 6,
  tool: 6,
  rareItem: 6,
  climate: 5,
  champion: 5,
} as const;

export function categoryCount(collection: CardCollection, cardType: CardType) {
  return collection.cards.filter((entry) => entry.data.cardType === cardType && !entry.data.expandedArtwork).length;
}

export function collectionBaseTotal(collection: CardCollection) {
  return collection.cards.filter((entry) => !entry.data.expandedArtwork).length;
}
