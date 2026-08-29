const TCGDEX_API = 'https://api.tcgdex.net/v2/en';
const POKEMON_TCG_API = 'https://api.pokemontcg.io/v2';
const MEMORY_CACHE = new Map<string, unknown>();
const SEARCH_TIMEOUT_MS = 5500;
const IMAGE_TIMEOUT_MS = 9000;

interface TcgDexCardBrief {
  id: string;
  localId: string | number;
  name: string;
  image?: string;
}

interface PokemonTcgCard {
  id: string;
  name: string;
  supertype?: string;
  subtypes?: string[];
  rarity?: string;
  number?: string;
  set?: {
    id?: string;
    name?: string;
    series?: string;
    printedTotal?: number;
    total?: number;
  };
  images?: { small?: string; large?: string };
}

interface PokemonTcgResponse {
  data?: PokemonTcgCard[];
}

export type TcgArtworkProvider = 'tcgdex' | 'pokemontcg';

export interface TcgArtworkCandidate {
  cardId: string;
  cardName: string;
  setName: string;
  localId: string;
  rarity: string;
  stage: string;
  imageBaseUrl: string;
  imageUrl: string;
  previewUrl: string;
  fallbackImageUrl?: string;
  seriesId: string;
  score: number;
  provider: TcgArtworkProvider;
}

export interface TcgArtworkExtraction {
  artwork: string;
  candidate: TcgArtworkCandidate;
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
    profile: string;
    evolvedSafetyApplied: boolean;
  };
}

export interface TcgArtworkSearchOptions {
  signal?: AbortSignal;
  force?: boolean;
  fallbackStage?: string;
}

interface Rect { x: number; y: number; width: number; height: number }
interface CropProfile {
  id: string;
  rect: Rect;
  // Em cartas evoluídas o selo "Evolves from" e a miniatura ficam por cima da arte.
  // Este valor define uma linha segura dentro da janela de arte para não importar esses elementos.
  evolvedSafeTop: number;
}

const PROFILES: Record<string, CropProfile> = {
  // Perfis são apenas o ponto de partida. As quatro bordas ainda são refinadas pela
  // leitura de contraste da própria carta antes do recorte final.
  sv: { id: 'scarlet-violet', rect: { x: .078, y: .095, width: .85, height: .385 }, evolvedSafeTop: .165 },
  swsh: { id: 'sword-shield', rect: { x: .078, y: .095, width: .85, height: .385 }, evolvedSafeTop: .165 },
  sm: { id: 'sun-moon', rect: { x: .08, y: .11, width: .84, height: .365 }, evolvedSafeTop: .18 },
  xy: { id: 'xy', rect: { x: .082, y: .12, width: .836, height: .355 }, evolvedSafeTop: .19 },
  bw: { id: 'black-white', rect: { x: .085, y: .13, width: .83, height: .345 }, evolvedSafeTop: .20 },
  hgss: { id: 'heartgold-soulsilver', rect: { x: .088, y: .145, width: .824, height: .33 }, evolvedSafeTop: .21 },
  pl: { id: 'platinum', rect: { x: .09, y: .15, width: .82, height: .325 }, evolvedSafeTop: .215 },
  dp: { id: 'diamond-pearl', rect: { x: .09, y: .15, width: .82, height: .325 }, evolvedSafeTop: .215 },
  ex: { id: 'ex-era', rect: { x: .095, y: .16, width: .81, height: .31 }, evolvedSafeTop: .225 },
  default: { id: 'generic-standard', rect: { x: .09, y: .14, width: .82, height: .335 }, evolvedSafeTop: .21 },
};

const SERIES_SCORE: Record<string, number> = {
  sv: 100,
  swsh: 90,
  sm: 80,
  xy: 70,
  bw: 60,
  hgss: 50,
  pl: 45,
  dp: 40,
  ex: 30,
  ecard: 20,
  neo: 15,
  gym: 12,
  base: 10,
};

const SAFE_RARITIES = new Set(['common', 'uncommon', 'rare', 'rare holo']);

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/♀/g, 'f')
    .replace(/♂/g, 'm')
    .replace(/[^a-z0-9]+/g, '');
}

