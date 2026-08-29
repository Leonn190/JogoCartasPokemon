import { ATTACK_KIND_META, CARD_CATEGORY_META } from '../data/cardCategories';
import { DEFAULT_ATTACK_CARD, DEFAULT_POKEMON_CARD, createChampionCard, createClimateCard, createEmptyCard, createUtilityCard } from '../data/defaultCard';
import { exportCardAsPng } from '../lib/exportCard';
import { exportWorkspaceZip, importWorkspaceZip } from '../lib/contentZip';
import { cardDisplayName, createCollection, createEmptyWorkspace, deleteCard, isFullArtCard, prepareCardForCollection, renumberCollection, upsertCard } from '../lib/collections';
import { loadWorkspaceLocal, saveWorkspaceLocal, touchWorkspace } from '../lib/workspaceStorage';
import { COLLECTION_CATEGORY_ORDER, categoryCount, categoryFull, categoryLimit, collectionTotal } from '../data/gameConfig';
import { getPokemonIndex, loadAbilityDescription, loadPokemonEditorData, loadPokemonSummary } from '../lib/pokeapi';
import { extractArtworkFromCandidate, findNormalPokemonArtworkCandidates } from '../lib/tcgArtwork';
import type { TcgArtworkCandidate } from '../lib/tcgArtwork';
import { TYPE_META, titleCasePokemon } from '../lib/pokemonMapping';
import { clearDraft, loadDraft } from '../lib/storage';
import { CARD_FORMS, CARD_TYPE_LABELS, GAME_TYPES, POKEMON_RARITY_LABELS } from '../types/card';
import type {
  AttackCardData,
  AttackKind,
  CardData,
  CardType,
  ChampionCardData,
  ClimateCardData,
  CardCollection,
  EditorReferenceData,
  GameType,
  PokemonCardData,
  PokemonForm,
  PokemonRarity,
  TrainerCardType,
  UtilityCardData,
  WorkspaceState,
  CollectionSize,
} from '../types/card';

const q = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector);
const qa = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(selector));

function cloneCard<T extends CardData>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

let card: CardData = cloneCard(DEFAULT_POKEMON_CARD);
let cardCache: Partial<Record<CardType, CardData>> = {};
let reference: EditorReferenceData = { officialStats: null, abilities: [] };
let naturalStage = DEFAULT_POKEMON_CARD.stage;
let pokemonIndex: Array<{ name: string; id: number }> | null = null;
let pokemonSearchAbort: AbortController | null = null;
let attackPokemonAbort: AbortController | null = null;
let abilityAbort: AbortController | null = null;
let tcgArtworkSearchAbort: AbortController | null = null;
let tcgArtworkCropAbort: AbortController | null = null;
let tcgArtworkCandidates: TcgArtworkCandidate[] = [];
let tcgArtworkLoading = false;
let tcgArtworkStatusOverride = '';
let saveTimer = 0;
let pokemonSearchTimer = 0;
let attackSearchTimer = 0;
let pokemonSuggestionCursor = -1;
let attackSuggestionCursor = -1;
let dirty = false;
let workspace: WorkspaceState = createEmptyWorkspace();
let activeCollectionId: string | null = null;
let activeCardId: string | null = null;
let pendingDeleteCardId: string | null = null;
let activeZoomCardId: string | null = null;

const scaleBox = q<HTMLElement>('.card-scale-box')!;
const previewStage = q<HTMLElement>('.preview-stage')!;
const autosaveStatus = q<HTMLElement>('[data-role="autosave-status"]');
const fileInput = q<HTMLInputElement>('[data-role="artwork-file"]')!;
const dropzone = q<HTMLElement>('[data-role="dropzone"]')!;
const dialog = q<HTMLDialogElement>('[data-role="new-card-dialog"]');
const cardFamilySelector = q<HTMLSelectElement>('[data-role="card-family-selector"]')!;
const pokemonSubtypeSelector = q<HTMLSelectElement>('[data-role="pokemon-subtype-selector"]')!;
const trainerSubtypeSelector = q<HTMLSelectElement>('[data-role="trainer-subtype-selector"]')!;
const attackSubtypeSelector = q<HTMLSelectElement>('[data-role="attack-subtype-selector"]')!;
const baseUrl = document.documentElement.dataset.baseUrl || '/';

const pokemonSearchInput = q<HTMLInputElement>('[data-role="pokemon-search"]')!;
const pokemonSuggestions = q<HTMLElement>('[data-role="pokemon-suggestions"]')!;
const pokemonSearchControl = q<HTMLElement>('[data-role="search-control"]')!;
const apiStatus = q<HTMLElement>('[data-role="api-status"]')!;

const attackSearchInput = q<HTMLInputElement>('[data-role="attack-pokemon-search"]')!;
const attackSuggestions = q<HTMLElement>('[data-role="attack-pokemon-suggestions"]')!;
const attackSearchControl = q<HTMLElement>('[data-role="attack-search-control"]')!;
const attackApiStatus = q<HTMLElement>('[data-role="attack-api-status"]')!;
const tcgArtworkStatus = q<HTMLElement>('[data-role="tcg-art-status"]');
const tcgArtworkSuggestions = q<HTMLElement>('[data-role="tcg-art-suggestions"]');
const tcgArtworkSuggestionCount = q<HTMLElement>('[data-role="tcg-art-count"]');
const tcgArtworkSuggestionDetails = q<HTMLDetailsElement>('[data-role="tcg-art-suggestions-details"]');
const tcgArtworkRefreshButton = q<HTMLButtonElement>('[data-action="refresh-tcg-art"]');

function isPokemon(value: CardData = card): value is PokemonCardData { return value.cardType === 'pokemon'; }
function isAttack(value: CardData = card): value is AttackCardData { return value.cardType === 'attack'; }
function isChampion(value: CardData = card): value is ChampionCardData { return value.cardType === 'champion'; }
function isClimate(value: CardData = card): value is ClimateCardData { return value.cardType === 'climate'; }
function isUtility(value: CardData = card): value is UtilityCardData { return !isPokemon(value) && !isAttack(value) && !isClimate(value) && !isChampion(value); }

function slotForCard(value: CardData = card) {
  if (value.cardType === 'pokemon') return 'pokemon';
  if (value.cardType === 'attack') return 'attack';
  if (value.cardType === 'climate') return 'climate';
  if (value.cardType === 'champion') return 'champion';
  return 'utility';
}

type CardFamily = 'pokemon' | 'trainer' | 'attack' | 'climate';

function familyForCard(value: CardData = card): CardFamily {
  if (value.cardType === 'pokemon') return 'pokemon';
  if (value.cardType === 'attack') return 'attack';
  if (value.cardType === 'climate') return 'climate';
  return 'trainer';
}

function iconUrl(relativePath: string) {
  return `${baseUrl.replace(/\/$/, '')}/${relativePath.replace(/^\//, '')}`;
}

function setTypeIcon(root: ParentNode, role: string, relativePath: string) {
  const image = q<HTMLImageElement>(`[data-role="${role}"]`, root);
  if (!image) return;

  const stem = relativePath.replace(/\.[a-z0-9]+$/i, '');
  const candidates = [relativePath, `${stem}.webp`, `${stem}.svg`, `${stem}.jpg`]
    .filter((value, index, list) => list.indexOf(value) === index);
  let cursor = 0;

  const loadNext = () => {
    if (cursor >= candidates.length) {
      image.style.display = 'none';
      image.onerror = null;
      return;
    }
    image.style.display = '';
    image.src = iconUrl(candidates[cursor++]!);
  };

  image.onerror = loadNext;
  loadNext();
}

function syncTypeSelectorUI() {
  const family = familyForCard();
  cardFamilySelector.value = family;
  qa<HTMLElement>('[data-subtype-family]').forEach((node) => {
    node.hidden = node.dataset.subtypeFamily !== family;
  });

  if (isPokemon(card)) pokemonSubtypeSelector.value = card.form;
  else if (isAttack(card)) attackSubtypeSelector.value = card.attackKind;
  else trainerSubtypeSelector.value = card.cardType;
}

function getActiveCardNode(): HTMLElement {
  return q<HTMLElement>(`[data-card-slot="${slotForCard()}"] [data-role="card-template"]`)!;
}

function escapeHtml(value: string) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function currentEditorMode(): 'essential' | 'advanced' {
  return q<HTMLElement>('.editor-panel')?.dataset.editorMode === 'advanced' ? 'advanced' : 'essential';
}

function isAdvancedMode() {
  return currentEditorMode() === 'advanced';
}

function toast(message: string, kind: 'success' | 'error' | 'neutral' = 'neutral') {
  const region = q<HTMLElement>('[data-role="toast-region"]');
  if (!region) return;
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  item.textContent = message;
  region.appendChild(item);
  window.setTimeout(() => item.remove(), 3300);
}

function currentCollection(): CardCollection | null {
  return activeCollectionId ? workspace.collections.find((item) => item.id === activeCollectionId) ?? null : null;
}

function setAppView(view: 'hub' | 'collection' | 'editor') {
  qa<HTMLElement>('[data-view]').forEach((node) => { node.hidden = node.dataset.view !== view; });
  const groups = ['hub', 'collection', 'editor'] as const;
  groups.forEach((group) => {
    const node = q<HTMLElement>(`[data-role="${group}-actions"]`);
    if (node) node.hidden = group !== view;
  });
  if (view === 'editor') requestAnimationFrame(fitPreview);
}

function collectionProgress(collection: CardCollection) {
  const total = collectionTotal(collection.size);
  const created = collection.cards.filter((entry) => !isFullArtCard(entry.data)).length;
  const extras = collection.cards.filter((entry) => isFullArtCard(entry.data)).length;
  return { created, extras, total, percent: Math.min(100, Math.round((created / total) * 100)) };
}


function normalizePokemonVersionKey(value: PokemonCardData) {
  if (value.pokemonId) return `id:${value.pokemonId}`;
  return `name:${value.pokemonName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

function pokemonVersionLabel(value: CardData, cardId?: string | null) {
  if (value.cardType !== 'pokemon' || value.form !== 'Normal') return '';
  const key = normalizePokemonVersionKey(value);
  const versions = workspace.collections.flatMap((collection) => collection.cards.map((entry) => {
    const data = entry.id === activeCardId && isPokemon(card) ? card : entry.data;
    return { id: entry.id, data, createdAt: entry.createdAt, collectionCreatedAt: collection.createdAt };
  })).filter((entry) => entry.data.cardType === 'pokemon'
    && entry.data.form === 'Normal'
    && normalizePokemonVersionKey(entry.data) === key)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)
      || a.collectionCreatedAt.localeCompare(b.collectionCreatedAt)
      || a.id.localeCompare(b.id));

  const targetId = cardId || activeCardId;
  const index = targetId ? versions.findIndex((entry) => entry.id === targetId) : -1;
  if (index >= 0) return `V${index + 1}`;
  return `V${Math.max(1, versions.length + 1)}`;
}

function pokemonSelfImage(value: PokemonCardData) {
  if (!value.pokemonId) return value.previousEvolutionImage || '';
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${value.pokemonId}.png`;
}

