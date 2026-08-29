import type {
  AttackCardData,
  CardData,
  CardType,
  ChampionCardData,
  ClimateCardData,
  PokemonCardData,
  UtilityCardData,
  UtilityCardType,
} from '../types/card';

export const DEFAULT_POKEMON_CARD: PokemonCardData = {
  cardType: 'pokemon',
  pokemonId: 6,
  pokemonName: 'Charizard',
  form: 'Normal',
  rarity: 'rare',
  type: 'Fogo',
  stage: 'ESTÁGIO 2',
  previousEvolution: 'Charmeleon',
  previousEvolutionImage: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/5.png',
  artwork: '',
  artworkSource: 'none',
  artworkTransform: { scale: 1, x: 0, y: 0 },
  expandedArtwork: false,
  pokedexNumber: 6,
  genus: 'Pokémon Chama',
  height: '1,7 m',
  weight: '90,5 kg',
  region: 'Kanto',
  hp: 100,
  attack: 80,
  defense: 60,
  specialAttack: 90,
  specialDefense: 70,
  speed: 70,
  abilityName: 'Chamas Imperiais',
  abilityDescription: 'Uma vez por Momento, quando este Pokémon usar um ataque de Fogo, ele recebe +10 de poder.',
  flavorText: 'Diz-se que seu fogo queima ainda mais intensamente após grandes batalhas.',
  cardNumber: 1,
  setTotal: 160,
  setCode: 'SET',
};

export const EMPTY_POKEMON_CARD: PokemonCardData = {
  ...DEFAULT_POKEMON_CARD,
  pokemonId: null,
  pokemonName: 'Novo Pokémon',
  form: 'Normal',
  rarity: 'common',
  type: 'Fogo',
  stage: 'BÁSICO',
  previousEvolution: '',
  previousEvolutionImage: '',
  artwork: '',
  artworkSource: 'none',
  artworkTransform: { scale: 1, x: 0, y: 0 },
  expandedArtwork: false,
  pokedexNumber: null,
  genus: 'Pokémon',
  height: '—',
  weight: '—',
  region: '—',
  hp: 0,
  attack: 0,
  defense: 0,
  specialAttack: 0,
  specialDefense: 0,
  speed: 0,
  abilityName: 'Nome da habilidade',
  abilityDescription: 'Escreva aqui o efeito da habilidade deste Pokémon.',
  flavorText: 'Adicione uma breve descrição para o rodapé da carta.',
  cardNumber: 1,
  setTotal: 160,
  setCode: 'SET',
};

export const DEFAULT_ATTACK_CARD: AttackCardData = {
  cardType: 'attack',
  attackKind: 'normal',
  attackName: 'Aqua Jet',
  attackDescription: 'Descreva aqui o efeito completo deste ataque durante a partida.',
  power: 100,
  type: 'Água',
  compatibilityMode: 'specific',
  compatiblePokemon: [],
  compatibleType: 'Água',
  artwork: '',
  artworkSource: 'none',
  artworkTransform: { scale: 1, x: 0, y: 0 },
  expandedArtwork: false,
  cardNumber: 69,
  setTotal: 160,
  setCode: 'SET',
};

const UTILITY_COPY: Record<UtilityCardType, { name: string; effect: string; usage: string; number: number }> = {
  stadium: {
    name: 'Arena Central',
    effect: 'Escreva aqui o efeito que este Estádio produz enquanto estiver em jogo.',
    usage: 'Posicione em uma das quatro áreas entre dois jogadores. Afeta apenas os dois jogadores conectados. Pode ser combinado com 1 Ferramenta na mesma ação, mas nunca com outro Estádio.',
    number: 133,
  },
  supporter: {
    name: 'Parceiro de Jornada',
    effect: 'Escreva aqui o efeito concedido por este Apoiador.',
    usage: 'Use somente na Janela de Apoiadores/Confronto, depois da Revelação e antes da resolução por VEL. Máximo de 1 Apoiador por jogador por Rodada.',
    number: 125,
  },
  item: {
    name: 'Kit de Campo',
    effect: 'Escreva aqui o efeito produzido por este Item.',
    usage: 'Use como uma ação. Uma única ação de Item pode empilhar até 2 Itens normais. Depois do uso, descarte-os salvo efeito em contrário.',
    number: 117,
  },
  rareItem: {
    name: 'Relíquia de Jornada',
    effect: 'Escreva aqui o efeito especial produzido por este Item Raro.',
    usage: 'Ocupa uma ação sozinho. Não pode ser empilhado com outro Item Raro, Item normal, Ferramenta ou Estádio na mesma ação.',
    number: 145,
  },
  tool: {
    name: 'Insígnia de Aço',
    effect: 'Escreva aqui o efeito concedido por esta Ferramenta.',
    usage: 'Equipe em um Pokémon válido. Cada Pokémon pode ter 1 Ferramenta. Uma ação pode conter até 2 Ferramentas ou 1 Ferramenta + 1 Estádio.',
    number: 139,
  },
};

export const DEFAULT_CLIMATE_CARD: ClimateCardData = {
  cardType: 'climate',
  name: 'Céu de Tempestade',
  effectText: 'Descreva aqui o efeito global produzido por este Clima enquanto ele estiver ativo.',
  artwork: '',
  artworkSource: 'none',
  artworkTransform: { scale: 1, x: 0, y: 0 },
  expandedArtwork: false,
  cardNumber: 151,
  setTotal: 160,
  setCode: 'SET',
};

export const DEFAULT_CHAMPION_CARD: ChampionCardData = {
  cardType: 'champion',
  name: 'Campeão da Liga',
  victoryCondition: 'Defina aqui a condição pessoal de Vitória deste Campeão.',
  defeatCondition: 'Defina aqui a condição específica de Derrota deste Campeão.',
  passiveName: 'Presença de Campeão',
  passiveDescription: 'Descreva a Passiva que permanece ativa durante a Jornada.',
  initialPokemonCount: 2,
  initialAttackCount: 1,
  initialTrainerCount: 3,
  artwork: '',
  artworkSource: 'none',
  artworkTransform: { scale: 1, x: 0, y: 0 },
  expandedArtwork: false,
  cardNumber: 156,
  setTotal: 160,
  setCode: 'SET',
};

export function createUtilityCard(cardType: UtilityCardType): UtilityCardData {
  const copy = UTILITY_COPY[cardType];
  return {
    cardType,
    name: copy.name,
    effectText: copy.effect,
    usageText: copy.usage,
    artwork: '',
    artworkTransform: { scale: 1, x: 0, y: 0 },
    expandedArtwork: false,
    cardNumber: copy.number,
    setTotal: 160,
    setCode: 'SET',
  };
}

export function createClimateCard(): ClimateCardData {
  return structuredClone(DEFAULT_CLIMATE_CARD);
}

export function createChampionCard(): ChampionCardData {
  return structuredClone(DEFAULT_CHAMPION_CARD);
}

export function createEmptyCard(cardType: CardType): CardData {
  if (cardType === 'pokemon') return structuredClone(EMPTY_POKEMON_CARD);
  if (cardType === 'attack') return structuredClone(DEFAULT_ATTACK_CARD);
  if (cardType === 'climate') return createClimateCard();
  if (cardType === 'champion') return createChampionCard();
  return createUtilityCard(cardType);
}

// Aliases mantidos para compatibilidade com imports antigos do projeto.
export const DEFAULT_CARD = DEFAULT_POKEMON_CARD;
export const EMPTY_CARD = EMPTY_POKEMON_CARD;
