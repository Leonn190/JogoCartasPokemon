import type { CardCollection, StoredCard, WorkspaceState } from '../types/card';
import { cardDisplayName } from './collections';
import { createStoreZip } from './simpleZip';

type ZipEntry = { name: string; data: string | Uint8Array };

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function uniqueDirectoryName(preferred: string, fallback: string, used: Set<string>) {
  const base = slugify(preferred) || slugify(fallback) || 'item';
  let result = base;
  let suffix = 2;
  while (used.has(result)) result = `${base}-${suffix++}`;
  used.add(result);
  return result;
}

function dataUrlToBytes(value: string) {
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mime = (match[1] || 'application/octet-stream').toLowerCase();
  const raw = match[3] || '';
  if (match[2]) {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mime, bytes };
  }
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(raw)) };
}

function extensionForMime(mime: string) {
  const normalized = mime.split(';')[0]!.trim().toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/avif') return 'avif';
  if (normalized === 'image/svg+xml') return 'svg';
  throw new Error(`Formato de imagem não suportado no conteúdo: ${normalized || 'desconhecido'}.`);
}

async function readArtwork(artwork: string, label: string) {
  const embedded = dataUrlToBytes(artwork);
  if (embedded) return embedded;
  try {
    const response = await fetch(artwork);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const mime = response.headers.get('content-type') || '';
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { mime, bytes };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'falha desconhecida';
    throw new Error(`Não foi possível incorporar a imagem de ${label} (${reason}).`);
  }
}

function cardDirectoryLabel(stored: StoredCard) {
  const number = String(stored.data.cardNumber || 0).padStart(3, '0');
  const name = cardDisplayName(stored.data);
  const variant = stored.data.cardType === 'pokemon' ? stored.data.form : stored.data.cardType;
  return `${number}-${name}-${variant}`;
}

async function addCard(entries: ZipEntry[], collectionPath: string, stored: StoredCard, directory: string) {
  const copy = structuredClone(stored);
  const artwork = copy.data.artwork?.trim() || '';
  if (artwork) {
    const image = await readArtwork(artwork, cardDisplayName(copy.data));
    const imageName = `imagem.${extensionForMime(image.mime)}`;
    entries.push({ name: `${collectionPath}/${directory}/${imageName}`, data: image.bytes });
    copy.data.artwork = imageName;
  } else {
    copy.data.artwork = '';
  }
  entries.push({ name: `${collectionPath}/${directory}/carta.json`, data: `${JSON.stringify(copy, null, 2)}\n` });
}

function collectionMetadata(collection: CardCollection, exportedAt: string) {
  return {
    formatVersion: 2,
    id: collection.id,
    name: collection.name,
    code: collection.code,
    ...(collection.size ? { size: collection.size } : {}),
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
    exportedAt,
  };
}

/**
 * Gera um ZIP cuja raiz é `conteudo/`. Cada coleção é uma pasta e cada
 * carta é outra pasta contendo `carta.json` e, quando definida, `imagem.ext`.
 */
export async function exportContentZip(workspace: WorkspaceState) {
  const entries: ZipEntry[] = [];
  const exportedAt = new Date().toISOString();
  const usedCollections = new Set<string>();

  for (const collection of workspace.collections) {
    const collectionDirectory = uniqueDirectoryName(collection.name, collection.code, usedCollections);
    const collectionPath = `conteudo/${collectionDirectory}`;
    entries.push({
      name: `${collectionPath}/colecao.json`,
      data: `${JSON.stringify(collectionMetadata(collection, exportedAt), null, 2)}\n`,
    });

    const usedCards = new Set<string>();
    for (const stored of collection.cards) {
      const cardDirectory = uniqueDirectoryName(cardDirectoryLabel(stored), stored.id, usedCards);
      await addCard(entries, collectionPath, stored, cardDirectory);
    }
  }

  return { bytes: createStoreZip(entries), exportedAt, fileName: 'conteudo.zip' };
}

// Nome antigo mantido para integrações locais que já importavam a função.
export const exportWorkspaceZip = exportContentZip;
