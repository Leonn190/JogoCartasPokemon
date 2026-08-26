import { DEFAULT_CARD, EMPTY_CARD } from '../data/defaultCard';
import { exportCardAsPng } from '../lib/exportCard';
import { loadAbilityDescription, getPokemonIndex, loadPokemonEditorData } from '../lib/pokeapi';
import { TYPE_META, titleCasePokemon } from '../lib/pokemonMapping';
import { clearDraft, loadDraft, saveDraft } from '../lib/storage';
import type { EditorReferenceData, PokemonCardData, PokemonForm } from '../types/card';

const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const qa = <T extends Element = HTMLElement>(selector: string) => Array.from(document.querySelectorAll<T>(selector));

let card: PokemonCardData = structuredClone(DEFAULT_CARD);
let reference: EditorReferenceData = { officialStats: null, abilities: [] };
let naturalStage = card.stage;
let pokemonIndex: Array<{ name: string; id: number }> | null = null;
let searchAbort: AbortController | null = null;
let abilityAbort: AbortController | null = null;
let saveTimer = 0;
let searchTimer = 0;
let suggestionCursor = -1;
let dirty = false;

const cardNode = q<HTMLElement>('[data-role="pokemon-card"]')!;
const scaleBox = q<HTMLElement>('.card-scale-box')!;
const previewStage = q<HTMLElement>('.preview-stage')!;
const searchInput = q<HTMLInputElement>('[data-role="pokemon-search"]')!;
const suggestionsNode = q<HTMLElement>('[data-role="pokemon-suggestions"]')!;
const searchControl = q<HTMLElement>('[data-role="search-control"]')!;
const apiStatus = q<HTMLElement>('[data-role="api-status"]')!;
const autosaveStatus = q<HTMLElement>('[data-role="autosave-status"]')!;
const fileInput = q<HTMLInputElement>('[data-role="artwork-file"]')!;
const dropzone = q<HTMLElement>('[data-role="dropzone"]')!;
const dialog = q<HTMLDialogElement>('[data-role="new-card-dialog"]');