function cardProblems(value: CardData) {
  const problems: string[] = [];
  const hasText = (text: unknown) => String(text ?? '').trim().length > 0;

  if (!value.artwork) problems.push('Sem imagem definida.');
  if (value.expandedArtwork && !value.artwork) problems.push('Full Art sem imagem.');

  if (value.cardType === 'pokemon') {
    if (!hasText(value.pokemonName) || value.pokemonName === 'Novo Pokémon') problems.push('Pokémon sem nome final.');
    if (value.typeCandidates?.length && !value.typeCandidates.includes(value.type)) {
      problems.push(`Tipo ${value.type} não corresponde às sugestões da PokéAPI (${value.typeCandidates.join(' / ')}).`);
    }
    if (value.form !== 'Normal' && value.stage !== 'FINAL') {
      problems.push(`${value.form} normalmente deve usar estágio FINAL.`);
    }
    if (value.hp > 300) problems.push('HP acima do limite padrão de 300.');
    if ([value.hp, value.attack, value.defense, value.specialAttack, value.specialDefense, value.speed].some((stat) => stat % 10 !== 0)) {
      problems.push('Há status fora da escala padrão de 10 em 10.');
    }
    if (value.form === 'Normal' && (value.rarity === 'ultraRare' || value.rarity === 'illustrationRareUltra')) {
      problems.push('Raridade típica de forma final aplicada a um Pokémon Normal.');
    }
    if (value.form !== 'Normal' && ['common', 'uncommon', 'rare', 'illustrationRare'].includes(value.rarity)) {
      problems.push(`Raridade ${POKEMON_RARITY_LABELS[value.rarity]} não é a convenção desta forma final.`);
    }
  } else if (value.cardType === 'attack') {
    if (!hasText(value.attackName)) problems.push('Ataque sem nome.');
    if (!Number.isFinite(value.power) || value.power < 0) problems.push('Potência inválida.');
    else if (![0, 50, 100, 150, 200].includes(value.power)) problems.push('Potência fora dos valores padrão (0 / 50 / 100 / 150 / 200).');
    if (value.compatibilityMode === 'specific' && value.compatiblePokemon.length > 10) problems.push('Mais de 10 Pokémon compatíveis.');
  } else if (value.cardType === 'champion') {
    if (!hasText(value.name)) problems.push('Campeão sem nome.');
    if (!hasText(value.passiveName) || !hasText(value.passiveDescription)) problems.push('Passiva incompleta.');
    if ([value.initialPokemonCount, value.initialAttackCount, value.initialTrainerCount].some((item) => item < 0)) problems.push('Configuração inicial inválida.');
    if ([value.initialPokemonCount, value.initialAttackCount, value.initialTrainerCount].some((item) => item > 12)) problems.push('Configuração inicial acima do limite padrão de 12.');
  } else if (value.cardType === 'climate') {
    if (!hasText(value.name) || !hasText(value.effectText)) problems.push('Clima incompleto.');
  } else {
    if (!hasText(value.name) || !hasText(value.effectText)) problems.push(`${CARD_TYPE_LABELS[value.cardType]} incompleto.`);
  }

  return [...new Set(problems)];
}

function problemBadgeMarkup(value: CardData) {
  const problems = cardProblems(value);
  if (!problems.length) return '';
  const title = escapeHtml(problems.join(' • '));
  return `<span class="card-problem-badge" title="${title}" aria-label="${problems.length} problema(s) nesta carta">!</span>`;
}

function bindTiltEffects(root: ParentNode = document) {
  qa<HTMLElement>('[data-tilt-card]', root).forEach((face) => {
    if (face.dataset.tiltBound === 'true') return;
    face.dataset.tiltBound = 'true';
    face.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      const rect = face.getBoundingClientRect();
      const px = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const py = clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      const rotateY = (px - .5) * 11;
      const rotateX = (.5 - py) * 11;
      face.style.setProperty('--gallery-rx', `${rotateX.toFixed(2)}deg`);
      face.style.setProperty('--gallery-ry', `${rotateY.toFixed(2)}deg`);
      face.style.setProperty('--gallery-mx', `${(px * 100).toFixed(1)}%`);
      face.style.setProperty('--gallery-my', `${(py * 100).toFixed(1)}%`);
      face.classList.add('is-tilting');
    });
    face.addEventListener('pointerleave', () => {
      face.style.setProperty('--gallery-rx', '0deg');
      face.style.setProperty('--gallery-ry', '0deg');
      face.style.setProperty('--gallery-mx', '50%');
      face.style.setProperty('--gallery-my', '50%');
      face.classList.remove('is-tilting');
    });
  });
}

function renderedCardCloneHtml(value: CardData, variant: 'collection' | 'zoom') {
  const clone = getActiveCardNode().cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  qa<HTMLElement>('[id]', clone).forEach((node) => node.removeAttribute('id'));
  qa<HTMLImageElement>('img', clone).forEach((image) => {
    image.loading = 'lazy';
    image.decoding = 'async';
  });
  clone.setAttribute('aria-label', `${variant === 'zoom' ? 'Visualização ampliada' : 'Carta'} de ${cardDisplayName(value)}`);
  return clone.outerHTML;
}

function exactCardTemplateMarkup(value: CardData, cardId: string, variant: 'collection' | 'zoom') {
  const previousCard = cloneCard(card);
  const previousCardId = activeCardId;
  const previousNaturalStage = naturalStage;
  try {
    card = mergeDraft(value);
    activeCardId = cardId;
    if (isPokemon(card)) naturalStage = card.form === 'Normal' ? card.stage : naturalStage;
    renderCard();

    const cloneHtml = renderedCardCloneHtml(value, variant);
    const wrapper = variant === 'zoom' ? 'card-zoom-exact-card' : 'card-library-exact-card';
    return `<div class="${wrapper}" data-tilt-card>${cloneHtml}<i class="gallery-card-glare" aria-hidden="true"></i></div>`;
  } finally {
    card = previousCard;
    activeCardId = previousCardId;
    naturalStage = previousNaturalStage;
    renderCard();
  }
}

function exactCardZoomMarkup(value: CardData, cardId: string) {
  return exactCardTemplateMarkup(value, cardId, 'zoom');
}

function exactCollectionArticlesMarkup(entries: CardCollection['cards']) {
  const previousCard = cloneCard(card);
  const previousCardId = activeCardId;
  const previousNaturalStage = naturalStage;

  try {
    return entries.map((entry) => {
      card = mergeDraft(entry.data);
      activeCardId = entry.id;
      if (isPokemon(card)) naturalStage = card.form === 'Normal' ? card.stage : naturalStage;
      renderCard();

      const problems = cardProblems(entry.data);
      const issueClass = problems.length ? ' has-problem' : '';
      const exact = `<div class="card-library-exact-card" data-tilt-card>${renderedCardCloneHtml(entry.data, 'collection')}<i class="gallery-card-glare" aria-hidden="true"></i></div>`;
      return `<article class="card-library-item${issueClass}">
        <button class="card-library-preview" type="button" data-zoom-card="${escapeHtml(entry.id)}" aria-label="Ampliar ${escapeHtml(cardDisplayName(entry.data))}">
          ${exact}
        </button>
        ${problemBadgeMarkup(entry.data)}
        <button class="card-delete" type="button" data-delete-card="${escapeHtml(entry.id)}" title="Excluir carta">×</button>
      </article>`;
    }).join('');
  } finally {
    card = previousCard;
    activeCardId = previousCardId;
    naturalStage = previousNaturalStage;
    renderCard();
  }
}

function openCardZoom(cardId: string) {
  const collection = currentCollection();
  const stored = collection?.cards.find((entry) => entry.id === cardId);
  const zoomDialog = q<HTMLDialogElement>('[data-role="card-zoom-dialog"]');
  const stage = q<HTMLElement>('[data-role="card-zoom-stage"]');
  const title = q<HTMLElement>('[data-role="card-zoom-title"]');
  if (!stored || !zoomDialog || !stage) return;
  activeZoomCardId = cardId;
  stage.innerHTML = exactCardZoomMarkup(stored.data, stored.id);
  if (title) title.textContent = cardDisplayName(stored.data);
  bindTiltEffects(stage);
  zoomDialog.showModal();
}

function closeCardZoom() {
  activeZoomCardId = null;
  q<HTMLDialogElement>('[data-role="card-zoom-dialog"]')?.close();
}

function setEditorMode(mode: 'essential' | 'advanced') {
  const panel = q<HTMLElement>('.editor-panel');
  if (panel) panel.dataset.editorMode = mode;
  qa<HTMLButtonElement>('[data-editor-mode-tab]').forEach((button) => {
    const active = button.dataset.editorModeTab === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });

  if (mode === 'essential') {
    qa<HTMLDetailsElement>('.essential-section').forEach((section) => { section.open = true; });
  }

  qa<HTMLInputElement>('[data-stat-scale]').forEach((input) => {
    const essentialMax = input.dataset.essentialMax;
    if (mode === 'essential' && essentialMax) input.max = essentialMax;
    else input.removeAttribute('max');
  });

  const fullArtControl = q<HTMLElement>('[data-full-art-control]');
  if (fullArtControl) fullArtControl.hidden = mode === 'essential' && !isPokemon(card);

  if (isPokemon(card)) updatePokemonTypeChoices(card.typeCandidates ?? []);
}
function renderHub() {
  const grid = q<HTMLElement>('[data-role="collections-grid"]');
  const empty = q<HTMLElement>('[data-role="empty-hub"]');
  if (!grid || !empty) return;
  empty.hidden = workspace.collections.length > 0;
  grid.hidden = workspace.collections.length === 0;
  grid.innerHTML = workspace.collections.map((collection) => {
    const progress = collectionProgress(collection);
    return `<article class="collection-tile" data-open-collection="${escapeHtml(collection.id)}" tabindex="0">
      <div class="collection-tile-head"><span class="collection-tile-code">${escapeHtml(collection.code)}</span><span class="collection-size-pill">${collection.size === 'large' ? 'Grande' : 'Normal'}</span></div>
      <h3>${escapeHtml(collection.name)}</h3>
      <div class="collection-tile-progress"><span>${progress.created} / ${progress.total} cartas${progress.extras ? ` · +${progress.extras} Full Art` : ''}</span><strong>${progress.percent}%</strong></div>
      <div class="mini-progress"><i style="width:${progress.percent}%"></i></div>
    </article>`;
  }).join('');
}

function renderCapacity(collection: CardCollection) {
  const grid = q<HTMLElement>('[data-role="capacity-grid"]');
  if (!grid) return;
  grid.innerHTML = COLLECTION_CATEGORY_ORDER.map((type) => {
    const count = categoryCount(collection, type);
    const limit = categoryLimit(collection.size, type);
    return `<div class="capacity-chip${count >= limit ? ' is-full' : ''}"><span>${escapeHtml(CARD_TYPE_LABELS[type])}</span><strong>${count} / ${limit}</strong></div>`;
  }).join('');
}

function ensureFilterOptions() {
  const filter = q<HTMLSelectElement>('[data-role="category-filter"]');
  if (!filter || filter.options.length > 1) return;
  COLLECTION_CATEGORY_ORDER.forEach((type) => filter.add(new Option(CARD_TYPE_LABELS[type], type)));
}

function renderCollectionCards(collection: CardCollection) {
  ensureFilterOptions();
  const grid = q<HTMLElement>('[data-role="collection-card-grid"]');
  const empty = q<HTMLElement>('[data-role="empty-collection"]');
  const filter = q<HTMLSelectElement>('[data-role="category-filter"]')?.value ?? 'all';
  if (!grid || !empty) return;

  const cards = collection.cards.filter((entry) => filter === 'all' || entry.data.cardType === filter);
  empty.hidden = cards.length > 0;
  grid.hidden = cards.length === 0;

  grid.innerHTML = exactCollectionArticlesMarkup(cards);

  bindTiltEffects(grid);
}
function renderCollectionView() {
  const collection = currentCollection();
  if (!collection) return showHub();
  renumberCollection(collection);
  const progress = collectionProgress(collection);
  const name = q<HTMLElement>('[data-role="collection-name"]');
  const code = q<HTMLElement>('[data-role="collection-code"]');
  const sizeSelect = q<HTMLSelectElement>('[data-role="collection-size-select"]');
  const label = q<HTMLElement>('[data-role="collection-progress"]');
  const percent = q<HTMLElement>('[data-role="collection-percent"]');
  const bar = q<HTMLElement>('[data-role="collection-progress-bar"]');
  if (name) name.textContent = collection.name;
  if (code) code.textContent = collection.code;
  if (sizeSelect) { sizeSelect.value = collection.size; sizeSelect.disabled = collection.cards.length > 0; sizeSelect.title = collection.cards.length ? 'O tamanho fica bloqueado depois que a coleção possui cartas.' : 'Coleções vazias podem trocar de tamanho.'; }
  if (label) label.textContent = `${progress.created} / ${progress.total} cartas${progress.extras ? ` · +${progress.extras} Full Art` : ''}`;
  if (percent) percent.textContent = `${progress.percent}%`;
  if (bar) bar.style.width = `${progress.percent}%`;
  renderCapacity(collection);
  renderCollectionCards(collection);
  renderNewCardChoices(collection);
}

function showHub() {
  activeCollectionId = null;
  activeCardId = null;
  renderHub();
  setAppView('hub');
}

function openCollection(collectionId: string) {
  if (!workspace.collections.some((item) => item.id === collectionId)) return;
  activeCollectionId = collectionId;
  activeCardId = null;
  renderCollectionView();
  setAppView('collection');
}

