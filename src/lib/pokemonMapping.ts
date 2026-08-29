import type { GameType } from '../types/card';

export type TypeMeta = { color: string; deep: string; light: string; symbol: string; icon: string };

export const TYPE_META: Record<GameType, TypeMeta> = {
  // Paletas inspiradas na aparência das cartas Pokémon padrão modernas:
  // pigmento forte, highlight claro e sombra da mesma família cromática.
  Fogo: { color: '#EA4F2A', deep: '#8F2018', light: '#FF8246', symbol: '△', icon: 'Tipos/fogo.png' },
  Água: { color: '#187FB8', deep: '#084B7A', light: '#52ACD8', symbol: '≋', icon: 'Tipos/agua.png' },
  Planta: { color: '#72B632', deep: '#3F7E22', light: '#A7D85B', symbol: '❧', icon: 'Tipos/planta.png' },
  Elétrico: { color: '#F2C515', deep: '#A67A00', light: '#FBE15A', symbol: 'ϟ', icon: 'Tipos/eletrico.png' },
  Gelo: { color: '#2ED5E8', deep: '#13839B', light: '#9AF2F7', symbol: '✣', icon: 'Tipos/gelo.png' },
  Lutador: { color: '#F06A16', deep: '#A5370B', light: '#FF9B3D', symbol: '◆', icon: 'Tipos/lutador.png' },
  Terra: { color: '#C98957', deep: '#7B4B2A', light: '#E6B88D', symbol: '⬟', icon: 'Tipos/terrestre.png' },
  Voador: { color: '#DDE8EE', deep: '#8CA3B0', light: '#F8FCFD', symbol: '⌁', icon: 'Tipos/voador.png' },
  Psíquico: { color: '#8439B5', deep: '#4D216F', light: '#BD78E1', symbol: '◉', icon: 'Tipos/psiquico.png' },
  Sombrio: { color: '#363941', deep: '#0D0F13', light: '#656A74', symbol: '☾', icon: 'Tipos/sombrio.png' },
  Metal: { color: '#899BA0', deep: '#52666D', light: '#BAC7CA', symbol: '⬢', icon: 'Tipos/metal.png' },
  Místico: { color: '#E75AAE', deep: '#9B2E72', light: '#F6A1D1', symbol: '✦', icon: 'Tipos/mistico.png' },
};

const POKE_TYPE_TO_GAME: Record<string, GameType | null> = {
  fire: 'Fogo', water: 'Água', grass: 'Planta', electric: 'Elétrico', ice: 'Gelo',
  fighting: 'Lutador', ground: 'Terra', rock: 'Terra', flying: 'Voador', psychic: 'Psíquico',
  dark: 'Sombrio', ghost: 'Sombrio', steel: 'Metal', dragon: 'Místico', fairy: 'Místico',
  bug: null, poison: null, normal: null,
};

export function suggestGameTypes(pokeTypes: string[]): GameType[] {
  const candidates: GameType[] = [];
  for (const type of pokeTypes) {
    const mapped = POKE_TYPE_TO_GAME[type];
    if (mapped && !candidates.includes(mapped)) candidates.push(mapped);
  }
  return candidates;
}

export function suggestGameType(pokeTypes: string[]): GameType | null {
  const candidates = suggestGameTypes(pokeTypes);
  return candidates.length === 1 ? candidates[0]! : null;
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
