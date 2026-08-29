import type { CardData, WorkspaceState } from '../types/card';
import { createStoreZip, decodeZipText, readZip } from './simpleZip';
import { COLLECTION_CATEGORY_ORDER } from '../data/gameConfig';

const SCHEMA_VERSION = 1;

type Manifest = {
  schemaVersion: 1;
  exportedAt: string;
  revision: number;
  rules: { categoryOrder: typeof COLLECTION_CATEGORY_ORDER };
  collections: Array<{ id: string; name: string; code: string; path: string; size?: string }>;
};

function dataUrlToBytes(value: string) {
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const raw = match[3] || '';
  if (match[2]) {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mime, bytes };
  }
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(raw)) };
}

function bytesToDataUrl(bytes: Uint8Array, mime: string) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(binary)}`;
}

function extensionForMime(mime: string) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'bin';
}

function cloneCardForZip(card: CardData, collectionId: string, cardId: string, entries: Array<{ name: string; data: string | Uint8Array }>) {
  const copy = structuredClone(card);
  if (copy.artwork) {
    const decoded = dataUrlToBytes(copy.artwork);
    if (decoded) {
      const path = `collections/${collectionId}/artworks/${cardId}.${extensionForMime(decoded.mime)}`;
      entries.push({ name: path, data: decoded.bytes });
      copy.artwork = `zip://${path}|${decoded.mime}`;
    }
  }
  return copy;
}

export function exportWorkspaceZip(workspace: WorkspaceState) {
  const entries: Array<{ name: string; data: string | Uint8Array }> = [];
  const exportedAt = new Date().toISOString();
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    revision: workspace.revision,
    rules: { categoryOrder: COLLECTION_CATEGORY_ORDER },
    collections: workspace.collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      code: collection.code,
      path: `collections/${collection.id}/collection.json`,
    })),
  };
  entries.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });

  for (const collection of workspace.collections) {
    const collectionMeta = { ...collection, cards: undefined };
    entries.push({ name: `collections/${collection.id}/collection.json`, data: JSON.stringify(collectionMeta, null, 2) });
    const cards = collection.cards.map((stored) => ({
      ...stored,
      data: cloneCardForZip(stored.data, collection.id, stored.id, entries),
    }));
    entries.push({ name: `collections/${collection.id}/cards.json`, data: JSON.stringify(cards, null, 2) });
  }

  return { bytes: createStoreZip(entries), exportedAt };
}

function parseJson<T>(files: Map<string, Uint8Array>, path: string): T {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`Arquivo ausente no conteúdo: ${path}`);
  return JSON.parse(decodeZipText(bytes)) as T;
}

export async function importWorkspaceZip(bytes: Uint8Array): Promise<{ workspace: WorkspaceState; exportedAt: string }> {
  const files = await readZip(bytes);
  const manifest = parseJson<Manifest>(files, 'manifest.json');
  if (manifest.schemaVersion !== SCHEMA_VERSION) throw new Error(`Schema de conteúdo incompatível: ${manifest.schemaVersion}.`);
  const collections = [] as WorkspaceState['collections'];

  for (const entry of manifest.collections) {
    const collection = parseJson<any>(files, entry.path);
    const cards = parseJson<any[]>(files, `collections/${entry.id}/cards.json`);
    for (const stored of cards) {
      const artwork = stored?.data?.artwork;
      if (typeof artwork === 'string' && artwork.startsWith('zip://')) {
        const payload = artwork.slice(6);
        const separator = payload.lastIndexOf('|');
        const path = separator >= 0 ? payload.slice(0, separator) : payload;
        const mime = separator >= 0 ? payload.slice(separator + 1) : 'application/octet-stream';
        const image = files.get(path);
        stored.data.artwork = image ? bytesToDataUrl(image, mime) : '';
      }
    }
    collections.push({ ...collection, cards });
  }

  return {
    workspace: {
      schemaVersion: 1,
      revision: Number(manifest.revision) || 0,
      updatedAt: manifest.exportedAt,
      snapshotExportedAt: manifest.exportedAt,
      collections,
    },
    exportedAt: manifest.exportedAt,
  };
}
