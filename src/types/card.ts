export const CARD_FORMS = ['Normal', 'EX', 'Mega', 'Radiante', 'Gigantamax', 'Lendário'] as const;
export type PokemonForm = (typeof CARD_FORMS)[number];

export const CARD_STAGES = ['BÁSICO', 'ESTÁGIO 1', 'ESTÁGIO 2', 'FINAL'] as const;
export type PokemonStage = (typeof CARD_STAGES)[number];

export const GAME_TYPES = [
  'Fogo', 'Água', 'Planta', 'Elétrico', 'Gelo', 'Lutador',
  'Terra', 'Voador', 'Psíquico', 'Sombrio', 'Metal', 'Místico',
] as const;
export type GameType = (typeof GAME_TYPES)[number];

export interface CardStats {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
}

export interface ArtworkTransform {
  scale: number;
  x: number;
  y: number;
}

export interface PokemonCardData extends CardStats {
  pokemonId: number | null;
  pokemonName: string;
  form: PokemonForm;
  type: GameType;
  stage: PokemonStage;
  previousEvolution: string;
  previousEvolutionImage: string;
  artwork: string;
  artworkTransform: ArtworkTransform;
  expandedArtwork: boolean;
  pokedexNumber: number | null;
  genus: string;
  height: string;
  weight: string;
  region: string;
  abilityName: string;
  abilityDescription: string;
  flavorText: string;
  cardNumber: number;
  setTotal: 150;
  setCode: string;
  isLegendary: boolean;
  isMythical: boolean;
}

export interface OfficialStats extends CardStats {}

export interface EditorReferenceData {
  officialStats: OfficialStats | null;
  abilities: Array<{ name: string; url: string }>;
}
