const TCGDEX_API = 'https://api.tcgdex.net/v2/en';
const CACHE_PREFIX = 'card-forge:tcgdex-art:v1:';
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7;

interface TcgDexCardBrief {
  id: string;
  localId: string | number;
  name: string;
  image?: string;
}

interface TcgDexCard {
  id: string;
  localId: string | number;
  name: string;
  image?: string;
  category: string;
  rarity?: string;
  suffix?: string;
  stage?: string;
  evolveFrom?: string;
  set: { id: string; name: string; cardCount?: { official?: number; total?: number } };
}

export interface TcgArtworkCandidate {
  cardId: string;
  cardName: string;
  setName: string;
  localId: string;
  rarity: string;
  stage: string;
  imageBaseUrl: string;
  imageUrl: string;
  seriesId: string;
  score: number;
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

interface CacheEnvelope<T> { value: T; savedAt: number }
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

function seriesScore(seriesId: string) {
  return SERIES_SCORE[seriesId] ?? 0;
}

function cacheRead<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (Date.now() - parsed.savedAt > CACHE_TTL) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function cacheWrite<T>(key: string, value: T) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ value, savedAt: Date.now() }));
  } catch {
    // O cache é apenas uma otimização. Quota/privacidade nunca deve bloquear o editor.
  }
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`TCGdex respondeu ${response.status}.`);
  return response.json() as Promise<T>;
}

function hasSpecialNameOrSuffix(card: TcgDexCard) {
  const text = `${card.name} ${card.suffix || ''}`.toLowerCase();
  return /(?:^|[\s.-])(ex|gx|v|max|vmax|vstar|v-union|break|lv\.?x|mega|radiant|shining|star|δ|delta)(?:$|[\s.-])/i.test(text)
    || /(?:^|\s)m\s+[a-z]/i.test(card.name);
}

function hasSpecialRarity(rarity = '') {
  return /illustration|ultra|secret|hyper|rainbow|gold|shiny|shining|amazing|promo|double rare|special art|trainer gallery|radiant/i.test(rarity);
}

function looksLikeStandardPokemon(card: TcgDexCard, pokemonName: string) {
  if (card.category !== 'Pokemon' || !card.image) return false;
  if (normalize(card.name) !== normalize(pokemonName)) return false;
  if (hasSpecialNameOrSuffix(card) || hasSpecialRarity(card.rarity)) return false;
  const localNumber = Number(String(card.localId).match(/^\d+/)?.[0] || 0);
  const officialCount = Number(card.set?.cardCount?.official || 0);
  if (/^(tg|gg|sv|rc)/i.test(String(card.localId))) return false;
  if (localNumber && officialCount && localNumber > officialCount) return false;
  // "Common", "Uncommon", "Rare" e variações Holo são layouts normais. Alguns cards
  // antigos omitem a raridade na base, então ausência de raridade não é reprovação.
  const rarity = (card.rarity || '').toLowerCase();
  if (rarity && !/common|uncommon|rare|holo/.test(rarity)) return false;
  return true;
}

function candidateScore(card: TcgDexCard) {
  const seriesId = seriesFromImage(card.image);
  const rarity = (card.rarity || '').toLowerCase();
  let score = seriesScore(seriesId);
  if (rarity.includes('common')) score += 4;
  if (rarity.includes('uncommon')) score += 5;
  if (rarity.includes('rare')) score += 3;
  if (card.stage?.toLowerCase() === 'basic') score += 2;
  return score;
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return result;
}

export async function findNormalPokemonArtworkCandidates(pokemonName: string, signal?: AbortSignal): Promise<TcgArtworkCandidate[]> {
  const normalizedName = normalize(pokemonName);
  if (!normalizedName) return [];
  const cacheKey = `candidates:${normalizedName}`;
  const cached = cacheRead<TcgArtworkCandidate[]>(cacheKey);
  if (cached?.length) return cached;

  const searchUrl = `${TCGDEX_API}/cards?name=${encodeURIComponent(pokemonName)}`;
  const briefs = await fetchJson<TcgDexCardBrief[]>(searchUrl, signal);
  const exact = briefs
    .filter((item) => item.image && normalize(item.name) === normalizedName)
    .sort((a, b) => seriesScore(seriesFromImage(b.image)) - seriesScore(seriesFromImage(a.image)))
    .slice(0, 24);

  if (!exact.length) return [];

  const details = await mapLimit(exact, 6, async (item) => {
    try {
      return await fetchJson<TcgDexCard>(`${TCGDEX_API}/cards/${encodeURIComponent(item.id)}`, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      return null;
    }
  });

  const candidates = details
    .filter((item): item is TcgDexCard => Boolean(item && looksLikeStandardPokemon(item, pokemonName)))
    .map((item) => {
      const seriesId = seriesFromImage(item.image);
      return {
        cardId: item.id,
        cardName: item.name,
        setName: item.set?.name || item.set?.id || 'Coleção desconhecida',
        localId: String(item.localId),
        rarity: item.rarity || 'Raridade não informada',
        stage: item.stage || '',
        imageBaseUrl: item.image!,
        imageUrl: `${item.image}/high.png`,
        seriesId,
        score: candidateScore(item),
      } satisfies TcgArtworkCandidate;
    })
    .sort((a, b) => b.score - a.score || b.cardId.localeCompare(a.cardId))
    .slice(0, 8);

  if (candidates.length) cacheWrite(cacheKey, candidates);
  return candidates;
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

async function loadImageBitmap(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`A imagem da carta respondeu ${response.status}.`);
  const blob = await response.blob();
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error('O navegador não conseguiu decodificar a imagem da carta.');
  }
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

export async function extractArtworkFromCandidate(candidate: TcgArtworkCandidate, signal?: AbortSignal): Promise<TcgArtworkExtraction> {
  const bitmap = await loadImageBitmap(candidate.imageUrl, signal);
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

    if (candidate.stage && !/basic/i.test(candidate.stage)) {
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
