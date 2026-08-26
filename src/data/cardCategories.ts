import type { CardType, UtilityCardType } from '../types/card';

export const CARD_CATEGORY_META: Record<Exclude<CardType, 'pokemon'>, { label: string; symbol: string; accent: string; deep: string; surface: string }> = {
  attack: { label: 'ATAQUE', symbol: '✦', accent: '#3468a8', deep: '#16395f', surface: '#d8e3ef' },
  stadium: { label: 'ESTÁDIO', symbol: '⌂', accent: '#4b7765', deep: '#27493d', surface: '#d9e4dc' },
  supporter: { label: 'APOIADOR', symbol: '✧', accent: '#865d88', deep: '#533655', surface: '#e6dce6' },
  item: { label: 'ITEM', symbol: '◆', accent: '#9a6938', deep: '#60401f', surface: '#e9dfcf' },
  tool: { label: 'FERRAMENTA', symbol: '⬡', accent: '#657480', deep: '#3e4a53', surface: '#dde2e5' },
};

export const UTILITY_META: Record<UtilityCardType, (typeof CARD_CATEGORY_META)[UtilityCardType]> = {
  stadium: CARD_CATEGORY_META.stadium,
  supporter: CARD_CATEGORY_META.supporter,
  item: CARD_CATEGORY_META.item,
  tool: CARD_CATEGORY_META.tool,
};
