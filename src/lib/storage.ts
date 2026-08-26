import type { PokemonCardData } from '../types/card';

const DRAFT_KEY = 'card-forge:draft:v1';
const DB_NAME = 'card-forge-artwork';
const STORE = 'artwork';
const ART_KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putArtwork(value: string) {
  if (!('indexedDB' in window)) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, ART_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getArtwork(): Promise<string> {
  if (!('indexedDB' in window)) return '';
  const db = await openDb();
  const value = await new Promise<string>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(ART_KEY);
    request.onsuccess = () => resolve(request.result || '');
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

async function clearArtwork() {
  if (!('indexedDB' in window)) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(ART_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function saveDraft(card: PokemonCardData) {
  const copy = { ...card, artwork: '' };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(copy));
  try { await putArtwork(card.artwork); } catch { /* localStorage draft remains useful */ }
}

export async function loadDraft(): Promise<PokemonCardData | null> {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as PokemonCardData;
    try { data.artwork = await getArtwork(); } catch { data.artwork = ''; }
    return data;
  } catch {
    return null;
  }
}

export async function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  try { await clearArtwork(); } catch { /* noop */ }
}
