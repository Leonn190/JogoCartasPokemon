import type { GameType } from '../types/card';

export type TypeMeta = { color: string; deep: string; light: string; symbol: string; icon: string };

export const TYPE_META: Record<GameType, TypeMeta> = {
  Fogo: { color: '#E6533B', deep: '#7D211C', light: '#FF9D72', symbol: '△', icon: 'Tipos/fogo.png' },
  Água: { color: '#4389DA', deep: '#1E4F8C', light: '#92C3F5', symbol: '≋', icon: 'Tipos/agua.png' },
  Planta: { color: '#5EAD55', deep: '#285F31', light: '#9AD68F', symbol: '❧', icon: 'Tipos/planta.png' },
  Elétrico: { color: '#EFC72D', deep: '#80620B', light: '#FFE77A', symbol: 'ϟ', icon: 'Tipos/eletrico.png' },
  Gelo: { color: '#6CCDD5', deep: '#2C737B', light: '#B8F0F0', symbol: '✣', icon: 'Tipos/gelo.png' },
  Lutador: { color: '#B95343', deep: '#61251E', light: '#E18A79', symbol: '◆', icon: 'Tipos/lutador.png' },
  Terra: { color: '#B9824C', deep: '#63401E', light: '#DDB37A', symbol: '⬟', icon: 'Tipos/terrestre.png' },
  Voador: { color: '#83AEE0', deep: '#42668D', light: '#C1DCF7', symbol: '⌁', icon: 'Tipos/voador.png' },
  Psíquico: { color: '#B45BA8', deep: '#622B65', light: '#DFA1D7', symbol: '◉', icon: 'Tipos/psiquico.png' },
  Sombrio: { color: '#202126', deep: '#090A0D', light: '#666872', symbol: '☾', icon: 'Tipos/sombrio.png' },
  Metal: { color: '#8799A1', deep: '#3E4D55', light: '#C4CFD3', symbol: '⬢', icon: 'Tipos/metal.png' },
  Místico: { color: '#D66FB9', deep: '#77325F', light: '#F0AAD8', symbol: '✦', icon: 'Tipos/mistico.png' },
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
