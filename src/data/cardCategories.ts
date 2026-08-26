import type { AttackKind, CardType, UtilityCardType } from '../types/card';

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
    label: 'ATAQUE', symbol: '✦', accent: '#c84a4a', deep: '#742526', surface: '#ddd9d9',
    ribbonStart: '#e56562', ribbonEnd: '#a93438',
  },
  stadium: {
    label: 'Estádio', symbol: '⌂', accent: '#55a765', deep: '#275d35', surface: '#d7ded8',
    ribbonStart: '#72c57d', ribbonEnd: '#3f8650',
  },
  supporter: {
    label: 'Apoiador', symbol: '✧', accent: '#eb7a3f', deep: '#8f3f18', surface: '#e0dbd8',
    ribbonStart: '#ff9d62', ribbonEnd: '#cf592d',
  },
  item: {
    label: 'Item', symbol: '◆', accent: '#438fc3', deep: '#245578', surface: '#d8dde1',
    ribbonStart: '#68add7', ribbonEnd: '#327aa8',
  },
  rareItem: {
    label: 'Item Raro', symbol: '✦', accent: '#df6fa8', deep: '#873557', surface: '#e3d9df',
    ribbonStart: '#f39ac6', ribbonEnd: '#c9538d',
  },
  tool: {
    label: 'Ferramenta', symbol: '⬡', accent: '#8a61b6', deep: '#51356f', surface: '#ddd9e1',
    ribbonStart: '#a985d0', ribbonEnd: '#70489b',
  },
  champion: {
    label: 'Campeão', symbol: '♛', accent: '#d6ac2e', deep: '#73590c', surface: '#e2dfd2',
    ribbonStart: '#f0ca4c', ribbonEnd: '#b88a16',
  },
};

export const ATTACK_KIND_META: Record<AttackKind, CategoryMeta> = {
  normal: {
    label: 'Ataque Normal', symbol: '✦', accent: '#cc484b', deep: '#752429', surface: '#dfd9d9',
    ribbonStart: '#e86364', ribbonEnd: '#a93239',
  },
  special: {
    label: 'Ataque Especial', symbol: '✦', accent: '#8658b3', deep: '#4c306d', surface: '#ddd9e2',
    ribbonStart: '#a87ad0', ribbonEnd: '#6b4397',
  },
};

export const UTILITY_META: Record<UtilityCardType, (typeof CARD_CATEGORY_META)[UtilityCardType]> = {
  stadium: CARD_CATEGORY_META.stadium,
  supporter: CARD_CATEGORY_META.supporter,
  item: CARD_CATEGORY_META.item,
  rareItem: CARD_CATEGORY_META.rareItem,
  tool: CARD_CATEGORY_META.tool,
};