function cloneCard(value: PokemonCardData): PokemonCardData {
  return JSON.parse(JSON.stringify(value)) as PokemonCardData;
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

function setText(role: string, value: string | number) {
  const node = q<HTMLElement>(`[data-role="${role}"]`);
  if (node) node.textContent = String(value);
}

function setInputValue(field: keyof PokemonCardData, value: unknown) {
  const input = q<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-field="${String(field)}"]`);
  if (!input) return;
  if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value);
  else input.value = String(value ?? '');
}

function syncFormFromState() {
  const simpleFields: Array<keyof PokemonCardData> = [
    'pokemonName', 'form', 'type', 'stage', 'previousEvolution', 'previousEvolutionImage',
    'pokedexNumber', 'genus', 'height', 'weight', 'region', 'hp', 'attack', 'defense',
    'specialAttack', 'specialDefense', 'speed', 'abilityName', 'abilityDescription', 'flavorText',
    'cardNumber', 'setCode', 'expandedArtwork',
  ];
  simpleFields.forEach((field) => setInputValue(field, card[field]));
  qa<HTMLInputElement>('[data-transform]').forEach((input) => {
    const key = input.dataset.transform as keyof PokemonCardData['artworkTransform'];
    input.value = String(card.artworkTransform[key]);
  });
  updateRangeOutputs();
  updateLegendaryAvailability();
}

function renderCard() {
  const meta = TYPE_META[card.type];
  cardNode.style.setProperty('--type', meta.color);
  cardNode.style.setProperty('--type-deep', meta.deep);
  cardNode.style.setProperty('--type-light', meta.light);
  cardNode.style.setProperty('--art-scale', String(card.artworkTransform.scale));
  cardNode.style.setProperty('--art-x', String(card.artworkTransform.x));
  cardNode.style.setProperty('--art-y', String(card.artworkTransform.y));
  cardNode.dataset.form = card.form;
  cardNode.dataset.expanded = String(card.expandedArtwork);
  cardNode.classList.toggle('is-expanded', card.expandedArtwork);

  setText('pokemon-name', card.pokemonName || 'Novo Pokémon');
  setText('form-mark', card.form);
  q<HTMLElement>('[data-role="form-mark"]')?.classList.toggle('is-normal', card.form === 'Normal');
  setText('stage', card.stage);
  setText('previous-label', card.previousEvolution ? 'Evolui de' : 'Primeira forma');
  setText('previous-name', card.previousEvolution || 'Sem pré-evolução');
  setText('type-symbol', meta.symbol);
  setText('type-name', card.type);
  setText('dex-number', `#${String(card.pokedexNumber ?? 0).padStart(4, '0')}`);
  setText('genus', card.genus || 'Pokémon');
  setText('height', card.height || '—');
  setText('weight', card.weight || '—');
  setText('region', card.region || '—');
  setText('stat-hp', card.hp);
  setText('stat-attack', card.attack);
  setText('stat-defense', card.defense);
  setText('stat-specialAttack', card.specialAttack);
  setText('stat-specialDefense', card.specialDefense);
  setText('stat-speed', card.speed);
  setText('ability-name', card.abilityName || 'Habilidade');
  setText('ability-description', card.abilityDescription || 'Escreva o efeito da habilidade.');
  setText('flavor-text', card.flavorText || 'Adicione uma breve descrição para o rodapé da carta.');
  setText('card-number', String(card.cardNumber || 0).padStart(3, '0'));
  setText('set-total', card.setTotal);
  setText('set-code', (card.setCode || 'SET').toUpperCase());

  const previousWrap = q<HTMLElement>('[data-role="previous-wrap"]');
  const previousImage = q<HTMLImageElement>('[data-role="previous-image"]');
  if (previousWrap) previousWrap.classList.toggle('is-empty', !card.previousEvolution);
  if (previousImage) {
    previousImage.src = card.previousEvolutionImage || '';
    previousImage.alt = card.previousEvolution ? `Pré-evolução ${card.previousEvolution}` : '';
  }

  const artFrame = q<HTMLElement>('[data-role="artwork-frame"]');
  const artImage = q<HTMLImageElement>('[data-role="artwork-image"]');
  const expandedImage = q<HTMLImageElement>('[data-role="expanded-image"]');
  artFrame?.classList.toggle('has-artwork', Boolean(card.artwork));
  if (artImage) artImage.src = card.artwork || '';
  if (expandedImage) expandedImage.src = card.artwork || '';

  updateLegendaryAvailability();
}

function updateLegendaryAvailability() {
  const legendary = q<HTMLOptionElement>('option[data-legendary-option="true"]');
  const hint = q<HTMLElement>('[data-role="legendary-hint"]');
  if (legendary) {
    legendary.disabled = !card.isLegendary;
    legendary.title = card.isLegendary ? '' : 'Disponível apenas para Pokémon lendários';
  }
  hint?.classList.toggle('is-visible', !card.isLegendary);
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

function applyState(next: PokemonCardData, syncForm = true) {
  card = cloneCard(next);
  if (syncForm) syncFormFromState();
  renderCard();
}

async function restoreDraft() {
  const restored = await loadDraft();
  if (!restored) {
    renderCard();
    return;
  }
  applyState({ ...cloneCard(DEFAULT_CARD), ...restored, artworkTransform: { ...DEFAULT_CARD.artworkTransform, ...restored.artworkTransform } });
  toast('Último rascunho restaurado.', 'success');
}

function updateField(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  const field = input.dataset.field as keyof PokemonCardData | undefined;
  if (!field) return;

  let value: unknown = input.value;
  if (input instanceof HTMLInputElement && input.type === 'checkbox') value = input.checked;
  else if (input instanceof HTMLInputElement && input.type === 'number') value = input.value === '' ? 0 : Number(input.value);

  if (field === 'setCode') {
    value = String(value).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8);
    input.value = String(value);
  }
  if (field === 'cardNumber') value = clamp(Number(value) || 0, 0, 150);
  if (field === 'pokedexNumber') value = Number(value) || null;
  if (['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'].includes(field)) value = Math.max(0, Math.round(Number(value) || 0));

  (card as unknown as Record<string, unknown>)[field] = value;

  if (field === 'form') {
    const form = value as PokemonForm;
    if (form === 'Lendário' && !card.isLegendary) {
      card.form = 'Normal';
      input.value = 'Normal';
      toast('Forma Lendário só é liberada para espécies lendárias.', 'error');
    } else if (form !== 'Normal') {
      card.stage = 'FINAL';
      setInputValue('stage', card.stage);
    } else {
      card.stage = naturalStage;
      setInputValue('stage', card.stage);
    }
  }

  renderCard();
  markChanged();
}

