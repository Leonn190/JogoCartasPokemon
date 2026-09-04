import type { AttackCardData, CardCollection, GameType, PokemonCardData, StoredCard } from '../types/card';

export type PhysicalPileId =
  | 'pokemonA' | 'pokemonB'
  | 'trainerA' | 'trainerB'
  | 'attackA' | 'attackB';

export type StadiumSlotId = 'AB' | 'BC' | 'CD' | 'DA';
export type FormationMode = 'official' | 'test';
export type TimerMode = 'official' | 'none';
export type PlayerId = 'player-1' | 'player-2' | 'player-3' | 'player-4';
export type ActionSlot = 'primary' | 'secondary';
export type GameStatus = 'setup' | 'playing' | 'waitingForChoice' | 'finished';

export type JourneyPhase =
  | 'menu'
  | 'formation'
  | 'initialPokemon'
  | 'roundStart'
  | 'preparation'
  | 'reveal'
  | 'onReveal'
  | 'confrontation'
  | 'order'
  | 'resolution'
  | 'roundEnd'
  | 'acquisitions'
  | 'handLimit'
  | 'priority'
  | 'pokemonZone'
  | 'gameOver';

export interface CardInstance {
  instanceId: string;
  cardId: string;
  originalCardId: string;
  ownerId: PlayerId | 'central';
  controllerId?: PlayerId;
  lastControllerId?: PlayerId;
  origin: string;
}

export interface AttackSlotState {
  level: 1 | 2 | 3;
  attackInstanceId: string;
  state: 'learned' | 'mastered';
  summoned: boolean;
}

export interface PokemonModifierState {
  offense: number;
  defense: number;
  speed: number;
}

export interface PokemonEffectState {
  id: string;
  name: string;
  tone: 'positive' | 'negative' | 'neutral';
  source: string;
  duration: 'round' | 'persistent' | 'untilUsed';
  roundApplied: number;
  data?: Record<string, string | number | boolean>;
}

export interface PokemonInPlay {
  pokemonId: string;
  ownerId: PlayerId;
  currentCardInstanceId: string;
  evolutionStack: string[];
  damage: number;
  modifiers: PokemonModifierState;
  temporaryModifiers: PokemonModifierState;
  effects: PokemonEffectState[];
  toolInstanceId?: string;
  attacks: AttackSlotState[];
  evolvedThisRound: boolean;
  attackedThisRound: boolean;
  resurrectionUsed: boolean;
  knockoutCount: number;
  knockedOut: boolean;
  flags: Record<string, string | number | boolean>;
}

export interface PlayerWildcardState {
  attack: boolean;
  draw: boolean;
  switch: boolean;
}

export interface PlayerRoundFlags {
  supporterUsed: boolean;
  firstAttackUsed: boolean;
  drawBlocked: boolean;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  active: boolean;
  finalPosition?: number;
  championId: string;
  championName: string;
  points: number;
  victoryPieces: number;
  defeatPieces: number;
  hand: string[];
  activePokemonId?: string;
  bench: string[];
  wildcards: PlayerWildcardState;
  programmed: {
    primary?: ProgrammedAction;
    secondary?: ProgrammedAction;
    locked: boolean;
  };
  supporterChoice?: SupporterProgram;
  roundFlags: PlayerRoundFlags;
}

export interface BoardState {
  piles: Record<PhysicalPileId, string[]>;
  pokemonZone: string[];
  discard: DiscardEntry[];
  stadiums: Record<StadiumSlotId, string | null>;
  climate: string | null;
}

export interface DiscardEntry {
  instanceId: string;
  lastControllerId?: PlayerId;
  origin: string;
  cause: string;
}

export interface JourneyFormation {
  mode: FormationMode;
  collectionId: string;
  collectionName: string;
  selectedLineIds: string[];
  diagnostics: string[];
  officialMissing: Record<string, number>;
}