function renderNewCardChoices(collection: CardCollection) {
  const grid = q<HTMLElement>('[data-role="new-card-category-grid"]');
  if (!grid) return;
  grid.innerHTML = COLLECTION_CATEGORY_ORDER.map((type) => {
    const count = categoryCount(collection, type);
    const limit = categoryLimit(collection.size, type);
    const full = count >= limit;
    return `<button class="new-card-category" type="button" data-create-card-type="${type}" ${full ? 'disabled' : ''}><strong>${escapeHtml(CARD_TYPE_LABELS[type])}</strong><small>${count} / ${limit}${full ? ' · cheio' : ''}</small></button>`;
  }).join('');
}

function syncDerivedCollectionFields() {
  const collection = currentCollection();
  if (!collection) return;
  setInputValue('cardNumber', card.cardNumber);
  setInputValue('setCode', card.setCode);
  qa<HTMLInputElement>('[data-role="derived-set-total"]').forEach((input) => { input.value = String(card.setTotal); });
  const context = q<HTMLElement>('[data-role="editor-collection-context"]');
  const number = q<HTMLElement>('[data-role="editor-card-number"]');
  if (context) context.textContent = `${collection.name} · ${collection.code}`;
  if (number) number.textContent = `${String(card.cardNumber).padStart(3, '0')}/${card.setTotal}`;
}

function openStoredCard(cardId: string) {
  const collection = currentCollection();
  const stored = collection?.cards.find((entry) => entry.id === cardId);
  if (!collection || !stored) return;
  activeCardId = stored.id;
  cardCache = {};
  resetTcgArtworkCandidates();
  reference = { officialStats: null, abilities: [] };
  setReferenceStats();
  setAbilitySuggestions();
  applyState(mergeDraft(stored.data));
  pokemonSearchInput.value = stored.data.cardType === 'pokemon' ? stored.data.pokemonName : '';
  attackSearchInput.value = '';
  cardFamilySelector.disabled = true;
  trainerSubtypeSelector.disabled = false;
  syncDerivedCollectionFields();
  setAppView('editor');
  if (card.cardType === 'pokemon' && card.form === 'Normal' && card.pokemonName && card.pokemonName !== 'Novo Pokémon') void preloadTcgArtworkSuggestions(card.pokemonName);
}

async function createAndOpenCard(type: CardType) {
  const collection = currentCollection();
  if (!collection) return;
  if (categoryFull(collection, type)) {
    toast(`${CARD_TYPE_LABELS[type]} já atingiu o limite desta coleção.`, 'error');
    return;
  }
  const next = createEmptyCard(type);
  prepareCardForCollection(next, collection, null);
  const stored = upsertCard(collection, next);
  activeCardId = stored.id;
  touchWorkspace(workspace);
  await saveWorkspaceLocal(workspace);
  cardCache = {};
  reference = { officialStats: null, abilities: [] };
  resetTcgArtworkCandidates();
  applyState(stored.data);
  cardFamilySelector.disabled = true;
  trainerSubtypeSelector.disabled = false;
  syncDerivedCollectionFields();
  setAppView('editor');
  dialog?.close();
}

async function persistActiveCard(showFeedback = false) {
  const collection = currentCollection();
  if (!collection || !activeCardId) return;
  try {
    const stored = upsertCard(collection, card, activeCardId);
    card = cloneCard(stored.data);
    touchWorkspace(workspace);
    await saveWorkspaceLocal(workspace);
    dirty = false;
    syncDerivedCollectionFields();
    renderCard();
    if (showFeedback) toast('Carta salva na coleção.', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível salvar a carta.';
    toast(message, 'error');
    throw error;
  }
}

async function exportContentZip() {
  try {
    const { bytes, exportedAt } = exportWorkspaceZip(workspace);
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'conteudo.zip';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    workspace.snapshotExportedAt = exportedAt;
    await saveWorkspaceLocal(workspace);
    toast('Conteúdo exportado. Substitua public/conteudo.zip por este arquivo e publique o projeto para atualizar a versão online.', 'success');
  } catch (error) {
    console.error(error);
    toast('Não foi possível gerar conteudo.zip.', 'error');
  }
}

async function loadPublishedWorkspace() {
  const status = q<HTMLElement>('[data-role="snapshot-status"]');
  const path = `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}conteudo.zip`;
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (response.status === 404) {
      if (status) status.textContent = 'Sem conteudo.zip publicado · usando área de trabalho local';
      return null;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const imported = await importWorkspaceZip(new Uint8Array(await response.arrayBuffer()));
    if (status) status.textContent = `conteudo.zip carregado · ${imported.workspace.collections.length} coleção(ões)`;
    return imported;
  } catch (error) {
    console.warn('Falha ao carregar conteudo.zip', error);
    if (status) status.textContent = 'conteudo.zip inválido ou indisponível · área local preservada';
    return null;
  }
}

async function bootstrapWorkspace() {
  const [local, published] = await Promise.all([loadWorkspaceLocal(), loadPublishedWorkspace()]);
  const publishedTime = published ? Date.parse(published.exportedAt) || 0 : 0;
  const localSnapshotTime = local?.snapshotExportedAt ? Date.parse(local.snapshotExportedAt) || 0 : 0;
  const publishedIsNew = Boolean(published && (!local || publishedTime > localSnapshotTime + 1000));
  if (published && publishedIsNew) {
    workspace = published.workspace;
    await saveWorkspaceLocal(workspace);
  } else if (local) {
    workspace = local;
    const status = q<HTMLElement>('[data-role="snapshot-status"]');
    if (published && status) status.textContent = 'Área de trabalho local ativa · snapshot publicado já sincronizado';
  } else if (published) {
    workspace = published.workspace;
  } else {
    workspace = createEmptyWorkspace();
  }

  if (!workspace.collections.length && !published) {
    const legacy = await loadDraft();
    if (legacy) {
      const size: CollectionSize = Number(legacy.setTotal) > 130 ? 'large' : 'normal';
      const recovered = createCollection('Rascunhos locais', size, workspace.collections);
      const restored = mergeDraft(legacy);
      upsertCard(recovered, restored);
      workspace.collections.push(recovered);
      touchWorkspace(workspace);
      await saveWorkspaceLocal(workspace);
      await clearDraft();
      toast('Rascunho antigo recuperado em “Rascunhos locais”.', 'success');
    }
  }
  renderHub();
}

function setTextIn(root: ParentNode, role: string, value: string | number) {
  qa<HTMLElement>(`[data-role="${role}"]`, root).forEach((node) => { node.textContent = String(value); });
}

function setInputValue(field: string, value: unknown) {
  qa<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-field="${field}"]`).forEach((input) => {
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
      input.checked = Boolean(value);
      return;
    }
    const scale = Number((input as HTMLElement).dataset.statScale || 1);
    if (scale !== 1 && typeof value === 'number') input.value = String(value / scale);
    else input.value = String(value ?? '');
  });
}

function updateEditorVisibility() {
  const kind = slotForCard();
  qa<HTMLElement>('[data-editor-kind]').forEach((node) => { node.hidden = node.dataset.editorKind !== kind; });
  qa<HTMLElement>('[data-card-slot]').forEach((node) => {
    const active = node.dataset.cardSlot === kind;
    node.hidden = !active;
    node.classList.toggle('is-active', active);
  });
  qa<HTMLElement>('[data-pokemon-only]').forEach((node) => { node.hidden = !isPokemon(card); });
  const fullArtControl = q<HTMLElement>('[data-full-art-control]');
  if (fullArtControl) fullArtControl.hidden = currentEditorMode() === 'essential' && !isPokemon(card);
  syncTypeSelectorUI();
  const previewTitle = q<HTMLElement>('[data-role="preview-title"]');
  if (previewTitle) {
    if (isPokemon(card)) previewTitle.textContent = `Carta Pokémon — ${card.form}`;
    else if (isAttack(card)) previewTitle.textContent = `Carta Ataque — ${card.attackKind === 'special' ? 'Especial' : 'Normal'}`;
    else if (isClimate(card)) previewTitle.textContent = 'Carta Clima';
    else previewTitle.textContent = `Carta Treinador — ${CARD_TYPE_LABELS[card.cardType]}`;
  }
}

function syncFormFromState() {
  updateEditorVisibility();
  setInputValue('cardNumber', card.cardNumber);
  setInputValue('setCode', card.setCode);
  setInputValue('expandedArtwork', Boolean(card.expandedArtwork));

  qa<HTMLInputElement>('[data-transform]').forEach((input) => {
    const key = input.dataset.transform as keyof CardData['artworkTransform'];
    input.value = String(card.artworkTransform[key]);
  });

  if (isPokemon(card)) {
    const fields: Array<keyof PokemonCardData> = [
      'pokemonName', 'form', 'rarity', 'type', 'stage', 'previousEvolution', 'previousEvolutionImage',
      'pokedexNumber', 'genus', 'height', 'weight', 'region', 'hp', 'attack', 'defense',
      'specialAttack', 'specialDefense', 'speed', 'abilityName', 'abilityDescription', 'flavorText', 'expandedArtwork',
    ];
    fields.forEach((field) => setInputValue(String(field), card[field]));
    updatePokemonTypeChoices(card.typeCandidates ?? []);
  } else if (isAttack(card)) {
    setInputValue('attackName', card.attackName);
    setInputValue('attackDescription', card.attackDescription);
    setInputValue('power', card.power);
    setInputValue('type', card.type);
    setInputValue('compatibleType', card.compatibleType);
    const compatibilityMode = card.compatibilityMode;
    qa<HTMLInputElement>('[data-compat-mode]').forEach((input) => { input.checked = input.value === compatibilityMode; });
  } else if (isClimate(card)) {
    setInputValue('name', card.name);
    setInputValue('effectText', card.effectText);
  } else if (isChampion(card)) {
    const fields: Array<keyof ChampionCardData> = [
      'name', 'victoryCondition', 'defeatCondition', 'passiveName', 'passiveDescription',
      'initialPokemonCount', 'initialAttackCount', 'initialTrainerCount',
    ];
    fields.forEach((field) => setInputValue(String(field), card[field]));
  } else if (isUtility(card)) {
    setInputValue('name', card.name);
    setInputValue('effectText', card.effectText);
    setInputValue('usageText', card.usageText);
  }

  updateRangeOutputs();
  updateAttackCompatibilityEditor();
  updateAttackDescriptionCount();
  updateTcgArtworkUI();
}

function updatePokemonTypeChoices(candidates: GameType[]) {
  const select = q<HTMLSelectElement>('#pokemon-type');
  const row = q<HTMLElement>('[data-role="type-candidates"]');
  if (!select || !row || !isPokemon(card)) return;
  const pokemon = card;
  const distinct = candidates.filter((value, index, list) => list.indexOf(value) === index);

  // Avançado nunca é limitado pela PokéAPI: todos os tipos do jogo continuam
  // disponíveis. No Essencial mostramos somente os botões sugeridos.
  select.innerHTML = GAME_TYPES.map((type) => `<option value="${escapeHtml(type)}"${type === pokemon.type ? ' selected' : ''}>${escapeHtml(type)}</option>`).join('');
  select.disabled = false;

  const quickChoices = distinct.length ? distinct : [pokemon.type];
  row.hidden = false;
  row.innerHTML = quickChoices.map((type) => `<button type="button" class="type-candidate-button${pokemon.type === type ? ' is-active' : ''}" data-type-candidate="${escapeHtml(type)}">${escapeHtml(type)}</button>`).join('');
}
function applyArtworkToNode(node: HTMLElement) {
  node.style.setProperty('--art-scale', String(card.artworkTransform.scale));
  node.style.setProperty('--art-x', String(card.artworkTransform.x));
  node.style.setProperty('--art-y', String(card.artworkTransform.y));
  qa<HTMLElement>('[data-role="artwork-frame"]', node).forEach((frame) => frame.classList.toggle('has-artwork', Boolean(card.artwork)));
  qa<HTMLImageElement>('[data-role="artwork-image"]', node).forEach((image) => { image.src = card.artwork || ''; });
}

function pokemonHeaderNameSize(name: string, form: PokemonForm) {
  const modifier = form === 'Normal' ? '' : form;
  const length = `${name} ${modifier}`.trim().length;
  if (length <= 10) return 33;
  if (length <= 14) return 31.5;
  if (length <= 18) return 28.5;
  if (length <= 22) return 25.5;
  if (length <= 26) return 23;
  if (length <= 32) return 20.5;
  return 18.5;
}

function renderPokemonHeaderName(node: HTMLElement, value: PokemonCardData) {
  const baseName = value.pokemonName || 'Novo Pokémon';
  const prefix = value.form === 'Mega' ? 'Mega' : '';
  const suffix = value.form === 'Normal' || value.form === 'Mega' ? '' : value.form;
  setTextIn(node, 'pokemon-form-prefix', prefix);
  setTextIn(node, 'pokemon-name', baseName);
  setTextIn(node, 'pokemon-form-suffix', suffix);

  const heading = q<HTMLElement>('[data-role="pokemon-display-name"]', node);
  if (heading) {
    let size = pokemonHeaderNameSize(baseName, value.form);
    heading.style.setProperty('--pokemon-name-size', `${size}px`);
    heading.setAttribute('aria-label', [prefix, baseName, suffix].filter(Boolean).join(' '));

    // Ajuste óptico final pelo espaço real do cabeçalho: reduz somente o
    // necessário e preserva um piso legível para nomes excepcionalmente longos.
    if (heading.clientWidth > 0) {
      const baseText = q<HTMLElement>('[data-role="pokemon-name"]', heading);
      const isClipped = () => heading.scrollWidth > heading.clientWidth
        || Boolean(baseText && baseText.scrollWidth > baseText.clientWidth);
      while (isClipped() && size > 18.5) {
        size = Math.max(18.5, size - 0.5);
        heading.style.setProperty('--pokemon-name-size', `${size}px`);
      }
    }
  }
}

function renderPokemon(node: HTMLElement, value: PokemonCardData) {
  const meta = TYPE_META[value.type];
  node.style.setProperty('--type', meta.color);
  node.style.setProperty('--type-deep', meta.deep);
  node.style.setProperty('--type-light', meta.light);
  node.dataset.form = value.form;
  node.dataset.pokemonType = value.type;
  node.dataset.rarity = value.rarity;
  node.dataset.expanded = String(value.expandedArtwork);
  node.classList.toggle('is-expanded', value.expandedArtwork);

  renderPokemonHeaderName(node, value);
  setTextIn(node, 'stage', value.stage);
  const displayedPreviousName = value.form === 'Normal' ? value.previousEvolution : value.pokemonName;
  const displayedPreviousImage = value.form === 'Normal' ? value.previousEvolutionImage : pokemonSelfImage(value);
  setTextIn(node, 'previous-name', displayedPreviousName || '');
  setTypeIcon(node, 'type-icon', meta.icon);
  const typeSymbol = q<HTMLElement>('.type-symbol', node);
  if (typeSymbol) typeSymbol.dataset.type = value.type;
  setTextIn(node, 'dex-number', `#${String(value.pokedexNumber ?? 0).padStart(4, '0')}`);
  setTextIn(node, 'genus', value.genus || 'Pokémon');
  setTextIn(node, 'height', value.height || '—');
  setTextIn(node, 'weight', value.weight || '—');
  setTextIn(node, 'region', value.region || '—');
  setTextIn(node, 'stat-hp', value.hp);
  setTextIn(node, 'stat-attack', value.attack);
  setTextIn(node, 'stat-defense', value.defense);
  setTextIn(node, 'stat-specialAttack', value.specialAttack);
  setTextIn(node, 'stat-specialDefense', value.specialDefense);
  setTextIn(node, 'stat-speed', value.speed);
  setTextIn(node, 'ability-name', value.abilityName || 'Habilidade');
  setTextIn(node, 'ability-description', value.abilityDescription || 'Escreva o efeito da habilidade.');
  setTextIn(node, 'flavor-text', value.flavorText || 'Adicione uma breve descrição para o rodapé da carta.');
  setTextIn(node, 'card-number', String(value.cardNumber || 0).padStart(3, '0'));
  setTextIn(node, 'set-total', value.setTotal);
  setTextIn(node, 'set-code', (value.setCode || 'SET').toUpperCase());
  const raritySymbols: Record<PokemonRarity, string> = { common: '●', uncommon: '▲', rare: '◆', ultraRare: '★', illustrationRare: '★★', illustrationRareUltra: '★★★' };
  setTextIn(node, 'rarity-mark', raritySymbols[value.rarity]);
  const rarityMark = q<HTMLElement>('[data-role="rarity-mark"]', node);
  if (rarityMark) {
    rarityMark.dataset.rarity = value.rarity;
    rarityMark.title = POKEMON_RARITY_LABELS[value.rarity];
    rarityMark.setAttribute('aria-label', POKEMON_RARITY_LABELS[value.rarity]);
  }

  const previousWrap = q<HTMLElement>('[data-role="previous-wrap"]', node);
  const previousImage = q<HTMLImageElement>('[data-role="previous-image"]', node);
  previousWrap?.classList.toggle('is-empty', !displayedPreviousName);
  if (previousImage) {
    previousImage.src = displayedPreviousImage || '';
    previousImage.alt = displayedPreviousName ? `Evolui de ${displayedPreviousName}` : '';
  }

  const editionMark = q<HTMLElement>('[data-role="edition-mark"]', node);
  if (editionMark) {
    const label = pokemonVersionLabel(value, activeCardId);
    editionMark.textContent = label;
    editionMark.hidden = !label;
  }

  const expandedImage = q<HTMLImageElement>('[data-role="expanded-image"]', node);
  if (expandedImage) expandedImage.src = value.artwork || '';
}

