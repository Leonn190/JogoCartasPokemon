import type { CardType, UtilityCardType } from '../types/card';

type CategoryMeta = {
  label: string;
  symbol: string;
  accent: string;
  deep: string;
  surface: string;
  ribbonStart: string;
  ribbonEnd: string;
};

export const CARD_CATEGORY_META: Record<Exclude<CardType, 'pokemon'>, CategoryMeta> = {
  attack: {
    label: 'ATAQUE', symbol: '✦', accent: '#4f86b9', deep: '#203d5b', surface: '#d6dde3',
    ribbonStart: '#5d93c1', ribbonEnd: '#2c5f8e',
  },
  stadium: {
    label: 'Estádio', symbol: '⌂', accent: '#5d8c72', deep: '#28483a', surface: '#d7ddd9',
    ribbonStart: '#75a68a', ribbonEnd: '#3d6d55',
  },
  supporter: {
    label: 'Apoiador', symbol: '✧', accent: '#ef7845', deep: '#8e351c', surface: '#dedddd',
    ribbonStart: '#ff9b69', ribbonEnd: '#db542c',
  },
  item: {
    label: 'Item', symbol: '◆', accent: '#4d89ad', deep: '#244f6a', surface: '#d8dee2',
    ribbonStart: '#6fa8c8', ribbonEnd: '#397494',
  },
  tool: {
    label: 'Ferramenta', symbol: '⬡', accent: '#7c7f8c', deep: '#42454e', surface: '#dcdddf',
    ribbonStart: '#9c9faa', ribbonEnd: '#646874',
  },
  champion: {
    label: 'Campeão', symbol: '♛', accent: '#cf9f36', deep: '#715011', surface: '#e1ded5',
    ribbonStart: '#e4bc58', ribbonEnd: '#b87a18',
  },
};

export const UTILITY_META: Record<UtilityCardType, (typeof CARD_CATEGORY_META)[UtilityCardType]> = {
  stadium: CARD_CATEGORY_META.stadium,
  supporter: CARD_CATEGORY_META.supporter,
  item: CARD_CATEGORY_META.item,
  tool: CARD_CATEGORY_META.tool,
  champion: CARD_CATEGORY_META.champion,
};
