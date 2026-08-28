import type { GameType } from '../types/card';

export type TypeMeta = { color: string; deep: string; light: string; symbol: string; icon: string };

export const TYPE_META: Record<GameType, TypeMeta> = {
  // Paletas mais intensas e mais próximas das cartas TCG clássicas.
  Fogo: { color: '#D95B2A', deep: '#842414', light: '#F48E4B', symbol: '△', icon: 'Tipos/fogo.png' },
  Água: { color: '#1490C8', deep: '#0B4E84', light: '#54BBE3', symbol: '≋', icon: 'Tipos/agua.png' },
  Planta: { color: '#5FAA2F', deep: '#2F6C1C', light: '#96D051', symbol: '❧', icon: 'Tipos/planta.png' },
  Elétrico: { color: '#E4BE15', deep: '#987100', light: '#F6DE58', symbol: 'ϟ', icon: 'Tipos/eletrico.png' },
  Gelo: { color: '#2CC9D8', deep: '#167A90', light: '#8BE8EF', symbol: '✣', icon: 'Tipos/gelo.png' },
  Lutador: { color: '#C47A1C', deep: '#873E14', light: '#E2A84D', symbol: '◆', icon: 'Tipos/lutador.png' },
  Terra: { color: '#BE733B', deep: '#6C3A1E', light: '#DEA168', symbol: '⬟', icon: 'Tipos/terrestre.png' },
  Voador: { color: '#F0F5F8', deep: '#8BA4B3', light: '#FFFFFF', symbol: '⌁', icon: 'Tipos/voador.png' },
  Psíquico: { color: '#7E3D93', deep: '#442055', light: '#B46BC8', symbol: '◉', icon: 'Tipos/psiquico.png' },
  Sombrio: { color: '#1A233B', deep: '#080D18', light: '#33486D', symbol: '☾', icon: 'Tipos/sombrio.png' },
  Metal: { color: '#7C9197', deep: '#4A5C63', light: '#B7C7CB', symbol: '⬢', icon: 'Tipos/metal.png' },
  Místico: { color: '#D85AA5', deep: '#892D69', light: '#F39ACC', symbol: '✦', icon: 'Tipos/mistico.png' },
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
