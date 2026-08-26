import type { EvolutionChainLink } from '../types/pokeapi';
import type { PokemonStage } from '../types/card';

export interface EvolutionPosition {
  depth: number;
  path: string[];
}

export function findEvolutionPosition(root: EvolutionChainLink, targetName: string): EvolutionPosition | null {
  const queue: Array<{ node: EvolutionChainLink; depth: number; path: string[] }> = [
    { node: root, depth: 0, path: [root.species.name] },
  ];

  while (queue.length) {
    const current = queue.shift()!;
    if (current.node.species.name === targetName) {
      return { depth: current.depth, path: current.path };
    }
    for (const child of current.node.evolves_to) {
      queue.push({ node: child, depth: current.depth + 1, path: [...current.path, child.species.name] });
    }
  }
  return null;
}

export function stageFromDepth(depth: number): PokemonStage {
  if (depth <= 0) return 'BÁSICO';
  if (depth === 1) return 'ESTÁGIO 1';
  return 'ESTÁGIO 2';
}
