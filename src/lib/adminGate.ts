export const ADMIN_KEY = '1900';

const ADMIN_SESSION_KEY = 'card-forge:admin:authorized';

export function hasAdminAccess() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
}

export function ensureAdminAccess() {
  if (hasAdminAccess()) return true;
  const value = window.prompt('Digite a chave do editor para alterar conteúdo.');
  if (value === ADMIN_KEY) {
    sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
    return true;
  }
  return false;
}

export function clearAdminAccess() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}
