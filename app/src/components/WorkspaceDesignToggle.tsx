import { Sparkle } from '@phosphor-icons/react';

export const WORKSPACE_V3_KEY = 'jentera-workspace-design-v1';

export function initialWorkspaceV3(): boolean {
  /* V1 is the product workspace. V3 remains a session-only visual preview,
     so an old experiment choice must never replace the dashboard on reload. */
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.removeItem(WORKSPACE_V3_KEY);
  } catch {
    // Storage is optional; the default remains V1 either way.
  }
  return false;
}

export function WorkspaceDesignToggle({ enabled, onChange }: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  function toggle() {
    const next = !enabled;
    onChange(next);
  }

  return (
    <button
      type="button"
      className="workspace-design-toggle"
      aria-label={enabled ? 'Use the current workspace design' : 'Preview the V3 workspace design'}
      aria-pressed={enabled}
      onClick={toggle}
      title={enabled ? 'Return to V1 design' : 'Preview V3 design'}
    >
      <Sparkle size={16} weight={enabled ? 'fill' : 'regular'} aria-hidden="true" />
      <span>{enabled ? 'V3 on' : 'Try V3'}</span>
    </button>
  );
}
