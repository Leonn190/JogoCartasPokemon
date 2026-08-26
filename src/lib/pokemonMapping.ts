import type { GameType } from '../types/card';

export const TYPE_META: Record<GameType, { color: string; deep: string; light: string; symbol: string }> = {
  Fogo: { color: '#E84A32', deep: '#7E1F1A', light: '#FF9A74', symbol: '△' },
  Água: { color: '#3284E6', deep: '#174A8D', light: '#80B9FF', symbol: '≋' },
  Planta: { color: '#55A84F', deep: '#285F2E', light: '#95D58C', symbol: '❧' },
  Elétrico: { color: '#F2C94C', deep: '#8B650E', light: '#FFE886', symbol: 'ϟ' },
  Gelo: { color: '#77D5E8', deep: '#2D7081', light: '#C0F2FA', symbol: '✣' },
  Lutador: { color: '#A94A3F', deep: '#5C231F', light: '#DD8579', symbol: '◆' },
  Terra: { color: '#A87946', deep: '#5B3B20', light: '#D9B07B', symbol: '⬟' },
  Voador: { color: '#91BCE8', deep: '#486B91', light: '#C9E2FA', symbol: '⌁' },
  Psíquico: { color: '#9B59C6', deep: '#4F246C', light: '#C999E7', symbol: '◉' },
  Sombrio: { color: '#353342', deep: '#15141C', light: '#777286', symbol: '☾' },
  Metal: { color: '#899AA5', deep: '#42505A', light: '#C2CCD2', symbol: '⬢' },
  Místico: { color: '#D56AA0', deep: '#7B2D57', light: '#F0A7CC', symbol: '✦' },
};

const POKE_TYPE_TO_GAME: Record<string, GameType | null> = {
  fire: 'Fogo', water: 'Água', grass: 'Planta', electric: 'Elétrico', ice: 'Gelo',
  fighting: 'Lutador', ground: 'Terra', rock: 'Terra', flying: 'Voador', psychic: 'Psíquico',
  dark: 'Sombrio', ghost: 'Sombrio', steel: 'Metal', dragon: 'Místico', fairy: 'Místico',
  bug: null, poison: null, normal: null,
};

export function suggestGameType(pokeTypes: string[]): GameType | null {
  for (const type of pokeTypes) {
    const mapped = POKE_TYPE_TO_GAME[type];
    if (mapped) return mapped;
  }
  return null;
}

export const REGION_BY_GENERATION: Record<string, string> = {
  'generation-i': 'Kanto',
  'generation-ii': 'Johto',
  'generation-iii': 'Hoenn',
  'generation-iv': 'Sinnoh',
  'generation-v': 'Unova',
  'generation-vi': 'Kalos',
  'generation-vii': 'Alola',
  'generation-viii': 'Galar',
  'generation-ix': 'Paldea',
};

export function titleCasePokemon(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function sanitizeFlavorText(value: string): string {
  return value.replace(/[\n\f\r\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}
