import { ChatCircleText, SquaresFour } from '@phosphor-icons/react';
import { useT } from '@/i18n/I18nProvider';

export type WorkspaceMode = 'chat' | 'dashboard';

export function WorkspaceModeSwitch({ mode, onChange, needsAttention = 0 }: {
  mode: WorkspaceMode;
  onChange: (mode: WorkspaceMode) => void;
  needsAttention?: number;
}) {
  const t = useT();
  return (
    <nav className="workspace-mode-switch" aria-label={t('workspace.mode.label')}>
      {(['chat', 'dashboard'] as const).map((item) => {
        const Glyph = item === 'chat' ? ChatCircleText : SquaresFour;
        return (
          <button
            key={item}
            type="button"
            aria-current={mode === item ? 'page' : undefined}
            onClick={() => onChange(item)}
          >
            <Glyph size={17} aria-hidden="true" />
            <span className="workspace-mode-label">{t(`workspace.mode.${item}`)}</span>
            {item === 'dashboard' && needsAttention > 0 && (
              <span className="workspace-mode-badge" aria-label={t('home.review', { n: needsAttention })}>
                {needsAttention > 99 ? '99+' : needsAttention}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
