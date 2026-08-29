import type { CardData, CardType } from './card';

export const COLLECTION_SIZES = ['normal', 'large'] as const;
export type CollectionSize = (typeof COLLECTION_SIZES)[number];
export const COLLECTION_SIZE_LABELS: Record<CollectionSize, string> = { normal: 'Normal', large: 'Grande' };

export interface StoredCard {
  id: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  data: CardData;
}

export interface CardCollection {
  id: string;
  name: string;
  code: string;
  size: CollectionSize;
  createdAt: string;
  updatedAt: string;
  cards: StoredCard[];
}

export interface ContentState {
  schemaVersion: 1;
  generatedAt: string;
  collections: CardCollection[];
}

export interface CollectionCategoryConfig {
  type: CardType;
  label: string;
  limit: number;
  start: number;
  end: number;
}
