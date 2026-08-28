import type { GameType } from '../types/card';

export type TypeMeta = { color: string; deep: string; light: string; symbol: string; icon: string };

export const TYPE_META: Record<GameType, TypeMeta> = {
  // Paletas deliberadamente mais intensas para que o corpo da carta preserve
  // a leitura cromática mesmo depois dos overlays metálicos/texturizados.
  Fogo: { color: '#F04A24', deep: '#8F1C13', light: '#FF8050', symbol: '△', icon: 'Tipos/fogo.png' },
  Água: { color: '#159FDB', deep: '#075B91', light: '#67CCEE', symbol: '≋', icon: 'Tipos/agua.png' },
  Planta: { color: '#64B72E', deep: '#34791C', light: '#A1DD55', symbol: '❧', icon: 'Tipos/planta.png' },
  Elétrico: { color: '#F4C900', deep: '#A67600', light: '#FFE25A', symbol: 'ϟ', icon: 'Tipos/eletrico.png' },
  // Gelo: ciano bem evidente, sem cair para o azul acinzentado.
  Gelo: { color: '#17D4E6', deep: '#08798E', light: '#8AF4FF', symbol: '✣', icon: 'Tipos/gelo.png' },
  Lutador: { color: '#E98A18', deep: '#963F0D', light: '#FFB647', symbol: '◆', icon: 'Tipos/lutador.png' },
  Terra: { color: '#C36A31', deep: '#713817', light: '#E39A5A', symbol: '⬟', icon: 'Tipos/terrestre.png' },
  // Voador: quase branco, com somente o azul-gelo necessário para contraste.
  Voador: { color: '#E7F1F6', deep: '#7996A7', light: '#FFFFFF', symbol: '⌁', icon: 'Tipos/voador.png' },
  // Psíquico: roxo mais fechado e profundo.
  Psíquico: { color: '#79358F', deep: '#3C1553', light: '#B76CCB', symbol: '◉', icon: 'Tipos/psiquico.png' },
  // Sombrio: azul-marinho muito escuro, como nas cartas escuras modernas.
  Sombrio: { color: '#162E4B', deep: '#071521', light: '#315578', symbol: '☾', icon: 'Tipos/sombrio.png' },
  Metal: { color: '#869AA0', deep: '#4B626A', light: '#C1D0D3', symbol: '⬢', icon: 'Tipos/metal.png' },
  // Místico cobre a família fada/dragão do jogo; o fundo fica rosa vivo para
  // que a leitura de Fada seja inequívoca na carta.
  Místico: { color: '#EA4FB0', deep: '#962766', light: '#FF8ED6', symbol: '✦', icon: 'Tipos/mistico.png' },
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