function renderUtility(node: HTMLElement, value: UtilityCardData) {
  const meta = CARD_CATEGORY_META[value.cardType];
  node.dataset.expanded = String(Boolean(value.expandedArtwork));
  node.classList.toggle('is-expanded', Boolean(value.expandedArtwork));
  node.dataset.utilityType = value.cardType;
  node.style.setProperty('--accent', meta.accent);
  node.style.setProperty('--accent-deep', meta.deep);
  node.style.setProperty('--utility-surface', meta.surface);
  node.style.setProperty('--ribbon-start', meta.ribbonStart);
  node.style.setProperty('--ribbon-end', meta.ribbonEnd);
  setTextIn(node, 'utility-symbol', meta.symbol);
  setTextIn(node, 'utility-category', meta.label);
  setTextIn(node, 'utility-name', value.name || CARD_TYPE_LABELS[value.cardType]);
  setTextIn(node, 'utility-effect', value.effectText || 'Escreva aqui o efeito desta carta.');
  setTextIn(node, 'utility-usage', value.usageText || 'Explique aqui como esta carta deve ser utilizada em jogo.');
  setTextIn(node, 'card-number', String(value.cardNumber || 0).padStart(3, '0'));
  setTextIn(node, 'set-total', value.setTotal);
  setTextIn(node, 'set-code', (value.setCode || 'SET').toUpperCase());
}

function renderClimate(node: HTMLElement, value: ClimateCardData) {
  const meta = CARD_CATEGORY_META.climate;
  node.dataset.expanded = String(Boolean(value.expandedArtwork));
  node.classList.toggle('is-expanded', Boolean(value.expandedArtwork));
  node.style.setProperty('--accent', meta.accent);
  node.style.setProperty('--accent-deep', meta.deep);
  node.style.setProperty('--utility-surface', meta.surface);
  node.style.setProperty('--ribbon-start', meta.ribbonStart);
  node.style.setProperty('--ribbon-end', meta.ribbonEnd);
  setTextIn(node, 'climate-name', value.name || 'Clima');
  setTextIn(node, 'climate-effect', value.effectText || 'Descreva aqui o efeito deste Clima.');
  setTextIn(node, 'card-number', String(value.cardNumber || 0).padStart(3, '0'));
  setTextIn(node, 'set-total', value.setTotal);
  setTextIn(node, 'set-code', (value.setCode || 'SET').toUpperCase());
}

function renderChampion(node: HTMLElement, value: ChampionCardData) {
  const meta = CARD_CATEGORY_META.champion;
  node.dataset.expanded = String(Boolean(value.expandedArtwork));
  node.classList.toggle('is-expanded', Boolean(value.expandedArtwork));
  node.style.setProperty('--accent', meta.accent);
  node.style.setProperty('--accent-deep', meta.deep);
  node.style.setProperty('--utility-surface', meta.surface);
  node.style.setProperty('--ribbon-start', meta.ribbonStart);
  node.style.setProperty('--ribbon-end', meta.ribbonEnd);
  setTextIn(node, 'champion-name', value.name || 'Campeão');
  setTextIn(node, 'champion-victory', value.victoryCondition);
  setTextIn(node, 'champion-defeat', value.defeatCondition);
  setTextIn(node, 'champion-passive-name', value.passiveName);
  setTextIn(node, 'champion-passive-description', value.passiveDescription);
  setTextIn(node, 'champion-initial-pokemon', value.initialPokemonCount);
  setTextIn(node, 'champion-initial-attack', value.initialAttackCount);
  setTextIn(node, 'champion-initial-trainer', value.initialTrainerCount);
  setTextIn(node, 'card-number', String(value.cardNumber || 0).padStart(3, '0'));
  setTextIn(node, 'set-total', value.setTotal);
  setTextIn(node, 'set-code', (value.setCode || 'SET').toUpperCase());
}

function renderCompatiblePokemon(node: HTMLElement, value: AttackCardData) {
  const grid = q<HTMLElement>('[data-role="compatible-pokemon-grid"]', node);
  const typeDisplay = q<HTMLElement>('[data-role="compatible-type-display"]', node);
  if (!grid || !typeDisplay) return;

  if (value.compatibilityMode === 'type') {
    grid.hidden = true;
    typeDisplay.hidden = false;
    const meta = TYPE_META[value.compatibleType];
    node.style.setProperty('--compat', meta.color);
    node.style.setProperty('--compat-deep', meta.deep);
    setTypeIcon(node, 'compatible-type-icon', meta.icon);
    setTextIn(node, 'compatible-type-text', `TODOS OS POKÉMON DE ${value.compatibleType.toUpperCase()}`);
    return;
  }

  typeDisplay.hidden = true;
  grid.hidden = false;
  grid.dataset.count = String(value.compatiblePokemon.length);
  grid.innerHTML = value.compatiblePokemon.length
    ? value.compatiblePokemon.map((pokemon) => `
      <div class="compatible-pokemon" title="${escapeHtml(pokemon.name)}">
        <span><img src="${escapeHtml(pokemon.sprite)}" alt="${escapeHtml(pokemon.name)}" crossorigin="anonymous" /></span>
        <small>${escapeHtml(pokemon.name)}</small>
      </div>`).join('')
    : '<div class="compatibility-empty">Selecione Pokémon no editor</div>';

  qa<HTMLImageElement>('img', grid).forEach((image) => {
    image.addEventListener('error', () => {
      const wrapper = image.parentElement;
      if (wrapper) wrapper.textContent = '✦';
    }, { once: true });
  });
}

function renderAttack(node: HTMLElement, value: AttackCardData) {
  const meta = ATTACK_KIND_META[value.attackKind];
  node.dataset.expanded = String(Boolean(value.expandedArtwork));
  node.classList.toggle('is-expanded', Boolean(value.expandedArtwork));
  const attackTypeMeta = TYPE_META[value.type];
  node.dataset.attackKind = value.attackKind;
  node.dataset.attackType = value.type;
  node.style.setProperty('--accent', meta.accent);
  node.style.setProperty('--accent-deep', meta.deep);
  node.style.setProperty('--attack-surface', meta.surface);
  node.style.setProperty('--ribbon-start', meta.ribbonStart);
  node.style.setProperty('--ribbon-end', meta.ribbonEnd);
  node.style.setProperty('--attack-type', attackTypeMeta.color);
  node.style.setProperty('--attack-type-deep', attackTypeMeta.deep);
  setTextIn(node, 'attack-kind-label', meta.label);
  setTextIn(node, 'attack-power', `${value.power}%`);
  setTypeIcon(node, 'attack-type-icon', attackTypeMeta.icon);
  setTextIn(node, 'attack-name-top', value.attackName || 'Novo Ataque');
  setTextIn(node, 'attack-name-bottom', value.attackName || 'Novo Ataque');
  setTextIn(node, 'attack-description', value.attackDescription || 'Descreva aqui o efeito deste ataque.');
  setTextIn(node, 'card-number', String(value.cardNumber || 0).padStart(3, '0'));
  setTextIn(node, 'set-total', value.setTotal);
  setTextIn(node, 'set-code', (value.setCode || 'SET').toUpperCase());
  renderCompatiblePokemon(node, value);
}

