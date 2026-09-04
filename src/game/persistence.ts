import type { GameState } from './types';

const STORAGE_KEY = 'card-forge:journey:active:v1';

export function saveGameState(state: GameState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadGameState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GameState;
    if (parsed?.schemaVersion !== 1 || !parsed.id || !Array.isArray(parsed.players)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearGameState() {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportGameState(state: GameState) {
  return JSON.stringify(state, null, 2);
}

export function importGameState(raw: string) {
  const parsed = JSON.parse(raw) as GameState;
  if (parsed?.schemaVersion !== 1 || !parsed.id || !Array.isArray(parsed.players)) {
    throw new Error('GameState inválido.');
  }
  return parsed;
}
