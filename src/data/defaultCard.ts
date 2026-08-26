import type { AttackCardData, CardData, CardType, PokemonCardData, UtilityCardData, UtilityCardType } from '../types/card';

export const DEFAULT_POKEMON_CARD: PokemonCardData = {
  cardType: 'pokemon',
  pokemonId: 6,
  pokemonName: 'Charizard',
  form: 'Normal',
  type: 'Fogo',
  stage: 'ESTÁGIO 2',
  previousEvolution: 'Charmeleon',
  previousEvolutionImage: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/5.png',
  artwork: '',
  artworkTransform: { scale: 1, x: 0, y: 0 },
  expandedArtwork: false,
  pokedexNumber: 6,
  genus: 'Pokémon Chama',
  height: '1,7 m',
  weight: '90,5 kg',
  region: 'Kanto',
  hp: 10,
  attack: 8,
  defense: 6,
  specialAttack: 9,
  specialDefense: 7,
  speed: 7,
  abilityName: 'Chamas Imperiais',
  abilityDescription: 'Uma vez por Momento, quando este Pokémon usar um ataque de Fogo, ele recebe +1 de poder.',
  flavorText: 'Diz-se que seu fogo queima ainda mais intensamente após grandes batalhas.',
  cardNumber: 6,
  setTotal: 150,
  setCode: 'CKT',
  isLegendary: false,
  isMythical: false,
};

export const EMPTY_POKEMON_CARD: PokemonCardData = {
  ...DEFAULT_POKEMON_CARD,
  pokemonId: null,
  pokemonName: 'Novo Pokémon',
  form: 'Normal',
  type: 'Fogo',
  stage: 'BÁSICO',
  previousEvolution: '',
  previousEvolutionImage: '',
  artwork: '',
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
  setCode: 'CKT',
  isLegendary: false,
  isMythical: false,
};

export const DEFAULT_ATTACK_CARD: AttackCardData = {
  cardType: 'attack',
  attackName: 'Aqua Jet',
  attackDescription: 'Descreva aqui o efeito completo deste ataque durante a partida.',
  compatibilityMode: 'specific',
  compatiblePokemon: [],
  compatibleType: 'Água',
  artwork: '',
  artworkTransform: { scale: 1, x: 0, y: 0 },
  cardNumber: 66,
  setTotal: 150,
  setCode: 'CKT',
};

const UTILITY_COPY: Record<UtilityCardType, { name: string; effect: string; usage: string; number: number }> = {
  stadium: {
    name: 'Arena Central',
    effect: 'Escreva aqui o efeito que este Estádio produz enquanto estiver em jogo.',
    usage: 'Explique aqui como este Estádio entra em jogo e por quanto tempo seu efeito permanece.',
    number: 114,
  },
  supporter: {
    name: 'Parceiro de Jornada',
    effect: 'Escreva aqui o efeito concedido por este Apoiador.',
    usage: 'Explique aqui quando e como este Apoiador pode ser utilizado.',
    number: 122,
  },
  item: {
    name: 'Kit de Campo',
    effect: 'Escreva aqui o efeito produzido por este Item.',
    usage: 'Explique aqui quando este Item pode ser utilizado.',
    number: 132,
  },
  tool: {
    name: 'Insígnia de Aço',
    effect: 'Escreva aqui o efeito concedido por esta Ferramenta.',
    usage: 'Explique aqui como esta Ferramenta é utilizada em jogo.',
    number: 148,
  },
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
    cardNumber: copy.number,
    setTotal: 150,
    setCode: 'CKT',
  };
}

export function createEmptyCard(cardType: CardType): CardData {
  if (cardType === 'pokemon') return structuredClone(EMPTY_POKEMON_CARD);
  if (cardType === 'attack') return structuredClone(DEFAULT_ATTACK_CARD);
  return createUtilityCard(cardType);
}

// Aliases mantidos para compatibilidade com imports antigos do projeto.
export const DEFAULT_CARD = DEFAULT_POKEMON_CARD;
export const EMPTY_CARD = EMPTY_POKEMON_CARD;