function renderCard() {
  updateEditorVisibility();
  const node = getActiveCardNode();
  applyArtworkToNode(node);
  if (isPokemon(card)) renderPokemon(node, card);
  else if (isAttack(card)) renderAttack(node, card);
  else if (isClimate(card)) renderClimate(node, card);
  else if (isChampion(card)) renderChampion(node, card);
  else if (isUtility(card)) renderUtility(node, card);
  updateAttackCompatibilityEditor();
  updateAttackDescriptionCount();
}

function updateRangeOutputs() {
  const scale = q<HTMLOutputElement>('[data-output="artworkScale"]');
  const x = q<HTMLOutputElement>('[data-output="artworkX"]');
  const y = q<HTMLOutputElement>('[data-output="artworkY"]');
  if (scale) scale.textContent = `${card.artworkTransform.scale.toFixed(2)}×`;
  if (x) x.textContent = `${Math.round(card.artworkTransform.x)}%`;
  if (y) y.textContent = `${Math.round(card.artworkTransform.y)}%`;
}

function setReferenceStats() {
  const stats = reference.officialStats;
  const pairs: Array<keyof NonNullable<EditorReferenceData['officialStats']>> = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
  pairs.forEach((key) => {
    const node = q<HTMLElement>(`[data-reference-stat="${key}"]`);
    if (node) node.textContent = stats ? String(stats[key]) : '—';
  });
  const button = q<HTMLButtonElement>('[data-action="use-official-stats"]');
  if (button) button.disabled = !stats;
}

function setAbilitySuggestions() {
  const datalist = q<HTMLDataListElement>('[data-role="ability-options"]');
  if (!datalist) return;
  datalist.innerHTML = reference.abilities.map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join('');
}

function updateAttackDescriptionCount() {
  const counter = q<HTMLElement>('[data-role="attack-description-count"]');
  if (counter) counter.textContent = `${isAttack(card) ? card.attackDescription.length : 0}/360`;
}

function updateAttackCompatibilityEditor() {
  const specific = q<HTMLElement>('[data-role="specific-compatibility-editor"]');
  const byType = q<HTMLElement>('[data-role="type-compatibility-editor"]');
  const count = q<HTMLElement>('[data-role="compatible-count"]');
  if (!isAttack(card)) {
    if (specific) specific.hidden = false;
    if (byType) byType.hidden = true;
    if (count) count.textContent = '0';
    return;
  }
  if (specific) specific.hidden = card.compatibilityMode !== 'specific';
  if (byType) byType.hidden = card.compatibilityMode !== 'type';
  if (count) count.textContent = String(card.compatiblePokemon.length);
  renderSelectedPokemonEditor();
}

function renderSelectedPokemonEditor() {
  const list = q<HTMLElement>('[data-role="selected-pokemon-list"]');
  if (!list) return;
  if (!isAttack(card) || !card.compatiblePokemon.length) {
    list.innerHTML = '<p class="selection-empty">Nenhum Pokémon selecionado.</p>';
    return;
  }
  list.innerHTML = card.compatiblePokemon.map((pokemon) => `
    <div class="selected-pokemon-chip">
      <img src="${escapeHtml(pokemon.sprite)}" alt="" crossorigin="anonymous" />
      <span>${escapeHtml(pokemon.name)}</span>
      <button type="button" data-remove-compatible="${pokemon.id}" aria-label="Remover ${escapeHtml(pokemon.name)}">×</button>
    </div>`).join('');
}

function clearArtworkSourceMetadata(nextSource: 'manual' | 'none' = 'none') {
  card.artworkSource = nextSource;
  card.artworkSourceCardId = '';
  card.artworkSourceLabel = '';
}

function providerLabel(candidate: TcgArtworkCandidate) {
  return candidate.provider === 'tcgdex' ? 'TCGdex' : 'Pokémon TCG API';
}

function renderTcgArtworkSuggestions() {
  if (!tcgArtworkSuggestions) return;
  if (tcgArtworkSuggestionCount) tcgArtworkSuggestionCount.textContent = String(tcgArtworkCandidates.length);

  if (!isPokemon(card) || card.form !== 'Normal') {
    tcgArtworkSuggestions.innerHTML = '<p class="tcg-suggestion-empty">As sugestões aparecem apenas para Pokémon na forma Normal.</p>';
    return;
  }
  if (tcgArtworkLoading) {
    tcgArtworkSuggestions.innerHTML = Array.from({ length: 4 }, () => '<div class="tcg-card-skeleton" aria-hidden="true"><i></i><span></span></div>').join('');
    return;
  }
  if (!tcgArtworkCandidates.length) {
    tcgArtworkSuggestions.innerHTML = '<p class="tcg-suggestion-empty">Nenhuma sugestão carregada para este Pokémon.</p>';
    return;
  }

  tcgArtworkSuggestions.innerHTML = tcgArtworkCandidates.map((candidate, index) => {
    const selected = card.artworkSourceCardId === candidate.cardId ? ' is-selected' : '';
    return `
      <button type="button" class="tcg-card-suggestion${selected}" data-tcg-card-id="${escapeHtml(candidate.cardId)}" data-tcg-provider="${candidate.provider}" title="Usar arte de ${escapeHtml(candidate.setName)} #${escapeHtml(candidate.localId)}">
        <span class="tcg-card-thumb"><img src="${escapeHtml(candidate.previewUrl)}" alt="${escapeHtml(candidate.cardName)} — ${escapeHtml(candidate.setName)} #${escapeHtml(candidate.localId)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>
        <span class="tcg-card-meta"><strong>${escapeHtml(candidate.setName)} #${escapeHtml(candidate.localId)}</strong><small>${providerLabel(candidate)}${index === 0 ? ' · sugerida' : ''}</small></span>
      </button>`;
  }).join('');

  qa<HTMLImageElement>('img', tcgArtworkSuggestions).forEach((image) => {
    image.addEventListener('error', () => image.closest('.tcg-card-suggestion')?.classList.add('has-image-error'), { once: true });
  });
}

function updateTcgArtworkUI() {
  const available = isPokemon(card) && card.form === 'Normal' && Boolean(card.pokemonName.trim()) && card.pokemonName !== 'Novo Pokémon';
  if (tcgArtworkRefreshButton) tcgArtworkRefreshButton.disabled = !available || tcgArtworkLoading;
  tcgArtworkSuggestionDetails?.classList.toggle('is-disabled', !available);
  if (!available && tcgArtworkSuggestionDetails) tcgArtworkSuggestionDetails.open = false;
  if (tcgArtworkSuggestionCount) tcgArtworkSuggestionCount.textContent = String(tcgArtworkCandidates.length);

  if (!isPokemon(card)) return;
  if (card.form !== 'Normal') {
    if (tcgArtworkStatus) tcgArtworkStatus.textContent = 'Sugestões de cartas desativadas para EX, Mega, Radiante e Gigantamax.';
    return;
  }
  if (tcgArtworkStatusOverride) {
    if (tcgArtworkStatus) tcgArtworkStatus.textContent = tcgArtworkStatusOverride;
    return;
  }
  if (card.artworkSource === 'tcgdex' && card.artworkSourceLabel) {
    if (tcgArtworkStatus) tcgArtworkStatus.textContent = `Arte recortada de ${card.artworkSourceLabel}. Você pode escolher outra sugestão abaixo.`;
  } else if (tcgArtworkCandidates.length) {
    if (tcgArtworkStatus) tcgArtworkStatus.textContent = `${tcgArtworkCandidates.length} sugestões de cartas normais encontradas. Abra “Sugestões” e escolha a arte.`;
  } else if (card.artworkSource === 'manual' && card.artwork) {
    if (tcgArtworkStatus) tcgArtworkStatus.textContent = 'Arte manual preservada. As sugestões são carregadas em segundo plano.';
  } else {
    if (tcgArtworkStatus) tcgArtworkStatus.textContent = 'Ao escolher um Pokémon na Pokédex, as cartas normais são buscadas automaticamente em segundo plano.';
  }
}

function resetTcgArtworkCandidates(status = '') {
  tcgArtworkCandidates = [];
  tcgArtworkStatusOverride = status;
  renderTcgArtworkSuggestions();
  updateTcgArtworkUI();
}

async function preloadTcgArtworkSuggestions(pokemonName: string, force = false, prefetched?: Promise<TcgArtworkCandidate[]>) {
  if (!isPokemon(card) || card.form !== 'Normal') return;
  const expectedPokemonName = pokemonName.trim();
  if (!expectedPokemonName || expectedPokemonName === 'Novo Pokémon') return;

  if (!prefetched) {
    tcgArtworkSearchAbort?.abort();
    tcgArtworkSearchAbort = new AbortController();
  }
  tcgArtworkLoading = true;
  tcgArtworkStatusOverride = 'Buscando cartas normais em segundo plano…';
  renderTcgArtworkSuggestions();
  updateTcgArtworkUI();

  try {
    const candidates = prefetched
      ? await prefetched
      : await findNormalPokemonArtworkCandidates(expectedPokemonName, {
          signal: tcgArtworkSearchAbort?.signal,
          force,
          fallbackStage: card.stage,
        });
    if (!isPokemon(card) || card.form !== 'Normal') return;
    if (normalizePokemonNameForArtwork(card.pokemonName) !== normalizePokemonNameForArtwork(expectedPokemonName)) return;

    tcgArtworkCandidates = candidates;
    tcgArtworkStatusOverride = candidates.length
      ? `${candidates.length} sugestões encontradas. Abra “Sugestões” para escolher uma imagem.`
      : 'Não encontrei uma carta normal segura para este Pokémon. EX/GX/V/Mega/Full Art continuam bloqueadas.';
    renderTcgArtworkSuggestions();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const message = error instanceof Error ? error.message : 'Falha ao consultar as fontes de cartas.';
    tcgArtworkCandidates = [];
    tcgArtworkStatusOverride = `${message} A Pokédex continua funcionando normalmente; tente atualizar as sugestões.`;
    renderTcgArtworkSuggestions();
  } finally {
    if (isPokemon(card) && normalizePokemonNameForArtwork(card.pokemonName) === normalizePokemonNameForArtwork(expectedPokemonName)) {
      tcgArtworkLoading = false;
      renderTcgArtworkSuggestions();
      updateTcgArtworkUI();
    }
  }
}

async function applyTcgArtworkCandidate(candidate: TcgArtworkCandidate, expectedPokemonName: string) {
  if (!isPokemon(card) || card.form !== 'Normal') return false;
  if (normalizePokemonNameForArtwork(card.pokemonName) !== normalizePokemonNameForArtwork(expectedPokemonName)) return false;

  tcgArtworkCropAbort?.abort();
  tcgArtworkCropAbort = new AbortController();
  const candidateWithStage = { ...candidate, stage: card.stage || candidate.stage };
  tcgArtworkStatusOverride = `Recortando ${candidate.setName} #${candidate.localId}…`;
  updateTcgArtworkUI();
  const extraction = await extractArtworkFromCandidate(candidateWithStage, tcgArtworkCropAbort.signal);
  if (!isPokemon(card) || card.form !== 'Normal') return false;
  if (normalizePokemonNameForArtwork(card.pokemonName) !== normalizePokemonNameForArtwork(expectedPokemonName)) return false;

  card.artwork = extraction.artwork;
  // Mantido como "tcgdex" por compatibilidade com rascunhos salvos pela versão anterior.
  card.artworkSource = 'tcgdex';
  card.artworkSourceCardId = candidate.cardId;
  card.artworkSourceLabel = `${candidate.setName} #${candidate.localId}`;
  card.artworkTransform = { scale: 1, x: 0, y: 0 };
  const safety = extraction.crop.evolvedSafetyApplied ? ' A faixa de “Evolui de” foi evitada.' : '';
  tcgArtworkStatusOverride = `Arte extraída de ${candidate.setName} #${candidate.localId} via ${providerLabel(candidate)}.${safety}`;
  renderCard();
  syncFormFromState();
  renderTcgArtworkSuggestions();
  markChanged();
  toast(`Arte de ${candidate.cardName} aplicada.`, 'success');
  return true;
}

