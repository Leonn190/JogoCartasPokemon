import type { CardData, PokemonCardData } from '../types/card';

const DRAFT_KEY = 'card-forge:draft:v3';
const LEGACY_V2_DRAFT_KEY = 'card-forge:draft:v2';
const LEGACY_DRAFT_KEY = 'card-forge:draft:v1';
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

function migrateLegacy(value: PokemonCardData): CardData {
  return {
    ...value,
    cardType: 'pokemon',
    rarity: value.rarity ?? 'common',
    setTotal: Number(value.setTotal) || 170,
    artworkTransform: {
      scale: value.artworkTransform?.scale ?? 1,
      x: value.artworkTransform?.x ?? 0,
      y: value.artworkTransform?.y ?? 0,
    },
  };
}

export async function saveDraft(card: CardData) {
  const copy = { ...card, artwork: '' };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(copy));
  try { await putArtwork(card.artwork); } catch { /* localStorage draft remains useful */ }
}

export async function loadDraft(): Promise<CardData | null> {
  const currentRaw = localStorage.getItem(DRAFT_KEY);
  const v2Raw = localStorage.getItem(LEGACY_V2_DRAFT_KEY);
  const v1Raw = localStorage.getItem(LEGACY_DRAFT_KEY);
  const raw = currentRaw ?? v2Raw ?? v1Raw;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CardData | PokemonCardData;
    const data = 'cardType' in parsed ? parsed as CardData : migrateLegacy(parsed as PokemonCardData);

    // A versão v2 ainda usava a escala antiga 0–30 em vários rascunhos.
    // Quando todos os seis atributos estão nessa faixa, preservamos a intenção
    // do usuário migrando 8 -> 80, 10 -> 100 etc. A v3 já salva em dezenas.
    if (!currentRaw && data.cardType === 'pokemon') {
      const values = [data.hp, data.attack, data.defense, data.specialAttack, data.specialDefense, data.speed];
      if (values.some((value) => value > 0) && values.every((value) => value >= 0 && value <= 30)) {
        data.hp *= 10;
        data.attack *= 10;
        data.defense *= 10;
        data.specialAttack *= 10;
        data.specialDefense *= 10;
        data.speed *= 10;
      }
    }

    try { data.artwork = await getArtwork(); } catch { data.artwork = ''; }
    return data;
  } catch {
    return null;
  }
}

export async function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  localStorage.removeItem(LEGACY_V2_DRAFT_KEY);
  localStorage.removeItem(LEGACY_DRAFT_KEY);
  try { await clearArtwork(); } catch { /* noop */ }
}
