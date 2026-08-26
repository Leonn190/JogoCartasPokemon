/**
 * Composição oficial de referência do Modo Jornada.
 * Pokémon evoluídos não entram em um total fixo: a quantidade final varia
 * conforme o tamanho das linhas evolutivas escolhidas para a coleção.
 */
export const GAME_COLLECTION_REFERENCE = {
  pokemon: {
    basics: {
      common: { unique: 8, copiesEach: 3, totalCopies: 24 },
      uncommon: { unique: 7, copiesEach: 2, totalCopies: 14 },
      rare: { unique: 5, copiesEach: 1, totalCopies: 5 },
      uniqueTotal: 20,
      basicCopiesTotal: 43,
    },
    specialFinalForms: { copiesEach: 1 },
    totalCopies: 'variable',
  },
  attacks: { unique: 48, copiesEach: 2, totalCopies: 96 },
  trainers: {
    item: { unique: 8, copiesEach: 4, totalCopies: 32 },
    supporter: { unique: 8, copiesEach: 3, totalCopies: 24 },
    stadium: { unique: 6, copiesEach: 2, totalCopies: 12 },
    tool: { unique: 6, copiesEach: 3, totalCopies: 18 },
    rareItem: { unique: 6, copiesEach: 2, totalCopies: 12 },
    uniqueTotal: 34,
    pileCopiesTotal: 98,
  },
  champions: { unique: 5, copiesEach: 1, inTrainerPile: false },
} as const;
