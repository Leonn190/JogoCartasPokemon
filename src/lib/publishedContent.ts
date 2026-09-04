import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardCollection, StoredCard } from '../types/card';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg']);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function extension(name: string) {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function publicContentUrl(baseUrl: string, ...segments: string[]) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}conteudo/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function resolveArtwork(
  stored: StoredCard,
  cardDirectory: string,
  baseUrl: string,
  collectionDirectoryName: string,
  cardDirectoryName: string,
) {
  const current = stored.data.artwork?.trim() || '';
  if (/^(?:data:|https?:|blob:)/i.test(current)) return current;

  const files = readdirSync(cardDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extension(entry.name)))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const aPreferred = /^imagem\./i.test(a) ? 0 : 1;
      const bPreferred = /^imagem\./i.test(b) ? 0 : 1;
      return aPreferred - bPreferred || a.localeCompare(b);
    });

  const imageName = current && existsSync(join(cardDirectory, current)) ? current : files[0];
  return imageName ? publicContentUrl(baseUrl, collectionDirectoryName, cardDirectoryName, imageName) : '';
}

function loadCollection(contentDirectory: string, directoryName: string, baseUrl: string): CardCollection {
  const collectionDirectory = join(contentDirectory, directoryName);
  const metadataPath = join(collectionDirectory, 'colecao.json');
  if (!existsSync(metadataPath)) throw new Error(`Coleção sem colecao.json: ${directoryName}`);

  const metadata = readJson<Omit<CardCollection, 'cards'> & { formatVersion?: number }>(metadataPath);
  if (!metadata?.id || !metadata?.name || !metadata?.code) throw new Error(`colecao.json inválido: ${directoryName}`);

  const cards = readdirSync(collectionDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const cardDirectory = join(collectionDirectory, entry.name);
      const cardPath = join(cardDirectory, 'carta.json');
      if (!existsSync(cardPath)) return null;
      const stored = readJson<StoredCard>(cardPath);
      if (!stored?.id || !stored?.data?.cardType) throw new Error(`carta.json inválido: ${directoryName}/${entry.name}`);
      stored.collectionId = metadata.id;
      stored.data.artwork = resolveArtwork(stored, cardDirectory, baseUrl, directoryName, entry.name);
      return stored;
    })
    .filter((stored): stored is StoredCard => Boolean(stored))
    .filter((stored, index, all) => all.findIndex((candidate) => candidate.id === stored.id) === index)
    .sort((a, b) => a.data.cardNumber - b.data.cardNumber || a.id.localeCompare(b.id));

  const { formatVersion: _formatVersion, ...collection } = metadata;
  return { ...collection, cards };
}

export function loadPublishedCollections(contentDirectory: string, baseUrl: string): CardCollection[] {
  if (!existsSync(contentDirectory)) return [];
  return readdirSync(contentDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((directoryName) => loadCollection(contentDirectory, directoryName, baseUrl));
}