async function ensurePokemonIndex() {
  if (pokemonIndex) return pokemonIndex;
  searchControl.classList.add('is-loading');
  try {
    pokemonIndex = await getPokemonIndex();
    return pokemonIndex;
  } finally {
    searchControl.classList.remove('is-loading');
  }
}

function hideSuggestions() {
  suggestionsNode.hidden = true;
  suggestionsNode.innerHTML = '';
  suggestionCursor = -1;
  searchInput.setAttribute('aria-expanded', 'false');
}

function showSuggestions(items: Array<{ name: string; id: number }>) {
  suggestionCursor = -1;
  if (!items.length) {
    suggestionsNode.innerHTML = '<div class="suggestion"><span>Nenhuma correspondência</span></div>';
  } else {
    suggestionsNode.innerHTML = items.map((item) => `<button type="button" class="suggestion" role="option" data-pokemon-id="${item.id}" data-pokemon-name="${escapeHtml(item.name)}"><strong>${escapeHtml(titleCasePokemon(item.name))}</strong><span>#${String(item.id).padStart(4, '0')}</span></button>`).join('');
  }
  suggestionsNode.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}

async function handleSearchQuery() {
  const term = searchInput.value.trim().toLowerCase();
  if (!term) return hideSuggestions();
  if (/^\d+$/.test(term)) {
    showSuggestions([{ name: `Pokémon #${term}`, id: Number(term) }]);
    return;
  }
  if (term.length < 2) return hideSuggestions();

  try {
    const index = await ensurePokemonIndex();
    const starts = index.filter((item) => item.name.startsWith(term));
    const contains = index.filter((item) => !item.name.startsWith(term) && item.name.includes(term));
    showSuggestions([...starts, ...contains].slice(0, 9));
  } catch {
    apiStatus.textContent = 'Não foi possível carregar as sugestões. Você ainda pode preencher tudo manualmente.';
    hideSuggestions();
  }
}

async function selectPokemon(identifier: string | number) {
  hideSuggestions();
  searchAbort?.abort();
  searchAbort = new AbortController();
  searchControl.classList.add('is-loading');
  cardNode.classList.add('is-api-loading');
  apiStatus.textContent = 'Consultando PokéAPI, espécie e cadeia evolutiva…';

  try {
    const data = await loadPokemonEditorData(identifier, searchAbort.signal);
    const p = data.pokemon;
    naturalStage = p.stage;
    card.pokemonId = p.pokemonId;
    card.pokemonName = p.pokemonName;
    card.pokedexNumber = p.pokedexNumber;
    card.height = p.height;
    card.weight = p.weight;
    card.genus = p.genus;
    card.flavorText = p.flavorText;
    card.region = p.region;
    card.previousEvolution = p.previousEvolution;
    card.previousEvolutionImage = p.previousEvolutionImage;
    card.isLegendary = p.isLegendary;
    card.isMythical = p.isMythical;
    card.stage = card.form === 'Normal' ? p.stage : 'FINAL';
    if (p.suggestedType) card.type = p.suggestedType;
    if (card.form === 'Lendário' && !p.isLegendary) card.form = 'Normal';

    reference.officialStats = data.officialStats;
    reference.abilities = data.abilities;
    setReferenceStats();
    setAbilitySuggestions();
    syncFormFromState();
    renderCard();
    searchInput.value = p.pokemonName;
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
    searchControl.classList.remove('is-loading');
    cardNode.classList.remove('is-api-loading');
  }
}