function normalizePokemonNameForArtwork(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function markChanged() {
  dirty = true;
  autosaveStatus?.classList.add('is-saving');
  if (autosaveStatus) autosaveStatus.innerHTML = '<i></i> Salvando…';
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      await persistActiveCard(false);
      dirty = false;
      autosaveStatus?.classList.remove('is-saving');
      if (autosaveStatus) autosaveStatus.innerHTML = '<i></i> Salvo localmente';
    } catch {
      autosaveStatus?.classList.remove('is-saving');
      if (autosaveStatus) autosaveStatus.innerHTML = '<i></i> Falha ao salvar';
    }
  }, 650);
}

function normalizeStat(value: number, max = Number.POSITIVE_INFINITY) {
  const rounded = Math.max(0, Math.round((Number(value) || 0) / 10) * 10);
  return Math.min(max, rounded);
}

function normalizePokemonRarityForForm(rarity: PokemonRarity, form: PokemonForm): PokemonRarity {
  if (form === 'Normal') {
    if (rarity === 'ultraRare') return 'rare';
    if (rarity === 'illustrationRareUltra') return 'illustrationRare';
    return rarity;
  }
  if (rarity === 'illustrationRare' || rarity === 'illustrationRareUltra') return 'illustrationRareUltra';
  return 'ultraRare';
}

function mergeDraft(restored: CardData): CardData {
  if (restored.cardType === 'pokemon') {
    const raw = restored as PokemonCardData & { form?: string; rarity?: PokemonRarity };
    const form: PokemonForm = CARD_FORMS.includes(raw.form as PokemonForm) ? raw.form as PokemonForm : 'Normal';
    const rarity = raw.rarity || (form === 'Normal' ? 'common' : 'ultraRare');
    return {
      ...cloneCard(DEFAULT_POKEMON_CARD),
      ...restored,
      cardType: 'pokemon',
      form,
      rarity,
      hp: normalizeStat(restored.hp),
      attack: normalizeStat(restored.attack),
      defense: normalizeStat(restored.defense),
      specialAttack: normalizeStat(restored.specialAttack),
      specialDefense: normalizeStat(restored.specialDefense),
      speed: normalizeStat(restored.speed),
      setTotal: Number(restored.setTotal) || 160,
      artworkSource: restored.artworkSource ?? (restored.artwork ? 'manual' : 'none'),
      artworkTransform: { ...DEFAULT_POKEMON_CARD.artworkTransform, ...restored.artworkTransform },
    };
  }
  if (restored.cardType === 'attack') {
    return {
      ...cloneCard(DEFAULT_ATTACK_CARD),
      ...restored,
      cardType: 'attack',
      power: Number.isFinite(Number(restored.power)) ? Number(restored.power) : 100,
      type: restored.type || 'Água',
      setTotal: Number(restored.setTotal) || 160,
      compatiblePokemon: Array.isArray(restored.compatiblePokemon) ? restored.compatiblePokemon : [],
      artworkSource: restored.artworkSource ?? (restored.artwork ? 'manual' : 'none'),
      artworkTransform: { ...DEFAULT_ATTACK_CARD.artworkTransform, ...restored.artworkTransform },
    };
  }
  if (restored.cardType === 'climate') {
    const base = createClimateCard();
    return { ...base, ...restored, cardType: 'climate', artworkSource: restored.artworkSource ?? (restored.artwork ? 'manual' : 'none'), artworkTransform: { ...base.artworkTransform, ...restored.artworkTransform } };
  }
  if (restored.cardType === 'champion') {
    const base = createChampionCard();
    return {
      ...base,
      ...restored,
      cardType: 'champion',
      setTotal: Number(restored.setTotal) || 160,
      artworkSource: restored.artworkSource ?? (restored.artwork ? 'manual' : 'none'),
      artworkTransform: { ...base.artworkTransform, ...restored.artworkTransform },
    };
  }
  const base = createUtilityCard(restored.cardType);
  return {
    ...base,
    ...restored,
    cardType: restored.cardType,
    usageText: base.usageText,
    setTotal: Number(restored.setTotal) || 160,
    artworkSource: restored.artworkSource ?? (restored.artwork ? 'manual' : 'none'),
    artworkTransform: { ...base.artworkTransform, ...restored.artworkTransform },
  };
}

function applyState(next: CardData, syncForm = true) {
  card = cloneCard(next);
  if (isPokemon(card)) naturalStage = card.form === 'Normal' ? card.stage : naturalStage;
  if (syncForm) syncFormFromState();
  renderCard();
}

function applyPokemonForm(form: PokemonForm) {
  if (!isPokemon(card)) return;
  card.form = form;

  // O modo Essencial mantém as convenções automáticas. No Avançado o usuário
  // pode combinar forma, estágio e raridade livremente; inconsistências viram
  // avisos na coleção em vez de serem corrigidas à força.
  if (!isAdvancedMode()) {
    card.rarity = normalizePokemonRarityForForm(card.rarity, form);
    if (form !== 'Normal') card.stage = 'FINAL';
    else card.stage = naturalStage;
  }

  setInputValue('stage', card.stage);
  setInputValue('rarity', card.rarity);
  pokemonSubtypeSelector.value = card.form;
  renderCard();
  updateTcgArtworkUI();
  markChanged();
  if (form === 'Normal' && card.pokemonName && card.pokemonName !== 'Novo Pokémon') void preloadTcgArtworkSuggestions(card.pokemonName);
}

