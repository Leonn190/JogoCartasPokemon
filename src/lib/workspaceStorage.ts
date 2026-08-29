import type { WorkspaceState } from '../types/card';
import { createEmptyWorkspace } from './collections';

const DB_NAME = 'card-forge-workspace';
const DB_VERSION = 1;
const STORE = 'state';
const KEY = 'workspace-v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadWorkspaceLocal(): Promise<WorkspaceState | null> {
  if (!('indexedDB' in globalThis)) return null;
  try {
    const db = await openDb();
    const value = await new Promise<WorkspaceState | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.collections)) return null;
    return value;
  } catch {
    return null;
  }
}

export async function saveWorkspaceLocal(workspace: WorkspaceState) {
  workspace.updatedAt = new Date().toISOString();
  if (!('indexedDB' in globalThis)) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(structuredClone(workspace), KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function touchWorkspace(workspace: WorkspaceState) {
  workspace.revision += 1;
  workspace.updatedAt = new Date().toISOString();
  return workspace;
}

export function validWorkspace(value: unknown): WorkspaceState {
  if (!value || typeof value !== 'object') return createEmptyWorkspace();
  const candidate = value as WorkspaceState;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.collections)) return createEmptyWorkspace();
  return candidate;
}
