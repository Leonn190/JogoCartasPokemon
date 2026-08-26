import { toPng } from 'html-to-image';
import type { PokemonCardData } from '../types/card';

function slug(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function exportFilename(card: PokemonCardData) {
  const name = slug(card.pokemonName || 'pokemon');
  const form = card.form === 'Normal' ? '' : `-${slug(card.form)}`;
  const number = String(card.cardNumber || 0).padStart(3, '0');
  const code = slug(card.setCode || 'set');
  return `${name}${form}-${number}-${code}.png`;
}

export async function exportCardAsPng(node: HTMLElement, card: PokemonCardData) {
  const dataUrl = await toPng(node, {
    width: 630,
    height: 880,
    canvasWidth: 1260,
    canvasHeight: 1760,
    pixelRatio: 1,
    cacheBust: true,
    skipFonts: true,
    style: {
      transform: 'none',
      transformOrigin: 'center',
      margin: '0',
    },
  });

  const anchor = document.createElement('a');
  anchor.download = exportFilename(card);
  anchor.href = dataUrl;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