function seriesFromImage(image = '') {
  const match = image.match(/assets\.tcgdex\.net\/[^/]+\/([^/]+)\//i);
  return match?.[1]?.toLowerCase() || '';
}

function seriesFromSetId(setId = '', series = '') {
  const id = setId.toLowerCase();
  const text = `${id} ${series}`.toLowerCase();
  if (/scarlet|violet|^sv/.test(text)) return 'sv';
  if (/sword|shield|^swsh/.test(text)) return 'swsh';
  if (/sun|moon|^sm/.test(text)) return 'sm';
  if (/^xy|\bxy\b/.test(text)) return 'xy';
  if (/black|white|^bw/.test(text)) return 'bw';
  if (/heartgold|soulsilver|^hgss/.test(text)) return 'hgss';
  if (/platinum|^pl/.test(text)) return 'pl';
  if (/diamond|pearl|^dp/.test(text)) return 'dp';
  if (/^ex/.test(text)) return 'ex';
  if (/neo/.test(text)) return 'neo';
  if (/gym/.test(text)) return 'gym';
  if (/base/.test(text)) return 'base';
  return '';
}

function seriesScore(seriesId: string) {
  return SERIES_SCORE[seriesId] ?? 0;
}

function cacheRead<T>(key: string): T | null {
  return MEMORY_CACHE.has(key) ? MEMORY_CACHE.get(key) as T : null;
}

function cacheWrite<T>(key: string, value: T) {
  MEMORY_CACHE.set(key, value);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function fetchJson<T>(url: string, signal?: AbortSignal, timeoutMs = SEARCH_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const relayAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', relayAbort, { once: true });
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'default',
      credentials: 'omit',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (timedOut) throw new Error('tempo limite da API');
    if (isAbortError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message === 'Failed to fetch' ? 'API indisponível ou bloqueada pela rede' : message);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', relayAbort);
  }
}

function isUnsafeLocalId(localId: string | number) {
  return /^(tg|gg|sv|rc|sh|xy|sm)/i.test(String(localId).trim());
}

function candidateScore(seriesId: string, rarity = '') {
  let score = seriesScore(seriesId);
  const safeRarity = rarity.toLowerCase();
  if (safeRarity === 'common') score += 4;
  if (safeRarity === 'uncommon') score += 5;
  if (safeRarity === 'rare') score += 3;
  if (safeRarity === 'rare holo') score += 2;
  return score;
}

function dedupeCandidates(items: TcgArtworkCandidate[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.provider}:${item.cardId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchTcgDex(pokemonName: string, fallbackStage: string, signal?: AbortSignal): Promise<TcgArtworkCandidate[]> {
  const params = new URLSearchParams();
  params.set('name', pokemonName);
  params.set('category', 'Pokemon');
  // Filtrar a raridade na própria API evita o antigo N+1 de até 24 requisições de detalhes.
  // Assim a busca normalmente vira UMA requisição e já exclui IR/UR/Secret/Full Art.
  params.set('rarity', 'eq:Common|Uncommon|Rare|Rare Holo');
  params.set('pagination:page', '1');
  params.set('pagination:itemsPerPage', '40');
  const briefs = await fetchJson<TcgDexCardBrief[]>(`${TCGDEX_API}/cards?${params.toString()}`, signal);
  const wanted = normalize(pokemonName);

  return briefs
    .filter((item) => item.image && normalize(item.name) === wanted && !isUnsafeLocalId(item.localId))
    .map((item) => {
      const seriesId = seriesFromImage(item.image);
      const setId = item.id.split('-')[0] || seriesId || 'TCG';
      return {
        cardId: item.id,
        cardName: item.name,
        setName: setId.toUpperCase(),
        localId: String(item.localId),
        rarity: 'Normal',
        stage: fallbackStage,
        imageBaseUrl: item.image!,
        imageUrl: `${item.image}/high.webp`,
        previewUrl: `${item.image}/low.webp`,
        fallbackImageUrl: `${item.image}/high.png`,
        seriesId,
        score: candidateScore(seriesId),
        provider: 'tcgdex' as const,
      };
    })
    .sort((a, b) => b.score - a.score || b.cardId.localeCompare(a.cardId))
    .slice(0, 12);
}

function hasSpecialPokemonTcgSubtype(card: PokemonTcgCard) {
  const subtypes = (card.subtypes || []).join(' ').toLowerCase();
  return /\b(ex|gx|v|max|vmax|vstar|v-union|break|mega|radiant|lv\.?x|tag team)\b/i.test(subtypes);
}

function pokemonTcgStage(card: PokemonTcgCard, fallbackStage: string) {
  const subtypes = card.subtypes || [];
  if (subtypes.some((value) => /^basic$/i.test(value))) return 'Basic';
  if (subtypes.some((value) => /^stage\s*1$/i.test(value))) return 'Stage1';
  if (subtypes.some((value) => /^stage\s*2$/i.test(value))) return 'Stage2';
  return fallbackStage;
}

async function searchPokemonTcg(pokemonName: string, fallbackStage: string, signal?: AbortSignal): Promise<TcgArtworkCandidate[]> {
  const escapedName = pokemonName.replace(/["\\]/g, (value) => `\\${value}`);
  const params = new URLSearchParams();
  params.set('q', `name:"${escapedName}"`);
  params.set('pageSize', '40');
  params.set('select', 'id,name,supertype,subtypes,rarity,number,set,images');
  const response = await fetchJson<PokemonTcgResponse>(`${POKEMON_TCG_API}/cards?${params.toString()}`, signal);
  const wanted = normalize(pokemonName);

  return (response.data || [])
    .filter((item) => {
      if (!item.images?.large || normalize(item.name) !== wanted) return false;
      if (item.supertype && !/pok[eé]mon/i.test(item.supertype)) return false;
      if (hasSpecialPokemonTcgSubtype(item)) return false;
      const rarity = (item.rarity || '').trim().toLowerCase();
      if (rarity && !SAFE_RARITIES.has(rarity)) return false;
      if (isUnsafeLocalId(item.number || '')) return false;
      const number = Number(String(item.number || '').match(/^\d+/)?.[0] || 0);
      const printedTotal = Number(item.set?.printedTotal || 0);
      if (number && printedTotal && number > printedTotal) return false;
      return true;
    })
    .map((item) => {
      const seriesId = seriesFromSetId(item.set?.id || '', item.set?.series || '');
      return {
        cardId: item.id,
        cardName: item.name,
        setName: item.set?.name || item.set?.id?.toUpperCase() || 'Pokémon TCG',
        localId: String(item.number || item.id),
        rarity: item.rarity || 'Normal',
        stage: pokemonTcgStage(item, fallbackStage),
        imageBaseUrl: item.images!.large!,
        imageUrl: item.images!.large!,
        previewUrl: item.images?.small || item.images!.large!,
        fallbackImageUrl: item.images?.small,
        seriesId,
        score: candidateScore(seriesId, item.rarity),
        provider: 'pokemontcg' as const,
      };
    })
    .sort((a, b) => b.score - a.score || b.cardId.localeCompare(a.cardId))
    .slice(0, 12);
}

export async function findNormalPokemonArtworkCandidates(
  pokemonName: string,
  options: TcgArtworkSearchOptions = {},
): Promise<TcgArtworkCandidate[]> {
  const normalizedName = normalize(pokemonName);
  if (!normalizedName) return [];
  const cacheKey = `candidates:${normalizedName}`;
  if (!options.force) {
    const cached = cacheRead<TcgArtworkCandidate[]>(cacheKey);
    if (cached?.length) return cached;
  }

  // As duas fontes são consultadas em paralelo. Se uma estiver fora do ar, a outra ainda
  // consegue abastecer as sugestões. Cada uma possui timeout curto para nunca travar o editor.
  const results = await Promise.allSettled([
    searchTcgDex(pokemonName, options.fallbackStage || '', options.signal),
    searchPokemonTcg(pokemonName, options.fallbackStage || '', options.signal),
  ]);

  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const candidates = dedupeCandidates(
    results.flatMap((result) => result.status === 'fulfilled' ? result.value : []),
  )
    .sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider))
    .slice(0, 14);

  if (candidates.length) {
    cacheWrite(cacheKey, candidates);
    return candidates;
  }

  // Só tratamos como erro de rede se AS DUAS fontes falharam. Se alguma respondeu vazia,
  // significa apenas que não há uma carta normal segura para esse Pokémon.
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length === results.length) {
    const details = failures
      .map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason))
      .filter(Boolean)
      .join(' / ');
    throw new Error(`Não foi possível consultar as fontes de cartas (${details || 'erro de rede'}).`);
  }
  return [];
}