function updateField(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  const field = input.dataset.field;
  if (!field) return;
  if (input.hasAttribute('data-derived') || field === 'cardNumber' || field === 'setCode') return;
  if (!(field in card)) return;

  if (field === 'form' && isPokemon(card)) {
    applyPokemonForm(input.value as PokemonForm);
    return;
  }

  let value: unknown = input.value;
  if (input instanceof HTMLInputElement && input.type === 'checkbox') value = input.checked;
  else if (input instanceof HTMLInputElement && input.type === 'number') value = input.value === '' ? 0 : Number(input.value);

  if (field === 'pokedexNumber') value = Number(value) || null;

  if (['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'].includes(field)) {
    const scale = Number((input as HTMLElement).dataset.statScale || 1);
    const typed = Math.max(0, Math.round(Number(value) || 0));
    value = typed * scale;
    input.value = String(typed);
  }

  if (field === 'power' && isAttack(card)) {
    value = Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  if (['initialPokemonCount', 'initialAttackCount', 'initialTrainerCount'].includes(field) && isChampion(card)) {
    value = Math.max(0, Math.round(Number(value) || 0));
    input.value = String(value);
  }

  (card as unknown as Record<string, unknown>)[field] = value;

  if (isPokemon(card) && field === 'rarity' && !isAdvancedMode()) {
    card.rarity = normalizePokemonRarityForForm(card.rarity, card.form);
    input.value = card.rarity;
  }
  if (isPokemon(card) && field === 'stage' && card.form === 'Normal') naturalStage = card.stage;

  renderCard();
  markChanged();
}

async function ensurePokemonIndex(control: HTMLElement) {
  if (pokemonIndex) return pokemonIndex;
  control.classList.add('is-loading');
  try {
    pokemonIndex = await getPokemonIndex();
    return pokemonIndex;
  } finally {
    control.classList.remove('is-loading');
  }
}

function suggestionItems(index: Array<{ name: string; id: number }>, term: string) {
  const starts = index.filter((item) => item.name.startsWith(term));
  const contains = index.filter((item) => !item.name.startsWith(term) && item.name.includes(term));
  return [...starts, ...contains].slice(0, 9);
}

function showSuggestions(node: HTMLElement, input: HTMLInputElement, items: Array<{ name: string; id: number }>) {
  node.innerHTML = items.length
    ? items.map((item) => `<button type="button" class="suggestion" role="option" data-pokemon-id="${item.id}" data-pokemon-name="${escapeHtml(item.name)}"><strong>${escapeHtml(titleCasePokemon(item.name))}</strong><span>#${String(item.id).padStart(4, '0')}</span></button>`).join('')
    : '<div class="suggestion"><span>Nenhuma correspondência</span></div>';
  node.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function hideSuggestions(node: HTMLElement, input: HTMLInputElement, mode: 'pokemon' | 'attack') {
  node.hidden = true;
  node.innerHTML = '';
  input.setAttribute('aria-expanded', 'false');
  if (mode === 'pokemon') pokemonSuggestionCursor = -1;
  else attackSuggestionCursor = -1;
}

async function handlePokemonSearchQuery() {
  const term = pokemonSearchInput.value.trim().toLowerCase();
  if (!term) return hideSuggestions(pokemonSuggestions, pokemonSearchInput, 'pokemon');
  if (/^\d+$/.test(term)) return showSuggestions(pokemonSuggestions, pokemonSearchInput, [{ name: `Pokémon #${term}`, id: Number(term) }]);
  if (term.length < 2) return hideSuggestions(pokemonSuggestions, pokemonSearchInput, 'pokemon');
  try {
    const index = await ensurePokemonIndex(pokemonSearchControl);
    showSuggestions(pokemonSuggestions, pokemonSearchInput, suggestionItems(index, term));
  } catch {
    apiStatus.textContent = 'Não foi possível carregar as sugestões. Você ainda pode preencher tudo manualmente.';
  }
}

async function handleAttackSearchQuery() {
  if (!isAttack(card)) return;
  const term = attackSearchInput.value.trim().toLowerCase();
  if (!term) return hideSuggestions(attackSuggestions, attackSearchInput, 'attack');
  if (/^\d+$/.test(term)) return showSuggestions(attackSuggestions, attackSearchInput, [{ name: `Pokémon #${term}`, id: Number(term) }]);
  if (term.length < 2) return hideSuggestions(attackSuggestions, attackSearchInput, 'attack');
  try {
    const index = await ensurePokemonIndex(attackSearchControl);
    showSuggestions(attackSuggestions, attackSearchInput, suggestionItems(index, term));
  } catch {
    attackApiStatus.textContent = 'Não foi possível carregar as sugestões da PokéAPI.';
  }
}

async function selectPokemon(identifier: string | number, pokemonNameHint = '') {
  if (!isPokemon(card)) return;
  hideSuggestions(pokemonSuggestions, pokemonSearchInput, 'pokemon');
  pokemonSearchAbort?.abort();
  pokemonSearchAbort = new AbortController();
  pokemonSearchControl.classList.add('is-loading');
  getActiveCardNode().classList.add('is-api-loading');
  apiStatus.textContent = 'Consultando PokéAPI, espécie e cadeia evolutiva…';

  const hintedName = (pokemonNameHint || (typeof identifier === 'string' ? identifier : '')).trim();
  let artworkPrefetch: Promise<TcgArtworkCandidate[]> | null = null;
  if (hintedName && card.form === 'Normal') {
    tcgArtworkSearchAbort?.abort();
    tcgArtworkSearchAbort = new AbortController();
    artworkPrefetch = findNormalPokemonArtworkCandidates(hintedName, {
      signal: tcgArtworkSearchAbort.signal,
      fallbackStage: '',
    });
    // A busca de cartas começa ao mesmo tempo que a PokéAPI. O handler evita warning de
    // Promise não tratada caso a fonte falhe antes de a PokéAPI terminar de carregar.
    void artworkPrefetch.catch(() => undefined);
  }

  try {
    const data = await loadPokemonEditorData(identifier, pokemonSearchAbort.signal);
    if (!isPokemon(card)) return;
    const p = data.pokemon;
    naturalStage = p.stage;
    resetTcgArtworkCandidates();
    if (card.artworkSource === 'tcgdex') {
      card.artwork = '';
      clearArtworkSourceMetadata('none');
    }
    Object.assign(card, {
      pokemonId: p.pokemonId,
      pokemonName: p.pokemonName,
      pokedexNumber: p.pokedexNumber,
      height: p.height,
      weight: p.weight,
      genus: p.genus,
      flavorText: p.flavorText,
      region: p.region,
      previousEvolution: p.previousEvolution,
      previousEvolutionImage: p.previousEvolutionImage,
      stage: card.form === 'Normal' ? p.stage : 'FINAL',
      typeCandidates: p.typeCandidates,
      ...data.officialStats,
    });
    if (!isAdvancedMode()) {
      if (p.typeCandidates.length === 1) card.type = p.typeCandidates[0]!;
      else if (p.typeCandidates.length > 1 && !p.typeCandidates.includes(card.type)) card.type = p.typeCandidates[0]!;
    }

    reference.officialStats = data.officialStats;
    reference.abilities = data.abilities;
    if (data.abilities.length && (!card.abilityName || card.abilityName === 'Nome da habilidade')) card.abilityName = data.abilities[0]!.name;
    setReferenceStats();
    setAbilitySuggestions();
    syncFormFromState();
    renderCard();
    pokemonSearchInput.value = p.pokemonName;
    apiStatus.textContent = p.typeCandidates.length === 1
      ? `Dados carregados. Tipo ${p.typeCandidates[0]} definido automaticamente.`
      : p.typeCandidates.length > 1
        ? `Dados carregados. Escolha entre ${p.typeCandidates.join(' ou ')}.`
        : 'Dados carregados. Nenhum mapeamento direto: escolha o tipo manualmente.';
    const typeSuggestion = q<HTMLElement>('[data-role="type-suggestion"]');
    if (typeSuggestion) typeSuggestion.textContent = p.typeCandidates.length === 1
      ? `Tipo definido automaticamente: ${p.typeCandidates[0]}.`
      : p.typeCandidates.length > 1 ? 'Somente os tipos compatíveis aparecem acima.' : 'Fallback: todos os tipos do jogo estão disponíveis.';
    markChanged();
    toast(`${p.pokemonName} carregado pela PokéAPI.`, 'success');
    const canReusePrefetch = artworkPrefetch && normalizePokemonNameForArtwork(hintedName) === normalizePokemonNameForArtwork(p.pokemonName);
    void preloadTcgArtworkSuggestions(p.pokemonName, false, canReusePrefetch ? artworkPrefetch : undefined);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const message = error instanceof Error ? error.message : 'Falha ao consultar a PokéAPI.';
    apiStatus.textContent = `${message} O editor continua disponível para preenchimento manual.`;
    toast(message, 'error');
  } finally {
    pokemonSearchControl.classList.remove('is-loading');
    q<HTMLElement>('[data-card-template="pokemon"]')?.classList.remove('is-api-loading');
  }
}

async function addCompatiblePokemon(identifier: string | number) {
  if (!isAttack(card)) return;
  hideSuggestions(attackSuggestions, attackSearchInput, 'attack');
  attackPokemonAbort?.abort();
  attackPokemonAbort = new AbortController();
  attackSearchControl.classList.add('is-loading');
  try {
    const pokemon = await loadPokemonSummary(identifier, attackPokemonAbort.signal);
    if (!isAttack(card)) return;
    if (card.compatiblePokemon.some((item) => item.id === pokemon.id)) {
      toast(`${pokemon.name} já está na lista.`, 'neutral');
      return;
    }
    card.compatiblePokemon.push(pokemon);
    attackSearchInput.value = '';
    renderCard();
    updateAttackCompatibilityEditor();
    markChanged();
    toast(`${pokemon.name} adicionado ao ataque.`, 'success');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const message = error instanceof Error ? error.message : 'Falha ao consultar a PokéAPI.';
    attackApiStatus.textContent = message;
    toast(message, 'error');
  } finally {
    attackSearchControl.classList.remove('is-loading');
  }
}

function moveSuggestion(node: HTMLElement, mode: 'pokemon' | 'attack', delta: number) {
  const buttons = qa<HTMLButtonElement>('.suggestion[data-pokemon-id]', node);
  if (!buttons.length) return;
  let cursor = mode === 'pokemon' ? pokemonSuggestionCursor : attackSuggestionCursor;
  cursor = (cursor + delta + buttons.length) % buttons.length;
  if (mode === 'pokemon') pokemonSuggestionCursor = cursor;
  else attackSuggestionCursor = cursor;
  buttons.forEach((button, index) => button.classList.toggle('is-active', index === cursor));
  buttons[cursor]?.scrollIntoView({ block: 'nearest' });
}

function readArtwork(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    toast('Formato inválido. Use PNG, JPG/JPEG ou WebP.', 'error');
    return;
  }
  if (file.size > 16 * 1024 * 1024) {
    toast('A imagem é muito grande. Use um arquivo de até 16 MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    card.artwork = String(reader.result || '');
    clearArtworkSourceMetadata('manual');
    tcgArtworkStatusOverride = '';
    card.artworkTransform = { scale: 1, x: 0, y: 0 };
    syncFormFromState();
    renderCard();
    markChanged();
    toast('Arte carregada.', 'success');
  };
  reader.onerror = () => toast('Não foi possível ler essa imagem.', 'error');
  reader.readAsDataURL(file);
}

async function handleAbilityChange() {
  if (!isPokemon(card)) return;
  const input = q<HTMLInputElement>('[data-field="abilityName"]');
  if (!input) return;
  const match = reference.abilities.find((item) => item.name.toLowerCase() === input.value.trim().toLowerCase());
  if (!match) return;
  abilityAbort?.abort();
  abilityAbort = new AbortController();
  try {
    const description = await loadAbilityDescription(match.url, abilityAbort.signal);
    if (!description || !isPokemon(card)) return;
    card.abilityName = match.name;
    card.abilityDescription = description;
    setInputValue('abilityName', card.abilityName);
    setInputValue('abilityDescription', card.abilityDescription);
    renderCard();
    markChanged();
    toast('Descrição da habilidade sugerida pela PokéAPI.');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    toast('Não consegui buscar a descrição dessa habilidade.', 'error');
  }
}

function bindArtworkDragging() {
  let pointerId: number | null = null;
  let surface: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let baseY = 0;
  let moved = false;

  const getArtworkSurface = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    const activeCard = getActiveCardNode();
    let artworkSurface = element?.closest<HTMLElement>('[data-role="artwork-drag-surface"]') || null;

    // Em Full Art, qualquer ponto da carta funciona como superfície de ajuste.
    // Isso mantém drag + scroll disponíveis mesmo quando texto/painéis estão
    // visualmente sobre a imagem.
    if (!artworkSurface && card.expandedArtwork && element && activeCard.contains(element)) {
      artworkSurface = q<HTMLElement>('[data-role="artwork-drag-surface"]', activeCard);
    }

    if (!artworkSurface || !activeCard.contains(artworkSurface) || !card.artwork) return null;
    return artworkSurface;
  };

  scaleBox.addEventListener('pointerdown', (event) => {
    const target = getArtworkSurface(event.target);
    if (!target) return;
    surface = target;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    baseX = card.artworkTransform.x;
    baseY = card.artworkTransform.y;
    moved = false;
    target.classList.add('is-dragging');
    target.setPointerCapture(pointerId);
    event.preventDefault();
  });

  scaleBox.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId || !surface) return;
    const rect = surface.getBoundingClientRect();
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    card.artworkTransform.x = clamp(baseX + (dx / Math.max(1, rect.width)) * 100, -100, 100);
    card.artworkTransform.y = clamp(baseY + (dy / Math.max(1, rect.height)) * 100, -100, 100);
    renderCard();
    event.preventDefault();
  });

  const end = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    surface?.classList.remove('is-dragging');
    pointerId = null;
    surface = null;
    if (moved) markChanged();
  };
  scaleBox.addEventListener('pointerup', end);
  scaleBox.addEventListener('pointercancel', end);

  scaleBox.addEventListener('wheel', (event) => {
    const target = getArtworkSurface(event.target);
    if (!target) return;
    event.preventDefault();

    const direction = event.deltaY < 0 ? 1 : -1;
    const step = event.ctrlKey ? 0.06 : 0.12;
    const nextScale = clamp(card.artworkTransform.scale + direction * step, 0.5, 4);
    if (nextScale === card.artworkTransform.scale) return;

    card.artworkTransform.scale = Number(nextScale.toFixed(2));
    renderCard();
    markChanged();
  }, { passive: false });

  scaleBox.addEventListener('dblclick', (event) => {
    const target = getArtworkSurface(event.target);
    if (!target) return;
    event.preventDefault();
    card.artworkTransform = { scale: 1, x: 0, y: 0 };
    renderCard();
    markChanged();
    toast('Enquadramento da arte resetado.');
  });
}

function fitPreview() {
  const available = Math.max(280, previewStage.clientWidth - 44);
  const scale = Math.min(1, available / 630);
  scaleBox.style.transform = `scale(${scale})`;
  scaleBox.style.height = `${880 * scale}px`;
  scaleBox.style.marginBottom = `${-880 * (1 - scale)}px`;
  const chip = q<HTMLElement>('[data-role="preview-scale"]');
  if (chip) chip.textContent = `${Math.round(scale * 100)}%`;
}

function switchCardType(nextType: CardType) {
  if (nextType === card.cardType) return;
  const collection = currentCollection();
  if (collection && categoryFull(collection, nextType)) {
    toast(`${CARD_TYPE_LABELS[nextType]} já atingiu o limite desta coleção.`, 'error');
    syncTypeSelectorUI();
    return;
  }
  pokemonSearchAbort?.abort();
  attackPokemonAbort?.abort();
  tcgArtworkSearchAbort?.abort();
  tcgArtworkCropAbort?.abort();
  const previous = cloneCard(card);
  cardCache[card.cardType] = previous;
  const next = cardCache[nextType] ? cloneCard(cardCache[nextType]!) : createEmptyCard(nextType);
  if (familyForCard(previous) === 'trainer' && familyForCard(next) === 'trainer') {
    next.artwork = previous.artwork;
    next.artworkSource = previous.artworkSource;
    next.artworkSourceCardId = previous.artworkSourceCardId;
    next.artworkSourceLabel = previous.artworkSourceLabel;
    next.artworkTransform = { ...previous.artworkTransform };
    next.expandedArtwork = Boolean(previous.expandedArtwork);
    next.cardNumber = previous.cardNumber;
    next.setTotal = previous.setTotal;
    next.setCode = previous.setCode;
    if ('name' in previous && 'name' in next) next.name = previous.name;
    if ('effectText' in previous && 'effectText' in next) next.effectText = previous.effectText;
  }
  resetTcgArtworkCandidates();
  if (nextType === 'pokemon' && next.cardType === 'pokemon') naturalStage = next.stage;
  applyState(next);
  if (next.cardType === 'pokemon' && next.form === 'Normal' && next.pokemonName && next.pokemonName !== 'Novo Pokémon') {
    void preloadTcgArtworkSuggestions(next.pokemonName);
  }
  markChanged();
}