function moveSuggestion(delta: number) {
  const buttons = qa<HTMLButtonElement>('.suggestion[data-pokemon-id]');
  if (!buttons.length) return;
  suggestionCursor = (suggestionCursor + delta + buttons.length) % buttons.length;
  buttons.forEach((button, index) => button.classList.toggle('is-active', index === suggestionCursor));
  buttons[suggestionCursor]?.scrollIntoView({ block: 'nearest' });
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
  const input = q<HTMLInputElement>('[data-field="abilityName"]');
  if (!input) return;
  const match = reference.abilities.find((item) => item.name.toLowerCase() === input.value.trim().toLowerCase());
  if (!match) return;
  abilityAbort?.abort();
  abilityAbort = new AbortController();
  try {
    const description = await loadAbilityDescription(match.url, abilityAbort.signal);
    if (!description) return;
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
  const surface = q<HTMLElement>('[data-role="artwork-drag-surface"]');
  if (!surface) return;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let baseY = 0;

  surface.addEventListener('pointerdown', (event) => {
    if (!card.artwork) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    baseX = card.artworkTransform.x;
    baseY = card.artworkTransform.y;
    surface.setPointerCapture(pointerId);
  });
  surface.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) return;
    const rect = surface.getBoundingClientRect();
    card.artworkTransform.x = clamp(baseX + ((event.clientX - startX) / rect.width) * 100, -50, 50);
    card.artworkTransform.y = clamp(baseY + ((event.clientY - startY) / rect.height) * 100, -50, 50);
    const xInput = q<HTMLInputElement>('[data-transform="x"]');
    const yInput = q<HTMLInputElement>('[data-transform="y"]');
    if (xInput) xInput.value = String(Math.round(card.artworkTransform.x));
    if (yInput) yInput.value = String(Math.round(card.artworkTransform.y));
    updateRangeOutputs();
    renderCard();
  });
  const end = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    markChanged();
  };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);
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

function bindEvents() {
  qa<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-field]').forEach((input) => {
    input.addEventListener('input', () => updateField(input));
  });

  qa<HTMLInputElement>('[data-transform]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.transform as keyof PokemonCardData['artworkTransform'];
      card.artworkTransform[key] = Number(input.value);
      updateRangeOutputs();
      renderCard();
      markChanged();
    });
  });

  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(handleSearchQuery, 260);
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveSuggestion(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveSuggestion(-1); }
    else if (event.key === 'Escape') hideSuggestions();
    else if (event.key === 'Enter') {
      const buttons = qa<HTMLButtonElement>('.suggestion[data-pokemon-id]');
      if (!suggestionsNode.hidden && buttons.length) {
        event.preventDefault();
        const chosen = buttons[Math.max(0, suggestionCursor)]!;
        selectPokemon(chosen.dataset.pokemonId || chosen.dataset.pokemonName || searchInput.value);
      } else if (searchInput.value.trim()) {
        event.preventDefault();
        selectPokemon(searchInput.value.trim());
      }
    }
  });
  searchInput.addEventListener('focus', () => { if (searchInput.value.trim().length >= 2) handleSearchQuery(); });
  suggestionsNode.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-pokemon-id]');
    if (button) selectPokemon(button.dataset.pokemonId || button.dataset.pokemonName || '');
  });
  document.addEventListener('click', (event) => {
    if (!(event.target as Element).closest('.search-field')) hideSuggestions();
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
    syncFormFromState(); renderCard(); markChanged();
  });

  q<HTMLButtonElement>('[data-action="use-official-stats"]')?.addEventListener('click', () => {
    if (!reference.officialStats) return;
    Object.assign(card, reference.officialStats);
    syncFormFromState(); renderCard(); markChanged();
    toast('Valores oficiais aplicados à carta. Você ainda pode editá-los.');
  });
  q<HTMLInputElement>('[data-field="abilityName"]')?.addEventListener('change', handleAbilityChange);

  q<HTMLButtonElement>('[data-action="export"]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const old = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="button-icon">◌</span> Exportando…';
    try {
      await exportCardAsPng(cardNode, card);
      toast('PNG exportado em 1260 × 1760 px.', 'success');
    } catch (error) {
      console.error(error);
      toast('A exportação falhou. Tente novamente após a imagem terminar de carregar.', 'error');
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
  await clearDraft();
  reference = { officialStats: null, abilities: [] };
  naturalStage = 'BÁSICO';
  searchInput.value = '';
  apiStatus.textContent = 'Pesquise um Pokémon ou preencha tudo manualmente.';
  setReferenceStats();
  setAbilitySuggestions();
  applyState(cloneCard(EMPTY_CARD));
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
