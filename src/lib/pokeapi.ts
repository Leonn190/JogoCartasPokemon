import type {
  AbilityResponse,
  EvolutionChainResponse,
  PokemonListResponse,
  PokemonResponse,
  PokemonSpeciesResponse,
} from '../types/pokeapi';
import type { OfficialStats } from '../types/card';
import { findEvolutionPosition, stageFromDepth } from './evolution';
import { REGION_BY_GENERATION, sanitizeFlavorText, suggestGameTypes, titleCasePokemon } from './pokemonMapping';

const API = 'https://pokeapi.co/api/v2';
const MEMORY = new Map<string, unknown>();
const TRANSLATION_TIMEOUT_MS = 6500;

function readCache<T>(key: string): T | null {
  if (MEMORY.has(key)) return MEMORY.get(key) as T;
  return null;
}

function writeCache<T>(key: string, value: T) {
  MEMORY.set(key, value);
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
  const language = (entry: T) => entry.language.name.toLowerCase();
  return entries.find((entry) => language(entry) === 'pt-br')
    ?? entries.find((entry) => language(entry) === 'pt')
    ?? entries.find((entry) => language(entry) === 'en')
    ?? entries[0];
}

function hasPortuguese<T extends { language: { name: string } }>(entry: T | undefined) {
  const language = entry?.language.name.toLowerCase();
  return language === 'pt-br' || language === 'pt';
}

async function translateToPortuguese(pokemonKey: string, field: 'genus' | 'flavorText', source: string, signal?: AbortSignal) {
  const clean = sanitizeFlavorText(source).replace(/[\u0000-\u001f\u007f]/g, '');
  if (!clean) return clean;
  const cacheKey = `translation:${pokemonKey}:${field}:${clean}`;
  const cached = readCache<string>(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  signal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = window.setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean)}&langpair=en|pt-BR`;
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) { writeCache(cacheKey, clean); return clean; }
    const payload = await response.json() as { responseData?: { translatedText?: string } };
    const translated = sanitizeFlavorText(payload.responseData?.translatedText || '');
    if (!translated) { writeCache(cacheKey, clean); return clean; }
    writeCache(cacheKey, translated);
    return translated;
  } catch {
    if (signal?.aborted) throw new DOMException('Operação cancelada.', 'AbortError');
    writeCache(cacheKey, clean);
    return clean;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

async function localizedSpeciesText<T extends { language: { name: string } }>(
  pokemonKey: string,
  field: 'genus' | 'flavorText',
  entries: T[],
  read: (entry: T) => string,
  signal?: AbortSignal,
) {
  const selected = pickLanguage(entries);
  const source = sanitizeFlavorText(selected ? read(selected) : '');
  return hasPortuguese(selected) ? source : translateToPortuguese(pokemonKey, field, source, signal);
}

function naturalizeGenus(value: string) {
  const clean = sanitizeFlavorText(value);
  const withoutPokemon = clean.replace(/\s+Pok[eé]mon$/i, '').replace(/^Pok[eé]mon\s+/i, '').trim();
  return withoutPokemon ? `Pokémon ${withoutPokemon}` : 'Pokémon';
}

function regionalFormRegion(name: string) {
  if (/(?:^|-)alola(?:n)?(?:-|$)/.test(name)) return 'Alola';
  if (/(?:^|-)galar(?:ian)?(?:-|$)/.test(name)) return 'Galar';
  if (/(?:^|-)hisui(?:an)?(?:-|$)/.test(name)) return 'Hisui';
  if (/(?:^|-)paldea(?:n)?(?:-|$)/.test(name)) return 'Paldea';
  return '';
}

function pokemonDisplayIdentity(apiName: string) {
  const parts = apiName.split('-');
  const megaIndex = parts.indexOf('mega');
  if (megaIndex >= 0) {
    const nameParts = parts.filter((_, index) => index !== megaIndex);
    return { name: titleCasePokemon(nameParts.join('-')), inferredForm: 'Mega' as const };
  }
  return { name: titleCasePokemon(apiName), inferredForm: null };
}

function roundStatToTen(value: number, max = Number.POSITIVE_INFINITY) {
  const rounded = Math.max(0, Math.round((value || 0) / 10) * 10);
  return Math.min(max, rounded);
}

function scaleOfficialStat(value: number, max = Number.POSITIVE_INFINITY) {
  return roundStatToTen((value || 0) * 1.1, max);
}

function statsFromPokemon(pokemon: PokemonResponse): OfficialStats {
  const byName = Object.fromEntries(pokemon.stats.map((item) => [item.stat.name, item.base_stat]));
  return {
    hp: scaleOfficialStat(byName.hp ?? 0, 300),
    attack: scaleOfficialStat(byName.attack ?? 0),
    defense: scaleOfficialStat(byName.defense ?? 0),
    specialAttack: scaleOfficialStat(byName['special-attack'] ?? 0),
    specialDefense: scaleOfficialStat(byName['special-defense'] ?? 0),
    speed: scaleOfficialStat(byName.speed ?? 0),
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

  const [rawGenus, flavorText] = await Promise.all([
    localizedSpeciesText(species.name, 'genus', species.genera, (entry) => entry.genus, signal),
    localizedSpeciesText(species.name, 'flavorText', species.flavor_text_entries, (entry) => entry.flavor_text, signal),
  ]);
  const identity = pokemonDisplayIdentity(pokemon.name);
  const typeCandidates = suggestGameTypes(pokemon.types.sort((a, b) => a.slot - b.slot).map((entry) => entry.type.name));
  const suggestedType = typeCandidates.length === 1 ? typeCandidates[0]! : null;

  return {
    pokemon: {
      pokemonId: pokemon.id,
      pokemonName: identity.name,
      pokedexNumber: species.id,
      height: `${(pokemon.height / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m`,
      weight: `${(pokemon.weight / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`,
      genus: naturalizeGenus(rawGenus),
      flavorText,
      region: regionalFormRegion(pokemon.name) || REGION_BY_GENERATION[species.generation.name] || '',
      inferredForm: identity.inferredForm,
      previousEvolution: previousEvolution ? titleCasePokemon(previousEvolution) : '',
      previousEvolutionImage,
      stage: stageFromDepth(position?.depth ?? 0),
      suggestedType,
      typeCandidates,
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
