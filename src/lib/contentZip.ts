import JSZip from 'jszip';
import type { CardData } from '../types/card';
import type { CardCollection, ContentState, StoredCard } from '../types/collection';
import { CONTENT_SCHEMA_VERSION, createEmptyContentState, renumberCollection, validateCollection } from './collections';

interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  collectionIds: string[];
}

interface SerializedCard extends Omit<StoredCard, 'data'> {
  data: Omit<CardData, 'artwork'> & { artwork: string; artworkFile?: string };
}

function dataUrlToBytes(dataUrl: string) {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const payload = match[2] || '';
  const isBase64 = dataUrl.slice(0, dataUrl.indexOf(',')).includes(';base64');
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
}

function bytesToDataUrl(bytes: Uint8Array, mime: string) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function extensionForMime(mime: string) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'png';
}

export async function buildContentZip(state: ContentState): Promise<Uint8Array> {
  const zip = new JSZip();
  const generatedAt = state.generatedAt || new Date().toISOString();
  const manifest: Manifest = {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    generatedAt,
    collectionIds: state.collections.map((collection) => collection.id),
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  for (const collection of state.collections) {
    const normalized = renumberCollection(collection);
    const base = `collections/${normalized.id}`;
    const { cards, ...collectionMeta } = normalized;
    zip.file(`${base}/collection.json`, JSON.stringify(collectionMeta, null, 2));

    const serialized: SerializedCard[] = [];
    for (const card of cards) {
      const copy = structuredClone(card) as SerializedCard;
      const artwork = copy.data.artwork || '';
      const decoded = artwork.startsWith('data:image/') ? dataUrlToBytes(artwork) : null;
      if (decoded) {
        const path = `${base}/artworks/${card.id}.${extensionForMime(decoded.mime)}`;
        zip.file(path, decoded.bytes);
        copy.data.artwork = '';
        copy.data.artworkFile = `artworks/${card.id}.${extensionForMime(decoded.mime)}`;
      }
      serialized.push(copy);
    }
    zip.file(`${base}/cards.json`, JSON.stringify(serialized, null, 2));
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function readContentZip(input: ArrayBuffer | Uint8Array | Blob): Promise<ContentState> {
  const zip = await JSZip.loadAsync(input);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('manifest.json ausente no conteudo.zip.');
  const manifest = JSON.parse(await manifestFile.async('string')) as Manifest;
  if (manifest.schemaVersion !== CONTENT_SCHEMA_VERSION) {
    throw new Error(`Schema ${manifest.schemaVersion} não reconhecido. Versão suportada: ${CONTENT_SCHEMA_VERSION}.`);
  }

  const collections: CardCollection[] = [];
  for (const id of manifest.collectionIds || []) {
    const base = `collections/${id}`;
    const collectionFile = zip.file(`${base}/collection.json`);
    const cardsFile = zip.file(`${base}/cards.json`);
    if (!collectionFile || !cardsFile) continue;
    const collectionMeta = JSON.parse(await collectionFile.async('string')) as Omit<CardCollection, 'cards'>;
    const serialized = JSON.parse(await cardsFile.async('string')) as SerializedCard[];
    const cards: StoredCard[] = [];

    for (const item of serialized) {
      const data = structuredClone(item.data) as CardData & { artworkFile?: string };
      if (data.artworkFile) {
        const artFile = zip.file(`${base}/${data.artworkFile}`);
        if (artFile) {
          const bytes = await artFile.async('uint8array');
          const extension = data.artworkFile.split('.').pop()?.toLowerCase();
          const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
            : extension === 'webp' ? 'image/webp'
              : extension === 'gif' ? 'image/gif' : 'image/png';
          data.artwork = bytesToDataUrl(bytes, mime);
        } else data.artwork = '';
        delete data.artworkFile;
      }
      cards.push({ ...item, data });
    }

    const collection = renumberCollection({ ...collectionMeta, cards });
    const errors = validateCollection(collection);
    if (errors.length) throw new Error(`Coleção ${collection.name} excede limites: ${errors.join(', ')}.`);
    collections.push(collection);
  }

  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    generatedAt: manifest.generatedAt || new Date(0).toISOString(),
    collections,
  };
}

export async function loadPublishedContent(baseUrl: string): Promise<ContentState | null> {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  try {
    const response = await fetch(`${normalizedBase}conteudo.zip?v=${Date.now()}`, { cache: 'no-store' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Falha ao carregar conteudo.zip (${response.status}).`);
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) return null;
    return await readContentZip(bytes);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function downloadContentZip(bytes: Uint8Array) {
  const blob = new Blob([bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.download = 'conteudo.zip';
  anchor.href = url;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function emptyContentState() {
  return createEmptyContentState();
}
