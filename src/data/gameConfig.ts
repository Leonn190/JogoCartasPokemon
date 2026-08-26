/**
 * Metadados de referência fornecidos para a coleção.
 * A soma das categorias abaixo é 158, embora o total mecânico informado seja 150.
 * Os números são preservados intencionalmente para ajuste futuro, sem correção silenciosa.
 */
export const GAME_COLLECTION_REFERENCE = {
  mechanicalTotal: 150,
  categories: {
    pokemon: 65,
    attacks: 48,
    items: 16,
    supporters: 10,
    stadiums: 8,
    tools: 6,
    champions: 5,
  },
} as const;
