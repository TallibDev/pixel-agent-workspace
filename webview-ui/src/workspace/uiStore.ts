import { useSyncExternalStore } from 'react';

/** Which side panel is open over the office (shared by sidebar and HUD). */
export type WorkspacePanel = 'feed' | 'history' | 'hooks' | null;

let panel: WorkspacePanel = null;
const listeners = new Set<() => void>();

export function getPanel(): WorkspacePanel {
  return panel;
}

export function setPanel(next: WorkspacePanel): void {
  if (next === panel) return;
  panel = next;
  for (const l of listeners) l();
}

export function togglePanel(p: Exclude<WorkspacePanel, null>): void {
  setPanel(panel === p ? null : p);
}

export function usePanel(): WorkspacePanel {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getPanel,
    getPanel,
  );
}
