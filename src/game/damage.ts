import type { PokemonCardData } from '../types/card';
import type { DamageBreakdown, DamageInput, PokemonInPlay } from './types';

export function roundBaseDamage(round: number) {
  if (round >= 8) return 40;
  if (round >= 6) return 30;
  if (round >= 4) return 20;
  if (round >= 2) return 10;
  return 0;
}

export function calculateDamage(input: DamageInput): DamageBreakdown {
  const attack = input.attack;
  const attackerOffense = input.attacker.modifiers.offense + input.attacker.temporaryModifiers.offense;
  const defenderDefense = input.defender.modifiers.defense + input.defender.temporaryModifiers.defense;
  const offensiveStat = attack.attackKind === 'normal'
    ? input.attackerStats.attack + attackerOffense
    : input.attackerStats.specialAttack + attackerOffense;
  const defensiveStat = attack.attackKind === 'normal'
    ? input.defenderStats.defense + defenderDefense
    : input.defenderStats.specialDefense + defenderDefense;
  const power = input.powerOverride ?? attack.power;
  const rawDamage = Math.floor((Math.max(0, offensiveStat) / 10) * (power / 100)) * 10;
  const roundBonus = rawDamage > 0 ? roundBaseDamage(input.round) : 0;
  const matchupModifier = input.matchupModifier ?? 0;
  const finalModifier = input.finalModifier ?? 0;
  const finalDamage = Math.max(0, rawDamage - Math.max(0, defensiveStat) + roundBonus + matchupModifier + finalModifier);
  return {
    kind: attack.attackKind,
    offensiveStat,
    defensiveStat,
    power,
    rawDamage,
    roundBaseDamage: roundBonus,
    matchupModifier,
    finalModifier,
    finalDamage,
  };
}

export function pokemonHpRemaining(pokemon: PokemonInPlay, stats: PokemonCardData) {
  return Math.max(0, stats.hp - pokemon.damage);
}

export function isKnockedOut(pokemon: PokemonInPlay, stats: PokemonCardData) {
  return pokemon.damage >= stats.hp;
}

export function knockoutPointValue(data: PokemonCardData, previousKnockouts = 0) {
  let base = 1;
  if (data.form === 'Gmax') base = 7;
  else if (data.form === 'Mega' || data.form === 'Radiante') base = 6;
  else if (data.form === 'EX') base = 5;
  else if (data.stage === 'ESTÁGIO 2') base = 3;
  else if (data.stage === 'ESTÁGIO 1') base = 2;
  return previousKnockouts > 0 ? Math.floor(base / 2) : base;
}
