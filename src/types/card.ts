export const CARD_TYPES = ['pokemon', 'attack', 'stadium', 'supporter', 'item', 'tool', 'champion'] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  pokemon: 'Pokémon',
  attack: 'Ataque',
  stadium: 'Estádio',
  supporter: 'Apoiador',
  item: 'Item',
  tool: 'Ferramenta',
  champion: 'Campeão',
};

export const UTILITY_CARD_TYPES = ['stadium', 'supporter', 'item', 'tool', 'champion'] as const;
export type UtilityCardType = (typeof UTILITY_CARD_TYPES)[number];

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

export interface BaseCardData {
  cardType: CardType;
  artwork: string;
  artworkTransform: ArtworkTransform;
  cardNumber: number;
  setTotal: 150;
  setCode: string;
}

export interface PokemonCardData extends BaseCardData, CardStats {
  cardType: 'pokemon';
  pokemonId: number | null;
  pokemonName: string;
  form: PokemonForm;
  type: GameType;
  stage: PokemonStage;
  previousEvolution: string;
  previousEvolutionImage: string;
  expandedArtwork: boolean;
  pokedexNumber: number | null;
  genus: string;
  height: string;
  weight: string;
  region: string;
  abilityName: string;
  abilityDescription: string;
  flavorText: string;
  isLegendary: boolean;
  isMythical: boolean;
}

export interface CompatiblePokemon {
  id: number;
  name: string;
  sprite: string;
}

export type AttackCompatibilityMode = 'specific' | 'type';
export type AttackKind = 'normal' | 'special';

export interface AttackCardData extends BaseCardData {
  cardType: 'attack';
  attackKind: AttackKind;
  attackName: string;
  attackDescription: string;
  compatibilityMode: AttackCompatibilityMode;
  compatiblePokemon: CompatiblePokemon[];
  compatibleType: GameType;
}

export interface UtilityCardData extends BaseCardData {
  cardType: UtilityCardType;
  name: string;
  effectText: string;
  usageText: string;
}

export type CardData = PokemonCardData | AttackCardData | UtilityCardData;

export interface OfficialStats extends CardStats {}

export interface EditorReferenceData {
  officialStats: OfficialStats | null;
  abilities: Array<{ name: string; url: string }>;
}
