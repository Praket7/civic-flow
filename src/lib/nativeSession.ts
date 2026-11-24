import { invoke } from "@tauri-apps/api/core";

let token: string | null = null;
const listeners = new Set<() => void>();
export function setRepositoryToken(next: string | null): void {
  if (token === next) return;
  token = next;
  for (const listener of listeners) listener();
}
export function repositoryToken(): string {
  return token ?? "";
}
export function onRepositoryTokenChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function invokeAuthed<T>(command: string, args: Record<string, unknown> = {}, credential = repositoryToken()): Promise<T> {
  return invoke<T>(command, { ...args, token: credential });
}