function bindEvents() {
  qa<HTMLButtonElement>('[data-editor-mode-tab]').forEach((button) => {
    button.addEventListener('click', () => setEditorMode(button.dataset.editorModeTab === 'advanced' ? 'advanced' : 'essential'));
  });

  qa<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-field]').forEach((input) => {
    input.addEventListener('input', () => updateField(input));
  });

  cardFamilySelector.addEventListener('change', () => {
    const family = cardFamilySelector.value as CardFamily;
    if (family === 'pokemon') switchCardType('pokemon');
    else if (family === 'attack') switchCardType('attack');
    else if (family === 'climate') switchCardType('climate');
    else switchCardType(trainerSubtypeSelector.value as TrainerCardType);
  });

  trainerSubtypeSelector.addEventListener('change', () => {
    if (cardFamilySelector.value !== 'trainer') return;
    switchCardType(trainerSubtypeSelector.value as TrainerCardType);
  });

  pokemonSubtypeSelector.addEventListener('change', () => {
    if (!isPokemon(card)) return;
    applyPokemonForm(pokemonSubtypeSelector.value as PokemonForm);
  });

  attackSubtypeSelector.addEventListener('change', () => {
    if (!isAttack(card)) return;
    card.attackKind = attackSubtypeSelector.value as AttackKind;
    renderCard();
    markChanged();
  });

  qa<HTMLInputElement>('[data-transform]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.transform as keyof CardData['artworkTransform'];
      card.artworkTransform[key] = Number(input.value);
      updateRangeOutputs();
      renderCard();
      markChanged();
    });
  });

  qa<HTMLInputElement>('[data-compat-mode]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!isAttack(card) || !input.checked) return;
      card.compatibilityMode = input.value === 'type' ? 'type' : 'specific';
      updateAttackCompatibilityEditor();
      renderCard();
      markChanged();
    });
  });

  q<HTMLElement>('[data-role="selected-pokemon-list"]')?.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-remove-compatible]');
    if (!button || !isAttack(card)) return;
    const id = Number(button.dataset.removeCompatible);
    card.compatiblePokemon = card.compatiblePokemon.filter((pokemon) => pokemon.id !== id);
    renderCard();
    updateAttackCompatibilityEditor();
    markChanged();
  });

  pokemonSearchInput.addEventListener('input', () => {
    window.clearTimeout(pokemonSearchTimer);
    pokemonSearchTimer = window.setTimeout(handlePokemonSearchQuery, 260);
  });
  pokemonSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveSuggestion(pokemonSuggestions, 'pokemon', 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveSuggestion(pokemonSuggestions, 'pokemon', -1); }
    else if (event.key === 'Escape') hideSuggestions(pokemonSuggestions, pokemonSearchInput, 'pokemon');
    else if (event.key === 'Enter') {
      const buttons = qa<HTMLButtonElement>('.suggestion[data-pokemon-id]', pokemonSuggestions);
      event.preventDefault();
      if (!pokemonSuggestions.hidden && buttons.length) {
        const chosen = buttons[Math.max(0, pokemonSuggestionCursor)]!;
        selectPokemon(chosen.dataset.pokemonId || chosen.dataset.pokemonName || pokemonSearchInput.value, chosen.dataset.pokemonName || pokemonSearchInput.value);
      } else if (pokemonSearchInput.value.trim()) selectPokemon(pokemonSearchInput.value.trim(), pokemonSearchInput.value.trim());
    }
  });
  pokemonSearchInput.addEventListener('focus', () => { if (pokemonSearchInput.value.trim().length >= 2) handlePokemonSearchQuery(); });
  pokemonSuggestions.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-pokemon-id]');
    if (button) selectPokemon(button.dataset.pokemonId || button.dataset.pokemonName || '', button.dataset.pokemonName || '');
  });

  attackSearchInput.addEventListener('input', () => {
    window.clearTimeout(attackSearchTimer);
    attackSearchTimer = window.setTimeout(handleAttackSearchQuery, 260);
  });
  attackSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveSuggestion(attackSuggestions, 'attack', 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveSuggestion(attackSuggestions, 'attack', -1); }
    else if (event.key === 'Escape') hideSuggestions(attackSuggestions, attackSearchInput, 'attack');
    else if (event.key === 'Enter') {
      const buttons = qa<HTMLButtonElement>('.suggestion[data-pokemon-id]', attackSuggestions);
      event.preventDefault();
      if (!attackSuggestions.hidden && buttons.length) {
        const chosen = buttons[Math.max(0, attackSuggestionCursor)]!;
        addCompatiblePokemon(chosen.dataset.pokemonId || chosen.dataset.pokemonName || attackSearchInput.value);
      } else if (attackSearchInput.value.trim()) addCompatiblePokemon(attackSearchInput.value.trim());
    }
  });
  attackSuggestions.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-pokemon-id]');
    if (button) addCompatiblePokemon(button.dataset.pokemonId || button.dataset.pokemonName || '');
  });

  document.addEventListener('click', (event) => {
    if (!(event.target as Element).closest('.search-field')) {
      hideSuggestions(pokemonSuggestions, pokemonSearchInput, 'pokemon');
      hideSuggestions(attackSuggestions, attackSearchInput, 'attack');
    }
  });

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) readArtwork(file); });
  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.add('is-dragover'); }));
  ['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.remove('is-dragover'); }));
  dropzone.addEventListener('drop', (event) => { const file = event.dataTransfer?.files?.[0]; if (file) readArtwork(file); });
  q<HTMLButtonElement>('[data-action="replace-art"]')?.addEventListener('click', () => fileInput.click());
  tcgArtworkRefreshButton?.addEventListener('click', () => {
    if (isPokemon(card)) void preloadTcgArtworkSuggestions(card.pokemonName, true);
  });
  tcgArtworkSuggestions?.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-tcg-card-id]');
    if (!button || !isPokemon(card)) return;
    const candidate = tcgArtworkCandidates.find((item) => item.cardId === button.dataset.tcgCardId && item.provider === button.dataset.tcgProvider);
    if (!candidate) return;
    void applyTcgArtworkCandidate(candidate, card.pokemonName).catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : 'Não foi possível recortar essa carta.';
      tcgArtworkStatusOverride = `${message} Escolha outra sugestão ou use upload manual.`;
      updateTcgArtworkUI();
      toast(message, 'error');
    });
  });
  q<HTMLButtonElement>('[data-action="remove-art"]')?.addEventListener('click', () => {
    card.artwork = '';
    clearArtworkSourceMetadata('none');
    tcgArtworkStatusOverride = '';
    renderTcgArtworkSuggestions();
    card.artworkTransform = { scale: 1, x: 0, y: 0 };
    fileInput.value = '';
    syncFormFromState();
    renderCard();
    markChanged();
  });

  q<HTMLButtonElement>('[data-action="use-official-stats"]')?.addEventListener('click', () => {
    if (!reference.officialStats || !isPokemon(card)) return;
    Object.assign(card, reference.officialStats);
    syncFormFromState();
    renderCard();
    markChanged();
    toast('Valores oficiais aplicados à carta. Você ainda pode editá-los.');
  });
  q<HTMLInputElement>('[data-field="abilityName"]')?.addEventListener('change', handleAbilityChange);

  q<HTMLButtonElement>('[data-action="export"]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const old = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="button-icon">◌</span> Exportando…';
    try {
      await exportCardAsPng(getActiveCardNode(), card);
      toast('PNG exportado em 1260 × 1760 px.', 'success');
    } catch (error) {
      console.error(error);
      toast('A exportação falhou. Tente novamente após as imagens terminarem de carregar.', 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = old;
    }
  });

  q<HTMLElement>('[data-role="type-candidates"]')?.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-type-candidate]');
    if (!button || !isPokemon(card)) return;
    card.type = button.dataset.typeCandidate as GameType;
    setInputValue('type', card.type);
    updatePokemonTypeChoices(card.typeCandidates ?? []);
    renderCard();
    markChanged();
  });

  qa<HTMLButtonElement>('[data-action="create-collection"]').forEach((button) => button.addEventListener('click', () => {
    const createDialog = q<HTMLDialogElement>('[data-role="create-collection-dialog"]');
    const name = q<HTMLInputElement>('[data-role="new-collection-name"]');
    if (name) name.value = '';
    createDialog?.showModal();
    setTimeout(() => name?.focus(), 0);
  }));

  q<HTMLButtonElement>('[data-action="confirm-create-collection"]')?.addEventListener('click', async (event) => {
    event.preventDefault();
    const createDialog = q<HTMLDialogElement>('[data-role="create-collection-dialog"]');
    const form = q<HTMLFormElement>('[data-role="create-collection-form"]');
    const name = q<HTMLInputElement>('[data-role="new-collection-name"]')?.value.trim() ?? '';
    if (!name) { toast('Digite o nome da coleção.', 'error'); return; }
    const size = q<HTMLInputElement>('input[name="collection-size"]:checked', form ?? document)?.value === 'large' ? 'large' : 'normal';
    const collection = createCollection(name, size, workspace.collections);
    workspace.collections.push(collection);
    touchWorkspace(workspace);
    await saveWorkspaceLocal(workspace);
    createDialog?.close();
    renderHub();
    openCollection(collection.id);
    toast(`Coleção ${collection.code} criada.`, 'success');
  });

  q<HTMLElement>('[data-role="collections-grid"]')?.addEventListener('click', (event) => {
    const tile = (event.target as Element).closest<HTMLElement>('[data-open-collection]');
    if (tile?.dataset.openCollection) openCollection(tile.dataset.openCollection);
  });

  qa<HTMLButtonElement>('[data-action="go-hub"]').forEach((button) => button.addEventListener('click', async () => {
    if (activeCardId && dirty) await persistActiveCard(false).catch(() => undefined);
    showHub();
  }));

  qa<HTMLButtonElement>('[data-action="new-collection-card"]').forEach((button) => button.addEventListener('click', () => {
    const collection = currentCollection();
    if (!collection) return;
    renderNewCardChoices(collection);
    dialog?.showModal();
  }));
  q<HTMLButtonElement>('[data-action="cancel-new"]')?.addEventListener('click', () => dialog?.close());
  q<HTMLElement>('[data-role="new-card-category-grid"]')?.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-create-card-type]');
    if (!button || button.disabled) return;
    void createAndOpenCard(button.dataset.createCardType as CardType);
  });

  q<HTMLSelectElement>('[data-role="category-filter"]')?.addEventListener('change', () => {
    const collection = currentCollection();
    if (collection) renderCollectionCards(collection);
  });

  q<HTMLSelectElement>('[data-role="collection-size-select"]')?.addEventListener('change', async (event) => {
    const collection = currentCollection();
    if (!collection || collection.cards.length) { renderCollectionView(); return; }
    collection.size = (event.currentTarget as HTMLSelectElement).value === 'large' ? 'large' : 'normal';
    collection.updatedAt = new Date().toISOString();
    touchWorkspace(workspace);
    await saveWorkspaceLocal(workspace);
    renderCollectionView();
    toast(`Coleção alterada para ${collection.size === 'large' ? 'Grande' : 'Normal'}.`, 'success');
  });

  q<HTMLElement>('[data-role="collection-card-grid"]')?.addEventListener('click', (event) => {
    const deleteButton = (event.target as Element).closest<HTMLButtonElement>('[data-delete-card]');
    if (deleteButton?.dataset.deleteCard) {
      pendingDeleteCardId = deleteButton.dataset.deleteCard;
      q<HTMLDialogElement>('[data-role="delete-card-dialog"]')?.showModal();
      return;
    }
    const zoom = (event.target as Element).closest<HTMLElement>('[data-zoom-card]');
    if (zoom?.dataset.zoomCard) {
      openCardZoom(zoom.dataset.zoomCard);
      return;
    }
    const open = (event.target as Element).closest<HTMLElement>('[data-open-card]');
    if (open?.dataset.openCard) openStoredCard(open.dataset.openCard);
  });

  q<HTMLButtonElement>('[data-action="close-card-zoom"]')?.addEventListener('click', closeCardZoom);
  q<HTMLButtonElement>('[data-action="edit-zoom-card"]')?.addEventListener('click', () => {
    const id = activeZoomCardId;
    closeCardZoom();
    if (id) openStoredCard(id);
  });
  q<HTMLDialogElement>('[data-role="card-zoom-dialog"]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeCardZoom();
  });
  q<HTMLDialogElement>('[data-role="card-zoom-dialog"]')?.addEventListener('close', () => { activeZoomCardId = null; });

  q<HTMLButtonElement>('[data-action="cancel-delete-card"]')?.addEventListener('click', () => {
    pendingDeleteCardId = null;
    q<HTMLDialogElement>('[data-role="delete-card-dialog"]')?.close();
  });
  q<HTMLButtonElement>('[data-action="confirm-delete-card"]')?.addEventListener('click', async () => {
    const collection = currentCollection();
    if (!collection || !pendingDeleteCardId) return;
    deleteCard(collection, pendingDeleteCardId);
    pendingDeleteCardId = null;
    touchWorkspace(workspace);
    await saveWorkspaceLocal(workspace);
    q<HTMLDialogElement>('[data-role="delete-card-dialog"]')?.close();
    renderCollectionView();
    toast('Carta excluída e coleção renumerada.', 'success');
  });

  qa<HTMLButtonElement>('[data-action="back-to-collection"]').forEach((button) => button.addEventListener('click', async () => {
    if (activeCardId) await persistActiveCard(false).catch(() => undefined);
    renderCollectionView();
    setAppView('collection');
  }));
  q<HTMLButtonElement>('[data-action="save-card"]')?.addEventListener('click', async () => { await persistActiveCard(true).catch(() => undefined); });
  q<HTMLButtonElement>('[data-action="export-content"]')?.addEventListener('click', exportContentZip);

  bindArtworkDragging();
  const resizeObserver = new ResizeObserver(fitPreview);
  resizeObserver.observe(previewStage);
  fitPreview();

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
  });
}

async function init() {
  bindEvents();
  setEditorMode('essential');
  setReferenceStats();
  setAbilitySuggestions();
  await bootstrapWorkspace();
  syncFormFromState();
  renderCard();
  setAppView('hub');
}

init();
