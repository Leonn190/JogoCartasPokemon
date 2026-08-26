import type { GameType } from '../types/card';

export type TypeMeta = { color: string; deep: string; light: string; symbol: string; icon: string };

export const TYPE_META: Record<GameType, TypeMeta> = {
  // Paletas inspiradas na aparência das cartas Pokémon padrão modernas:
  // pigmento forte, highlight claro e sombra da mesma família cromática.
  Fogo: { color: '#F36A42', deep: '#B93628', light: '#FFAA68', symbol: '△', icon: 'Tipos/fogo.png' },
  Água: { color: '#43B7DF', deep: '#187FAF', light: '#A2DFF1', symbol: '≋', icon: 'Tipos/agua.png' },
  Planta: { color: '#95CC3F', deep: '#5A982E', light: '#D0EB70', symbol: '❧', icon: 'Tipos/planta.png' },
  Elétrico: { color: '#FFD52A', deep: '#C99C08', light: '#FFF17B', symbol: 'ϟ', icon: 'Tipos/eletrico.png' },
  Gelo: { color: '#73D3DF', deep: '#2F9BAE', light: '#C0EEF3', symbol: '✣', icon: 'Tipos/gelo.png' },
  Lutador: { color: '#F1A62A', deep: '#C97118', light: '#FFD36C', symbol: '◆', icon: 'Tipos/lutador.png' },
  Terra: { color: '#D49756', deep: '#945A2F', light: '#EBC18A', symbol: '⬟', icon: 'Tipos/terrestre.png' },
  Voador: { color: '#79BDE2', deep: '#477FA8', light: '#C2E2F4', symbol: '⌁', icon: 'Tipos/voador.png' },
  Psíquico: { color: '#C37ABF', deep: '#884A8D', light: '#E5B2DE', symbol: '◉', icon: 'Tipos/psiquico.png' },
  Sombrio: { color: '#3C3E45', deep: '#14161A', light: '#787B83', symbol: '☾', icon: 'Tipos/sombrio.png' },
  Metal: { color: '#A8B6BA', deep: '#687B82', light: '#E0E7E9', symbol: '⬢', icon: 'Tipos/metal.png' },
  Místico: { color: '#D987C8', deep: '#9A4E91', light: '#F0B9E3', symbol: '✦', icon: 'Tipos/mistico.png' },
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