function profileFor(candidate: TcgArtworkCandidate): CropProfile {
  return PROFILES[candidate.seriesId] ?? PROFILES.default!;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function pixelRect(rect: Rect, width: number, height: number): Rect {
  return {
    x: Math.round(rect.x * width),
    y: Math.round(rect.y * height),
    width: Math.round(rect.width * width),
    height: Math.round(rect.height * height),
  };
}

function edgeStrength(data: Uint8ClampedArray, width: number, x1: number, y1: number, x2: number, y2: number, vertical: boolean) {
  const samples = 48;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const x = Math.round(x1 + (x2 - x1) * t);
    const y = Math.round(y1 + (y2 - y1) * t);
    const ax = clamp(vertical ? x - 2 : x, 0, width - 1);
    const ay = Math.max(0, vertical ? y : y - 2);
    const bx = clamp(vertical ? x + 2 : x, 0, width - 1);
    const by = vertical ? y : y + 2;
    const ai = (ay * width + ax) * 4;
    const bi = (by * width + bx) * 4;
    const ar = data[ai] ?? 0, ag = data[ai + 1] ?? 0, ab = data[ai + 2] ?? 0;
    const br = data[bi] ?? 0, bg = data[bi + 1] ?? 0, bb = data[bi + 2] ?? 0;
    sum += Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
  }
  return sum / samples;
}

