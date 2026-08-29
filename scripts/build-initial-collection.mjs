import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const collectionId = 'collection-primeira-jornada';
const collectionName = 'Primeira Coleção';
const collectionCode = 'PCO';
const generatedAt = '2026-08-29T18:00:00.000Z';

const lines = [
  [['Froakie', 656, 'Água'], ['Frogadier', 657, 'Água'], ['Greninja', 658, 'Sombrio'], ['Greninja', 658, 'Água', 'EX']],
  [['Swinub', 220, 'Gelo'], ['Piloswine', 221, 'Gelo'], ['Mamoswine', 473, 'Gelo'], ['Mamoswine', 473, 'Gelo', 'EX']],
  [['Rowlet', 722, 'Planta'], ['Dartrix', 723, 'Voador'], ['Decidueye', 724, 'Planta'], ['Decidueye', 724, 'Planta', 'EX']],
  [['Phantump', 708, 'Sombrio'], ['Trevenant', 709, 'Sombrio'], ['Trevenant', 709, 'Sombrio', 'EX']],
  [['Shinx', 403, 'Elétrico'], ['Luxio', 404, 'Elétrico'], ['Luxray', 405, 'Elétrico'], ['Luxray', 405, 'Elétrico', 'EX']],
  [['Golett', 622, 'Terra'], ['Golurk', 623, 'Terra'], ['Golurk', 623, 'Terra', 'EX']],
  [['Spearow', 21, 'Voador'], ['Fearow', 22, 'Voador'], ['Fearow', 22, 'Voador', 'EX']],
  [['Riolu', 447, 'Lutador'], ['Lucario', 448, 'Metal'], ['Lucario', 448, 'Lutador', 'Mega'], ['Lucario Z', 448, 'Lutador', 'Mega']],
  [['Ralts', 280, 'Místico'], ['Kirlia', 281, 'Místico'], ['Gardevoir', 282, 'Psíquico'], ['Gallade', 475, 'Lutador'], ['Gardevoir', 282, 'Místico', 'Mega'], ['Gallade', 475, 'Lutador', 'Mega']],
  [['Scyther', 123, 'Planta'], ['Scizor', 212, 'Metal'], ['Kleavor', 900, 'Terra'], ['Scizor', 212, 'Metal', 'Mega']],
  [['Torchic', 255, 'Fogo'], ['Combusken', 256, 'Lutador'], ['Blaziken', 257, 'Fogo'], ['Blaziken', 257, 'Fogo', 'Mega']],
  [['Raikou', 243, 'Elétrico'], ['Raikou', 243, 'Elétrico', 'Radiante']],
  [['Entei', 244, 'Fogo'], ['Entei', 244, 'Fogo', 'Radiante']],
  [['Suicune', 245, 'Gelo'], ['Suicune', 245, 'Gelo', 'Radiante']],
  [['Impidimp', 859, 'Místico'], ['Morgrem', 860, 'Sombrio'], ['Grimmsnarl', 861, 'Sombrio'], ['Grimmsnarl', 861, 'Sombrio', 'Gigantamax']],
  [['Hatenna', 856, 'Psíquico'], ['Hattrem', 857, 'Psíquico'], ['Hatterene', 858, 'Místico'], ['Hatterene', 858, 'Psíquico', 'Gigantamax']],
  [['Milcery', 868, 'Místico'], ['Alcremie', 869, 'Místico'], ['Alcremie', 869, 'Místico', 'Gigantamax']],
  [['Toedscool', 948, 'Terra'], ['Toedscruel', 949, 'Terra']],
  [['Chatot', 441, 'Voador']],
  [['Nosepass', 299, 'Terra'], ['Probopass', 476, 'Metal']],
  [['Spheal', 363, 'Água'], ['Sealeo', 364, 'Gelo'], ['Walrein', 365, 'Gelo'], ['Walrein', 365, 'Água', 'EX']],
  [['Solrock', 338, 'Psíquico']],
  [['Lunatone', 337, 'Psíquico']],
  [['Skiddo', 672, 'Planta'], ['Gogoat', 673, 'Planta']],
  [['Petilil', 548, 'Planta'], ['Lilligant', 549, 'Planta'], ['Lilligant de Hisui', 549, 'Lutador']],
];

const stageFor = (index, length, form) => {
  if (form !== 'Normal') return 'FINAL';
  if (index === 0) return 'BÁSICO';
  if (index === 1) return 'ESTÁGIO 1';
  return 'ESTÁGIO 2';
};

const normalBefore = (line, index) => {
  if (index === 0) return '';
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if ((line[cursor][3] ?? 'Normal') === 'Normal') return line[cursor][0];
  }
  return '';
};

let number = 0;
const cards = lines.flatMap((line, lineIndex) => line.map((entry, entryIndex) => {
  number += 1;
  const [pokemonName, pokemonId, type, rawForm] = entry;
  const form = rawForm ?? 'Normal';
  const previousEvolution = normalBefore(line, entryIndex);
  return {
    id: `card-pjo-${String(number).padStart(3, '0')}`,
    collectionId,
    createdAt: new Date(Date.parse(generatedAt) + number * 1000).toISOString(),
    updatedAt: generatedAt,
    data: {
      cardType: 'pokemon', pokemonId, pokemonName, form,
      rarity: form === 'Normal' ? 'common' : 'ultraRare', type,
      stage: stageFor(entryIndex, line.length, form), previousEvolution,
      previousEvolutionImage: previousEvolution ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${line[Math.max(0, entryIndex - 1)][1]}.png` : '',
      artwork: '', artworkSource: 'none', artworkTransform: { scale: 1, x: 0, y: 0 }, expandedArtwork: false,
      pokedexNumber: pokemonId, genus: 'Pokémon', height: '—', weight: '—', region: '—',
      hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0,
      abilityName: '', abilityDescription: '', flavorText: '',
      cardNumber: number, setTotal: 0, setCode: collectionCode,
    },
    _line: lineIndex + 1,
  };
}));

if (cards.length !== 76) throw new Error(`Esperadas 76 cartas, recebidas ${cards.length}.`);
cards.forEach((card) => { card.data.setTotal = cards.length; });

const cleanCards = cards.map(({ _line, ...card }) => card);
const collection = { id: collectionId, name: collectionName, code: collectionCode, createdAt: generatedAt, updatedAt: generatedAt, cards: cleanCards };
const output = join(process.cwd(), 'public', 'conteudo');
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'primeira-colecao.json'), `${JSON.stringify(collection, null, 2)}\n`);

const counts = cleanCards.reduce((result, card) => {
  result[card.data.type] = (result[card.data.type] ?? 0) + 1;
  return result;
}, {});
console.log(JSON.stringify({ cards: cleanCards.length, counts }, null, 2));