export interface EvolutionLine {
  id: string;
  basicCardId: string;
  name: string;
  rarity: PokemonCardData['rarity'];
  cards: string[];
  futureByLevel: string[];
  branches: string[][];
}

export interface InitialChoiceState {
  playerIndex: number;
  visible: boolean;
  options: string[];
  mulligans: number;
}

export interface PrivateTurnState {
  playerIndex: number;
  visible: boolean;
}

export interface ResolutionState {
  order: PlayerId[];
  index: number;
  slot: ActionSlot;
}

export interface AcquisitionState {
  playerIndex: number;
  visible: boolean;
}

export interface PendingChoice {
  id: string;
  kind: 'manual' | 'target' | 'discard' | 'orderPile' | 'attribute' | 'replacement';
  playerId?: PlayerId;
  prompt: string;
  options: Array<{ id: string; label: string; disabled?: boolean }>;
  data?: Record<string, string | number | boolean>;
}

export type ProgrammedAction =
  | { kind: 'none' }
  | { kind: 'learnAttack'; attackInstanceId: string; targetPokemonId: string }
  | { kind: 'reuseAttack'; level: 1 | 2 | 3; targetPokemonId: string }
  | { kind: 'playPokemon'; cardInstanceId: string; targetPokemonId?: string }
  | { kind: 'useItems'; itemInstanceIds: string[]; targets: Record<string, string> }
  | { kind: 'placeStadium'; stadiumInstanceId: string; slotId: StadiumSlotId }
  | { kind: 'buyWildcard'; pileId: PhysicalPileId | 'zone'; zoneInstanceId?: string }
  | { kind: 'switchWildcard'; benchPokemonId: string }
  | { kind: 'manual'; note: string };

export type SupporterProgram =
  | { kind: 'none' }
  | { kind: 'useSupporter'; supporterInstanceId: string; targetPokemonId?: string; pileIds?: PhysicalPileId[]; discardInstanceId?: string };

export interface GameLogEntry {
  id: string;
  round: number;
  phase: JourneyPhase;
  message: string;
  privateFor?: PlayerId;
  createdAt: string;
}

export interface GameState {
  schemaVersion: 1;
  id: string;
  status: GameStatus;
  collectionId: string;
  collectionName: string;
  round: number;
  phase: JourneyPhase;
  priorityPlayerId: PlayerId;
  players: PlayerState[];
  board: BoardState;
  instances: Record<string, CardInstance>;
  pokemon: Record<string, PokemonInPlay>;
  formation: JourneyFormation;
  evolutionLines: EvolutionLine[];
  rng: { seed: number; state: number };
  timerMode: TimerMode;
  initialChoice?: InitialChoiceState;
  privateTurn?: PrivateTurnState;
  confrontation?: PrivateTurnState;
  acquisition?: AcquisitionState;
  resolution?: ResolutionState;
  pendingChoice?: PendingChoice;
  ranking: PlayerId[];
  log: GameLogEntry[];
  createdAt: string;
  updatedAt: string;
  dev: {
    snapshots: string[];
    revealPiles: boolean;
    interpretations: string[];
  };
}

export interface CardLookup {
  collection: CardCollection;
  cards: Record<string, StoredCard>;
}

export interface DamageInput {
  attacker: PokemonInPlay;
  defender: PokemonInPlay;
  attackerStats: PokemonCardData;
  defenderStats: PokemonCardData;
  attack: AttackCardData;
  round: number;
  powerOverride?: number;
  matchupModifier?: number;
  finalModifier?: number;
}

export interface DamageBreakdown {
  kind: AttackCardData['attackKind'];
  offensiveStat: number;
  defensiveStat: number;
  power: number;
  rawDamage: number;
  roundBaseDamage: number;
  matchupModifier: number;
  finalModifier: number;
  finalDamage: number;
}

export interface PublicCardSummary {
  instanceId: string;
  cardId: string;
  name: string;
  typeLabel: string;
  gameType?: GameType;
}