function refineBoundary(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  expected: number,
  min: number,
  max: number,
  spanStart: number,
  spanEnd: number,
  vertical: boolean,
) {
  let best = expected;
  let bestScore = -1;
  const from = Math.round(clamp(min, 2, vertical ? width - 3 : height - 3));
  const to = Math.round(clamp(max, 2, vertical ? width - 3 : height - 3));
  for (let pos = from; pos <= to; pos += 2) {
    const score = vertical
      ? edgeStrength(data, width, pos, spanStart, pos, spanEnd, true)
      : edgeStrength(data, width, spanStart, pos, spanEnd, pos, false);
    // Pequeno viés para o ponto esperado evita saltar para uma linha de texto forte próxima.
    const distancePenalty = Math.abs(pos - expected) * 0.55;
    const adjusted = score - distancePenalty;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      best = pos;
    }
  }
  return best;
}

function refineArtworkRect(imageData: ImageData, expected: Rect): Rect {
  const { width, height, data } = imageData;
  const x0 = expected.x;
  const x1 = expected.x + expected.width;
  const y0 = expected.y;
  const y1 = expected.y + expected.height;

  // Na busca horizontal ignoramos o topo, exatamente onde a miniatura da pré-evolução aparece.
  const verticalSpanStart = Math.round(y0 + expected.height * .28);
  const verticalSpanEnd = Math.round(y0 + expected.height * .82);
  // Na busca do topo/fundo ignoramos 22% do lado esquerdo, onde o selo de evolução invade a arte.
  const horizontalSpanStart = Math.round(x0 + expected.width * .22);
  const horizontalSpanEnd = Math.round(x0 + expected.width * .86);

  const left = refineBoundary(data, width, height, x0, x0 - width * .025, x0 + width * .025, verticalSpanStart, verticalSpanEnd, true);
  const right = refineBoundary(data, width, height, x1, x1 - width * .025, x1 + width * .025, verticalSpanStart, verticalSpanEnd, true);
  const top = refineBoundary(data, width, height, y0, y0 - height * .035, y0 + height * .045, horizontalSpanStart, horizontalSpanEnd, false);
  const bottom = refineBoundary(data, width, height, y1, y1 - height * .04, y1 + height * .035, horizontalSpanStart, horizontalSpanEnd, false);

  const insetX = Math.max(3, Math.round(width * .006));
  const insetY = Math.max(3, Math.round(height * .005));
  return {
    x: clamp(left + insetX, 0, width - 2),
    y: clamp(top + insetY, 0, height - 2),
    width: Math.max(24, right - left - insetX * 2),
    height: Math.max(24, bottom - top - insetY * 2),
  };
}

