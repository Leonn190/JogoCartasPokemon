import { ATTACK_KIND_META, CARD_CATEGORY_META } from '../data/cardCategories';
import { DEFAULT_ATTACK_CARD, DEFAULT_POKEMON_CARD, EMPTY_POKEMON_CARD, createChampionCard, createEmptyCard, createUtilityCard } from '../data/defaultCard';
import { exportCardAsPng } from '../lib/exportCard';
import { getPokemonIndex, loadAbilityDescription, loadPokemonEditorData, loadPokemonSummary } from '../lib/pokeapi';
import { TYPE_META, titleCasePokemon } from '../lib/pokemonMapping';
import { clearDraft, loadDraft, saveDraft } from '../lib/storage';
import { CARD_FORMS, CARD_TYPE_LABELS, POKEMON_RARITY_LABELS } from '../types/card';
import type {
  AttackCardData,
  AttackKind,
  CardData,
  CardType,
  ChampionCardData,
  EditorReferenceData,
  GameType,
  PokemonCardData,
  PokemonForm,
  PokemonRarity,
  TrainerCardType,
  UtilityCardData,
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
let saveTimer = 0;
let pokemonSearchTimer = 0;
let attackSearchTimer = 0;
let pokemonSuggestionCursor = -1;
let attackSuggestionCursor = -1;
let dirty = false;

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

function isPokemon(value: CardData = card): value is PokemonCardData { return value.cardType === 'pokemon'; }
function isAttack(value: CardData = card): value is AttackCardData { return value.cardType === 'attack'; }
function isChampion(value: CardData = card): value is ChampionCardData { return value.cardType === 'champion'; }
function isUtility(value: CardData = card): value is UtilityCardData { return !isPokemon(value) && !isAttack(value) && !isChampion(value); }

function slotForCard(value: CardData = card) {
  if (value.cardType === 'pokemon') return 'pokemon';
  if (value.cardType === 'attack') return 'attack';
  if (value.cardType === 'champion') return 'champion';
  return 'utility';
}

type CardFamily = 'pokemon' | 'trainer' | 'attack';

function familyForCard(value: CardData = card): CardFamily {
  if (value.cardType === 'pokemon') return 'pokemon';
  if (value.cardType === 'attack') return 'attack';
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

function toast(message: string, kind: 'success' | 'error' | 'neutral' = 'neutral') {
  const region = q<HTMLElement>('[data-role="toast-region"]');
  if (!region) return;
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  item.textContent = message;
  region.appendChild(item);
  window.setTimeout(() => item.remove(), 3300);
}

function setTextIn(root: ParentNode, role: string, value: string | number) {
  qa<HTMLElement>(`[data-role="${role}"]`, root).forEach((node) => { node.textContent = String(value); });
}

function setInputValue(field: string, value: unknown) {
  qa<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-field="${field}"]`).forEach((input) => {
    if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value);
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
  syncTypeSelectorUI();
  const previewTitle = q<HTMLElement>('[data-role="preview-title"]');
  if (previewTitle) {
    if (isPokemon(card)) previewTitle.textContent = `Carta Pokémon — ${card.form}`;
    else if (isAttack(card)) previewTitle.textContent = `Carta Ataque — ${card.attackKind === 'special' ? 'Especial' : 'Normal'}`;
    else previewTitle.textContent = `Carta Treinador — ${CARD_TYPE_LABELS[card.cardType]}`;
  }
}

function syncFormFromState() {
  updateEditorVisibility();
  setInputValue('cardNumber', card.cardNumber);
  setInputValue('setCode', card.setCode);

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
  } else if (isAttack(card)) {
    setInputValue('attackName', card.attackName);
    setInputValue('attackDescription', card.attackDescription);
    setInputValue('power', card.power);
    setInputValue('type', card.type);
    setInputValue('compatibleType', card.compatibleType);
    const compatibilityMode = card.compatibilityMode;
    qa<HTMLInputElement>('[data-compat-mode]').forEach((input) => { input.checked = input.value === compatibilityMode; });
  } else if (isChampion(card)) {
    const fields: Array<keyof ChampionCardData> = [
      'name', 'victoryCondition', 'defeatCondition', 'passiveName', 'passiveDescription',
      'initialAbilityName', 'initialAbilityDescription', 'initialPokemonCount', 'initialAttackCount', 'initialTrainerCount',
    ];
    fields.forEach((field) => setInputValue(String(field), card[field]));
  } else {
    setInputValue('name', card.name);
    setInputValue('effectText', card.effectText);
    setInputValue('usageText', card.usageText);
  }

  updateRangeOutputs();
  updateAttackCompatibilityEditor();
  updateAttackDescriptionCount();
}

function applyArtworkToNode(node: HTMLElement) {
  node.style.setProperty('--art-scale', String(card.artworkTransform.scale));
  node.style.setProperty('--art-x', String(card.artworkTransform.x));
  node.style.setProperty('--art-y', String(card.artworkTransform.y));
  qa<HTMLElement>('[data-role="artwork-frame"]', node).forEach((frame) => frame.classList.toggle('has-artwork', Boolean(card.artwork)));
  qa<HTMLImageElement>('[data-role="artwork-image"]', node).forEach((image) => { image.src = card.artwork || ''; });
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

  setTextIn(node, 'pokemon-name', value.pokemonName || 'Novo Pokémon');
  setTextIn(node, 'form-mark', value.form);
  q<HTMLElement>('[data-role="form-mark"]', node)?.classList.toggle('is-normal', value.form === 'Normal');
  setTextIn(node, 'stage', value.stage);
  setTextIn(node, 'previous-name', value.previousEvolution || '');
  setTextIn(node, 'type-symbol', meta.symbol);
  setTypeIcon(node, 'type-icon', meta.icon);
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
  previousWrap?.classList.toggle('is-empty', !value.previousEvolution);
  if (previousImage) {
    previousImage.src = value.previousEvolutionImage || '';
    previousImage.alt = value.previousEvolution ? `Pré-evolução ${value.previousEvolution}` : '';
  }

  const expandedImage = q<HTMLImageElement>('[data-role="expanded-image"]', node);
  if (expandedImage) expandedImage.src = value.artwork || '';
}

function renderUtility(node: HTMLElement, value: UtilityCardData) {
  const meta = CARD_CATEGORY_META[value.cardType];
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

function renderChampion(node: HTMLElement, value: ChampionCardData) {
  const meta = CARD_CATEGORY_META.champion;
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
  setTextIn(node, 'champion-initial-ability-name', value.initialAbilityName);
  setTextIn(node, 'champion-initial-ability-description', value.initialAbilityDescription);
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
    setTextIn(node, 'compatible-type-symbol', meta.symbol);
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
    : '<div class="compatibility-empty">Selecione até 10 Pokémon no editor</div>';

  qa<HTMLImageElement>('img', grid).forEach((image) => {
    image.addEventListener('error', () => {
      const wrapper = image.parentElement;
      if (wrapper) wrapper.textContent = '✦';
    }, { once: true });
  });
}

function renderAttack(node: HTMLElement, value: AttackCardData) {
  const meta = ATTACK_KIND_META[value.attackKind];
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
  setTextIn(node, 'attack-type-symbol', attackTypeMeta.symbol);
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
  else if (isChampion(card)) renderChampion(node, card);
  else renderUtility(node, card);
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
    if (count) count.textContent = '0/10';
    return;
  }
  if (specific) specific.hidden = card.compatibilityMode !== 'specific';
  if (byType) byType.hidden = card.compatibilityMode !== 'type';
  if (count) count.textContent = `${card.compatiblePokemon.length}/10`;
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

function markChanged() {
  dirty = true;
  autosaveStatus?.classList.add('is-saving');
  if (autosaveStatus) autosaveStatus.innerHTML = '<i></i> Salvando…';
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      await saveDraft(card);
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
    const rarity = normalizePokemonRarityForForm(raw.rarity || (form === 'Normal' ? 'common' : 'ultraRare'), form);
    return {
      ...cloneCard(DEFAULT_POKEMON_CARD),
      ...restored,
      cardType: 'pokemon',
      form,
      rarity,
      hp: normalizeStat(restored.hp, 300),
      attack: normalizeStat(restored.attack),
      defense: normalizeStat(restored.defense),
      specialAttack: normalizeStat(restored.specialAttack),
      specialDefense: normalizeStat(restored.specialDefense),
      speed: normalizeStat(restored.speed),
      setTotal: Number(restored.setTotal) || 150,
      artworkTransform: { ...DEFAULT_POKEMON_CARD.artworkTransform, ...restored.artworkTransform },
    };
  }
  if (restored.cardType === 'attack') {
    return {
      ...cloneCard(DEFAULT_ATTACK_CARD),
      ...restored,
      cardType: 'attack',
      power: [0, 50, 100, 150, 200].includes(Number(restored.power)) ? restored.power : 100,
      type: restored.type || 'Água',
      setTotal: Number(restored.setTotal) || 150,
      compatiblePokemon: Array.isArray(restored.compatiblePokemon) ? restored.compatiblePokemon.slice(0, 10) : [],
      artworkTransform: { ...DEFAULT_ATTACK_CARD.artworkTransform, ...restored.artworkTransform },
    };
  }
  if (restored.cardType === 'champion') {
    const base = createChampionCard();
    return {
      ...base,
      ...restored,
      cardType: 'champion',
      setTotal: Number(restored.setTotal) || 150,
      artworkTransform: { ...base.artworkTransform, ...restored.artworkTransform },
    };
  }
  const base = createUtilityCard(restored.cardType);
  return {
    ...base,
    ...restored,
    cardType: restored.cardType,
    usageText: base.usageText,
    setTotal: Number(restored.setTotal) || 150,
    artworkTransform: { ...base.artworkTransform, ...restored.artworkTransform },
  };
}

function applyState(next: CardData, syncForm = true) {
  card = cloneCard(next);
  if (isPokemon(card)) naturalStage = card.form === 'Normal' ? card.stage : naturalStage;
  if (syncForm) syncFormFromState();
  renderCard();
}

async function restoreDraft() {
  const restored = await loadDraft();
  if (!restored) return;
  const merged = mergeDraft(restored);
  cardCache[merged.cardType] = cloneCard(merged);
  applyState(merged);
  toast('Último rascunho restaurado.', 'success');
}

function applyPokemonForm(form: PokemonForm) {
  if (!isPokemon(card)) return;
  card.form = form;
  card.rarity = normalizePokemonRarityForForm(card.rarity, form);
  if (form !== 'Normal') card.stage = 'FINAL';
  else card.stage = naturalStage;
  setInputValue('stage', card.stage);
  setInputValue('rarity', card.rarity);
  pokemonSubtypeSelector.value = card.form;
  renderCard();
  markChanged();
}

function updateField(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  const field = input.dataset.field;
  if (!field) return;
  if (!(field in card)) return;

  if (field === 'form' && isPokemon(card)) {
    applyPokemonForm(input.value as PokemonForm);
    return;
  }

  let value: unknown = input.value;
  if (input instanceof HTMLInputElement && input.type === 'checkbox') value = input.checked;
  else if (input instanceof HTMLInputElement && input.type === 'number') value = input.value === '' ? 0 : Number(input.value);

  if (field === 'setCode') {
    value = String(value).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8);
    input.value = String(value);
  }
  if (field === 'cardNumber') value = clamp(Number(value) || 1, 1, 150);
  if (field === 'pokedexNumber') value = Number(value) || null;
  if (['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'].includes(field)) {
    value = normalizeStat(Number(value), field === 'hp' ? 300 : Number.POSITIVE_INFINITY);
    input.value = String(value);
  }
  if (field === 'power' && isAttack(card)) {
    const candidate = Number(value);
    value = ([0, 50, 100, 150, 200].includes(candidate) ? candidate : 100);
  }
  if (['initialPokemonCount', 'initialAttackCount', 'initialTrainerCount'].includes(field) && isChampion(card)) {
    value = clamp(Math.round(Number(value) || 0), 0, 12);
    input.value = String(value);
  }

  (card as unknown as Record<string, unknown>)[field] = value;

  if (isPokemon(card) && field === 'rarity') {
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

async function selectPokemon(identifier: string | number) {
  if (!isPokemon(card)) return;
  hideSuggestions(pokemonSuggestions, pokemonSearchInput, 'pokemon');
  pokemonSearchAbort?.abort();
  pokemonSearchAbort = new AbortController();
  pokemonSearchControl.classList.add('is-loading');
  getActiveCardNode().classList.add('is-api-loading');
  apiStatus.textContent = 'Consultando PokéAPI, espécie e cadeia evolutiva…';

  try {
    const data = await loadPokemonEditorData(identifier, pokemonSearchAbort.signal);
    if (!isPokemon(card)) return;
    const p = data.pokemon;
    naturalStage = p.stage;
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
    });
    if (p.suggestedType) card.type = p.suggestedType;

    reference.officialStats = data.officialStats;
    reference.abilities = data.abilities;
    setReferenceStats();
    setAbilitySuggestions();
    syncFormFromState();
    renderCard();
    pokemonSearchInput.value = p.pokemonName;
    apiStatus.textContent = p.suggestedType
      ? `Dados carregados. Tipo ${p.suggestedType} sugerido a partir da PokéAPI.`
      : 'Dados carregados. O tipo ficou para você escolher por ser um caso ambíguo.';
    const typeSuggestion = q<HTMLElement>('[data-role="type-suggestion"]');
    if (typeSuggestion) typeSuggestion.textContent = p.suggestedType ? `Sugestão da API: ${p.suggestedType}` : 'Tipo oficial ambíguo: escolha manualmente.';
    markChanged();
    toast(`${p.pokemonName} carregado pela PokéAPI.`, 'success');
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
  if (card.compatiblePokemon.length >= 10) {
    toast('O limite é de 10 Pokémon compatíveis.', 'error');
    return;
  }
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

  scaleBox.addEventListener('pointerdown', (event) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-role="artwork-drag-surface"]');
    if (!target || !getActiveCardNode().contains(target) || !card.artwork) return;
    surface = target;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    baseX = card.artworkTransform.x;
    baseY = card.artworkTransform.y;
    target.setPointerCapture(pointerId);
  });

  scaleBox.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId || !surface) return;
    const rect = surface.getBoundingClientRect();
    card.artworkTransform.x = clamp(baseX + ((event.clientX - startX) / Math.max(1, rect.width)) * 100, -50, 50);
    card.artworkTransform.y = clamp(baseY + ((event.clientY - startY) / Math.max(1, rect.height)) * 100, -50, 50);
    qa<HTMLInputElement>('[data-transform="x"]').forEach((input) => { input.value = String(Math.round(card.artworkTransform.x)); });
    qa<HTMLInputElement>('[data-transform="y"]').forEach((input) => { input.value = String(Math.round(card.artworkTransform.y)); });
    updateRangeOutputs();
    renderCard();
  });

  const end = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    surface = null;
    markChanged();
  };
  scaleBox.addEventListener('pointerup', end);
  scaleBox.addEventListener('pointercancel', end);
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
  pokemonSearchAbort?.abort();
  attackPokemonAbort?.abort();
  cardCache[card.cardType] = cloneCard(card);
  const next = cardCache[nextType] ? cloneCard(cardCache[nextType]!) : createEmptyCard(nextType);
  if (nextType === 'pokemon' && next.cardType === 'pokemon') naturalStage = next.stage;
  applyState(next);
  markChanged();
}

function bindEvents() {
  qa<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-field]').forEach((input) => {
    input.addEventListener('input', () => updateField(input));
  });

  cardFamilySelector.addEventListener('change', () => {
    const family = cardFamilySelector.value as CardFamily;
    if (family === 'pokemon') switchCardType('pokemon');
    else if (family === 'attack') switchCardType('attack');
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
        selectPokemon(chosen.dataset.pokemonId || chosen.dataset.pokemonName || pokemonSearchInput.value);
      } else if (pokemonSearchInput.value.trim()) selectPokemon(pokemonSearchInput.value.trim());
    }
  });
  pokemonSearchInput.addEventListener('focus', () => { if (pokemonSearchInput.value.trim().length >= 2) handlePokemonSearchQuery(); });
  pokemonSuggestions.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-pokemon-id]');
    if (button) selectPokemon(button.dataset.pokemonId || button.dataset.pokemonName || '');
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
  q<HTMLButtonElement>('[data-action="remove-art"]')?.addEventListener('click', () => {
    card.artwork = '';
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

  q<HTMLButtonElement>('[data-action="save-now"]')?.addEventListener('click', async () => {
    await saveDraft(card);
    dirty = false;
    toast('Rascunho salvo localmente.', 'success');
  });

  q<HTMLButtonElement>('[data-action="new-card"]')?.addEventListener('click', () => {
    if (dirty && dialog?.showModal) dialog.showModal();
    else resetToNewCard();
  });
  q<HTMLButtonElement>('[data-action="cancel-new"]')?.addEventListener('click', () => dialog?.close());
  q<HTMLButtonElement>('[data-action="confirm-new"]')?.addEventListener('click', async () => { dialog?.close(); await resetToNewCard(); });

  bindArtworkDragging();
  const resizeObserver = new ResizeObserver(fitPreview);
  resizeObserver.observe(previewStage);
  fitPreview();

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
  });
}

async function resetToNewCard() {
  const type = card.cardType;
  await clearDraft();
  cardCache = {};
  reference = { officialStats: null, abilities: [] };
  naturalStage = 'BÁSICO';
  pokemonSearchInput.value = '';
  attackSearchInput.value = '';
  apiStatus.textContent = 'Pesquise um Pokémon ou preencha tudo manualmente.';
  attackApiStatus.textContent = 'Máximo de 10 Pokémon. Duplicatas são ignoradas.';
  setReferenceStats();
  setAbilitySuggestions();
  applyState(type === 'pokemon' ? cloneCard(EMPTY_POKEMON_CARD) : createEmptyCard(type));
  dirty = false;
  toast('Nova carta iniciada.');
}

async function init() {
  bindEvents();
  setReferenceStats();
  setAbilitySuggestions();
  await restoreDraft();
  syncFormFromState();
  renderCard();
  fitPreview();
}

init();
