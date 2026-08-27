import type { GameType } from '../types/card';

export type TypeMeta = { color: string; deep: string; light: string; symbol: string; icon: string };

export const TYPE_META: Record<GameType, TypeMeta> = {
  // Paletas inspiradas na aparência das cartas Pokémon padrão modernas:
  // pigmento forte, highlight claro e sombra da mesma família cromática.
  Fogo: { color: '#EA4F2A', deep: '#8F2018', light: '#FF8246', symbol: '△', icon: 'Tipos/fogo.png' },
  Água: { color: '#219ED2', deep: '#0B5F91', light: '#62C5E4', symbol: '≋', icon: 'Tipos/agua.png' },
  Planta: { color: '#72B632', deep: '#3F7E22', light: '#A7D85B', symbol: '❧', icon: 'Tipos/planta.png' },
  Elétrico: { color: '#F2C515', deep: '#A67A00', light: '#FBE15A', symbol: 'ϟ', icon: 'Tipos/eletrico.png' },
  Gelo: { color: '#43BED0', deep: '#267D96', light: '#83DCE7', symbol: '✣', icon: 'Tipos/gelo.png' },
  Lutador: { color: '#E48B20', deep: '#9A4C13', light: '#F4B44A', symbol: '◆', icon: 'Tipos/lutador.png' },
  Terra: { color: '#B96C37', deep: '#744020', light: '#D99C64', symbol: '⬟', icon: 'Tipos/terrestre.png' },
  Voador: { color: '#4D9FD0', deep: '#316B99', light: '#82BFE3', symbol: '⌁', icon: 'Tipos/voador.png' },
  Psíquico: { color: '#A856A6', deep: '#713A79', light: '#D086CA', symbol: '◉', icon: 'Tipos/psiquico.png' },
  Sombrio: { color: '#363941', deep: '#0D0F13', light: '#656A74', symbol: '☾', icon: 'Tipos/sombrio.png' },
  Metal: { color: '#899BA0', deep: '#52666D', light: '#BAC7CA', symbol: '⬢', icon: 'Tipos/metal.png' },
  Místico: { color: '#C655B2', deep: '#84347D', light: '#E58AD4', symbol: '✦', icon: 'Tipos/mistico.png' },
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