async function loadImageElement(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      image.onload = null;
      image.onerror = null;
      callback();
    };
    const onAbort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')));
    const timer = window.setTimeout(() => finish(() => reject(new Error('A imagem da carta demorou demais para carregar.'))), IMAGE_TIMEOUT_MS);

    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => finish(() => resolve(image));
    image.onerror = () => finish(() => reject(new Error('A CDN da carta não liberou a imagem para recorte.')));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    image.src = url;
  });
}

async function loadImageBitmap(candidate: TcgArtworkCandidate, signal?: AbortSignal): Promise<ImageBitmap> {
  const urls = [candidate.imageUrl, candidate.fallbackImageUrl]
    .filter((url): url is string => Boolean(url))
    .filter((url, index, list) => list.indexOf(url) === index);
  let lastError: unknown = null;

  // Usar <img crossorigin> em vez de fetch(blob) evita o "Failed to fetch" que alguns
  // navegadores/hosts apresentam mesmo quando a CDN consegue exibir a imagem normalmente.
  for (const url of urls) {
    try {
      const image = await loadImageElement(url, signal);
      return await createImageBitmap(image);
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Não foi possível carregar a imagem da carta para recorte.');
}

function exportCrop(bitmap: ImageBitmap, rect: Rect) {
  const maxWidth = 1100;
  const scale = Math.min(2, maxWidth / Math.max(1, rect.width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas indisponível para recortar a arte.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL('image/webp', .94);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

function isBasicStage(stage = '') {
  const value = normalize(stage);
  return value === 'basic' || value === 'basico';
}

export async function extractArtworkFromCandidate(candidate: TcgArtworkCandidate, signal?: AbortSignal): Promise<TcgArtworkExtraction> {
  const bitmap = await loadImageBitmap(candidate, signal);
  try {
    const analysisCanvas = document.createElement('canvas');
    analysisCanvas.width = bitmap.width;
    analysisCanvas.height = bitmap.height;
    const context = analysisCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas indisponível para analisar a carta.');
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);

    const profile = profileFor(candidate);
    const expected = pixelRect(profile.rect, bitmap.width, bitmap.height);
    let rect = refineArtworkRect(imageData, expected);
    let evolvedSafetyApplied = false;

    if (candidate.stage && !isBasicStage(candidate.stage)) {
      const safeTop = Math.round(profile.evolvedSafeTop * bitmap.height);
      if (safeTop > rect.y && safeTop < rect.y + rect.height * .62) {
        const originalBottom = rect.y + rect.height;
        rect.y = safeTop;
        rect.height = Math.max(24, originalBottom - safeTop);
        evolvedSafetyApplied = true;
      }
      // A miniatura da pré-evolução vive no canto superior esquerdo. Um inset adicional mínimo
      // protege layouts em que ela ultrapassa alguns pixels a janela da ilustração.
      const extraLeft = Math.round(bitmap.width * .008);
      rect.x += extraLeft;
      rect.width = Math.max(24, rect.width - extraLeft);
    }

    // Impede que uma detecção ruim atravesse as zonas de nome/ataque da carta.
    rect.x = clamp(rect.x, Math.round(bitmap.width * .045), Math.round(bitmap.width * .22));
    rect.y = clamp(rect.y, Math.round(bitmap.height * .075), Math.round(bitmap.height * .31));
    const maxRight = Math.round(bitmap.width * .955);
    const maxBottom = Math.round(bitmap.height * .60);
    rect.width = clamp(rect.width, Math.round(bitmap.width * .62), maxRight - rect.x);
    rect.height = clamp(rect.height, Math.round(bitmap.height * .19), maxBottom - rect.y);

    return {
      artwork: exportCrop(bitmap, rect),
      candidate,
      crop: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        profile: profile.id,
        evolvedSafetyApplied,
      },
    };
  } finally {
    bitmap.close();
  }
}
