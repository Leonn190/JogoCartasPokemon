import type {
  AbilityResponse,
  EvolutionChainResponse,
  PokemonListResponse,
  PokemonResponse,
  PokemonSpeciesResponse,
} from '../types/pokeapi';
import type { OfficialStats } from '../types/card';
import { findEvolutionPosition, stageFromDepth } from './evolution';
import { REGION_BY_GENERATION, sanitizeFlavorText, suggestGameType, titleCasePokemon } from './pokemonMapping';

const API = 'https://pokeapi.co/api/v2';
const CACHE_PREFIX = 'card-forge:pokeapi:v2:';
const MEMORY = new Map<string, unknown>();
const TTL = 1000 * 60 * 60 * 24 * 14;

interface CacheEnvelope<T> { value: T; savedAt: number }

function readCache<T>(key: string): T | null {
  if (MEMORY.has(key)) return MEMORY.get(key) as T;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (Date.now() - parsed.savedAt > TTL) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    MEMORY.set(key, parsed.value);
    return parsed.value;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T) {
  MEMORY.set(key, value);
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ value, savedAt: Date.now() }));
  } catch {
    // Cache é uma otimização; falhas de quota/privacidade não quebram o editor.
  }
}

async function apiFetch<T>(pathOrUrl: string, signal?: AbortSignal): Promise<T> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
  const key = url.replace(API, '');
  const cached = readCache<T>(key);
  if (cached) return cached;

  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 404 ? 'Pokémon não encontrado.' : `PokéAPI respondeu ${response.status}.`);
  const data = (await response.json()) as T;
  writeCache(key, data);
  return data;
}

export async function getPokemonIndex(signal?: AbortSignal): Promise<Array<{ name: string; id: number }>> {
  const cacheKey = 'pokemon-index';
  const cached = readCache<Array<{ name: string; id: number }>>(cacheKey);
  if (cached) return cached;

  const list = await apiFetch<PokemonListResponse>('/pokemon?limit=2000&offset=0', signal);
  const index = list.results.map((item) => ({
    name: item.name,
    id: Number(item.url.match(/\/pokemon\/(\d+)\/?$/)?.[1] ?? 0),
  }));
  writeCache(cacheKey, index);
  return index;
}

function pickLanguage<T extends { language: { name: string } }>(entries: T[]): T | undefined {
  return entries.find((entry) => entry.language.name === 'pt-BR')
    ?? entries.find((entry) => entry.language.name === 'pt')
    ?? entries.find((entry) => entry.language.name === 'en')
    ?? entries[0];
}

function roundStatToTen(value: number, max = Number.POSITIVE_INFINITY) {
  const rounded = Math.max(0, Math.round((value || 0) / 10) * 10);
  return Math.min(max, rounded);
}

function statsFromPokemon(pokemon: PokemonResponse): OfficialStats {
  const byName = Object.fromEntries(pokemon.stats.map((item) => [item.stat.name, item.base_stat]));
  return {
    hp: roundStatToTen(byName.hp ?? 0, 300),
    attack: roundStatToTen(byName.attack ?? 0),
    defense: roundStatToTen(byName.defense ?? 0),
    specialAttack: roundStatToTen(byName['special-attack'] ?? 0),
    specialDefense: roundStatToTen(byName['special-defense'] ?? 0),
    speed: roundStatToTen(byName.speed ?? 0),
  };
}

export async function loadPokemonEditorData(identifier: string | number, signal?: AbortSignal) {
  const normalized = String(identifier).trim().toLowerCase();
  const pokemon = await apiFetch<PokemonResponse>(`/pokemon/${encodeURIComponent(normalized)}`, signal);
  const species = await apiFetch<PokemonSpeciesResponse>(pokemon.species.url, signal);
  const evolution = await apiFetch<EvolutionChainResponse>(species.evolution_chain.url, signal);
  const position = findEvolutionPosition(evolution.chain, species.name);

  let previousEvolution = species.evolves_from_species?.name ?? '';
  if (!previousEvolution && position && position.path.length > 1) {
    previousEvolution = position.path[position.path.length - 2] ?? '';
  }

  let previousEvolutionImage = '';
  if (previousEvolution) {
    try {
      const previous = await apiFetch<PokemonResponse>(`/pokemon/${previousEvolution}`, signal);
      previousEvolutionImage = previous.sprites.front_default
        ?? previous.sprites.other?.['official-artwork']?.front_default
        ?? '';
    } catch {
      previousEvolutionImage = '';
    }
  }

  const genusEntry = pickLanguage(species.genera);
  const flavorEntry = pickLanguage(species.flavor_text_entries);
  const suggestedType = suggestGameType(pokemon.types.sort((a, b) => a.slot - b.slot).map((entry) => entry.type.name));

  return {
    pokemon: {
      pokemonId: pokemon.id,
      pokemonName: titleCasePokemon(pokemon.name),
      pokedexNumber: pokemon.id,
      height: `${(pokemon.height / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m`,
      weight: `${(pokemon.weight / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`,
      genus: genusEntry?.genus || 'Pokémon',
      flavorText: sanitizeFlavorText(flavorEntry?.flavor_text || ''),
      region: REGION_BY_GENERATION[species.generation.name] || '',
      previousEvolution: previousEvolution ? titleCasePokemon(previousEvolution) : '',
      previousEvolutionImage,
      stage: stageFromDepth(position?.depth ?? 0),
      suggestedType,
    },
    officialStats: statsFromPokemon(pokemon),
    abilities: pokemon.abilities.map(({ ability }) => ({ name: titleCasePokemon(ability.name), url: ability.url })),
  };
}

export async function loadAbilityDescription(url: string, signal?: AbortSignal): Promise<string> {
  const ability = await apiFetch<AbilityResponse>(url, signal);
  const flavor = pickLanguage(ability.flavor_text_entries);
  if (flavor?.flavor_text) return sanitizeFlavorText(flavor.flavor_text);
  const effect = ability.effect_entries.find((entry) => entry.language.name === 'en') ?? ability.effect_entries[0];
  return sanitizeFlavorText(effect?.short_effect || effect?.effect || '');
}

export async function loadPokemonSummary(identifier: string | number, signal?: AbortSignal) {
  const normalized = String(identifier).trim().toLowerCase();
  const pokemon = await apiFetch<PokemonResponse>(`/pokemon/${encodeURIComponent(normalized)}`, signal);
  return {
    id: pokemon.id,
    name: titleCasePokemon(pokemon.name),
    sprite: pokemon.sprites.other?.['official-artwork']?.front_default
      ?? pokemon.sprites.front_default
      ?? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png`,
  };
}
