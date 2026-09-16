import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowsClockwise, Plugs } from '@phosphor-icons/react';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import '@/styles/connectors.css';

/** Shared account controls: checking is read-only; disconnect always needs confirmation. */
export function ConnectionActions({ name, explanation, confirming, checking = false, busy = false,
  onCheck, onRequestDisconnect, onCancel, onDisconnect, children }: {
  name: string;
  explanation: string;
  confirming: boolean;
  checking?: boolean;
  busy?: boolean;
  onCheck?: () => void;
  onRequestDisconnect: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  const descriptionId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const disconnect = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) {
      cancel.current?.focus({ preventScroll: true });
      confirmation.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    } else if (wasConfirming.current) {
      disconnect.current?.focus({ preventScroll: true });
      disconnect.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  return confirming ? <div ref={confirmation} className="connection-confirmation" role="group"
    aria-label={`${t('connectors.disconnect')} ${name}`} aria-describedby={descriptionId}
    onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onCancel(); } }}>
    <h4>{t('connectors.disconnect')} {name}?</h4>
    <p id={descriptionId}>{explanation}</p>
    <div className="connection-action-bar">
      <Button type="button" ref={cancel} variant="outline" disabled={busy} onClick={onCancel}>{t('connectors.cancel')}</Button>
      <Button type="button" variant="outline" className="connection-disconnect-confirm" disabled={busy} onClick={onDisconnect}>
        <Plugs size={17} aria-hidden="true" />{busy ? t('connectors.disconnectBusy') : t('connectors.confirmDisconnect')}
      </Button>
    </div>
  </div> : <div className="connection-action-bar">
    {children}
    {onCheck && <Button type="button" variant="outline" disabled={checking || busy} onClick={onCheck}>
      <ArrowsClockwise size={17} className={checking ? 'connection-checking' : undefined} aria-hidden="true" />
      {checking ? t('connectors.checkBusy') : t('connectors.check')}
    </Button>}
    <Button type="button" ref={disconnect} variant="ghost" className="connection-disconnect" disabled={checking || busy} onClick={onRequestDisconnect}>
      <Plugs size={17} aria-hidden="true" />{t('connectors.disconnect')}
    </Button>
  </div>;
}
