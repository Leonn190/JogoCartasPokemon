export const CARD_TYPES = ['pokemon', 'attack', 'item', 'supporter', 'stadium', 'tool', 'rareItem', 'climate', 'champion'] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  pokemon: 'Pokémon',
  attack: 'Ataque',
  item: 'Item',
  supporter: 'Apoiador',
  stadium: 'Estádio',
  tool: 'Ferramenta',
  rareItem: 'Item Raro',
  climate: 'Clima',
  champion: 'Campeão',
};

export const TRAINER_CARD_TYPES = ['item', 'supporter', 'stadium', 'tool', 'rareItem', 'champion'] as const;
export type TrainerCardType = (typeof TRAINER_CARD_TYPES)[number];

export const UTILITY_CARD_TYPES = ['stadium', 'supporter', 'item', 'rareItem', 'tool'] as const;
export type UtilityCardType = (typeof UTILITY_CARD_TYPES)[number];

export const CARD_FORMS = ['Normal', 'EX', 'Mega', 'Radiante', 'Gigantamax'] as const;
export type PokemonForm = (typeof CARD_FORMS)[number];

export const CARD_STAGES = ['BÁSICO', 'ESTÁGIO 1', 'ESTÁGIO 2', 'FINAL'] as const;
export type PokemonStage = (typeof CARD_STAGES)[number];

export const POKEMON_RARITIES = [
  'common',
  'uncommon',
  'rare',
  'ultraRare',
  'illustrationRare',
  'illustrationRareUltra',
] as const;
export type PokemonRarity = (typeof POKEMON_RARITIES)[number];

export const POKEMON_RARITY_LABELS: Record<PokemonRarity, string> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Raro',
  ultraRare: 'Ultra Raro',
  illustrationRare: 'Ilustração Rara',
  illustrationRareUltra: 'Ilustração Rara Ultra',
};

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

export type ArtworkSource = 'manual' | 'tcgdex' | 'none';

export interface BaseCardData {
  cardType: CardType;
  artwork: string;
  artworkSource?: ArtworkSource;
  artworkSourceCardId?: string;
  artworkSourceLabel?: string;
  artworkTransform: ArtworkTransform;
  expandedArtwork?: boolean;
  cardNumber: number;
  setTotal: number;
  setCode: string;
}

export interface PokemonCardData extends BaseCardData, CardStats {
  cardType: 'pokemon';
  pokemonId: number | null;
  pokemonName: string;
  form: PokemonForm;
  rarity: PokemonRarity;
  type: GameType;
  typeCandidates?: GameType[];
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
}

export interface CompatiblePokemon {
  id: number;
  name: string;
  sprite: string;
}

export type AttackCompatibilityMode = 'specific' | 'type';
export type AttackKind = 'normal' | 'special';
export type AttackPower = number;

export interface AttackCardData extends BaseCardData {
  cardType: 'attack';
  attackKind: AttackKind;
  attackName: string;
  attackDescription: string;
  power: AttackPower;
  type: GameType;
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

export interface ClimateCardData extends BaseCardData {
  cardType: 'climate';
  name: string;
  effectText: string;
}

export interface ChampionCardData extends BaseCardData {
  cardType: 'champion';
  name: string;
  victoryCondition: string;
  defeatCondition: string;
  passiveName: string;
  passiveDescription: string;
  initialPokemonCount: number;
  initialAttackCount: number;
  initialTrainerCount: number;
}

export type CardData = PokemonCardData | AttackCardData | UtilityCardData | ClimateCardData | ChampionCardData;

export interface StoredCard {
  id: string;
  collectionId: string;
  createdAt: string;
  updatedAt: string;
  data: CardData;
}

export interface CardCollection {
  id: string;
  name: string;
  code: string;
  /** Campo legado opcional, ignorado pelas coleções livres atuais. */
  size?: 'normal' | 'large';
  createdAt: string;
  updatedAt: string;
  cards: StoredCard[];
}

export interface WorkspaceState {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  collections: CardCollection[];
}

export interface OfficialStats extends CardStats {}

export interface EditorReferenceData {
  officialStats: OfficialStats | null;
  abilities: Array<{ name: string; url: string }>;
}
