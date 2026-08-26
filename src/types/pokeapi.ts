export interface NamedAPIResource {
  name: string;
  url: string;
}

export interface PokemonListResponse {
  results: NamedAPIResource[];
}

export interface PokemonResponse {
  id: number;
  name: string;
  height: number;
  weight: number;
  types: Array<{ slot: number; type: NamedAPIResource }>;
  stats: Array<{ base_stat: number; stat: NamedAPIResource }>;
  abilities: Array<{ ability: NamedAPIResource; is_hidden: boolean; slot: number }>;
  species: NamedAPIResource;
  sprites: {
    front_default: string | null;
    other?: {
      'official-artwork'?: { front_default: string | null };
    };
  };
}

export interface PokemonSpeciesResponse {
  id: number;
  name: string;
  is_legendary: boolean;
  is_mythical: boolean;
  generation: NamedAPIResource;
  evolves_from_species: NamedAPIResource | null;
  evolution_chain: { url: string };
  genera: Array<{ genus: string; language: NamedAPIResource }>;
  flavor_text_entries: Array<{
    flavor_text: string;
    language: NamedAPIResource;
    version: NamedAPIResource;
  }>;
}

export interface EvolutionChainLink {
  species: NamedAPIResource;
  evolves_to: EvolutionChainLink[];
}

export interface EvolutionChainResponse {
  id: number;
  chain: EvolutionChainLink;
}

export interface AbilityResponse {
  name: string;
  effect_entries: Array<{
    effect: string;
    short_effect: string;
    language: NamedAPIResource;
  }>;
  flavor_text_entries: Array<{
    flavor_text: string;
    language: NamedAPIResource;
    version_group: NamedAPIResource;
  }>;
}
