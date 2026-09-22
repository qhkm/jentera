import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { X } from '@phosphor-icons/react';
import { BotAvatar, BOT_AVATARS } from '@/components/BotAvatar';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useMutate, useSnapshot } from '@/lib/repo';
import type { BotAvatarId } from '../../../../shared/bot-avatars';
import './bots.css';

const EMPTY = { name: '', description: '', instructions: '', avatar: 'original' as BotAvatarId };

export default function BotCreatorDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (profile: string) => void;
}) {
  const { lang } = useI18n();
  const snap = useSnapshot();
  const mutate = useMutate();
  const dialog = useRef<HTMLDialogElement>(null);
  const group = useId();
  const before = useRef<Set<string>>(new Set());
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [awaitingProfile, setAwaitingProfile] = useState(false);
  const bots = snap.specialists.filter(bot => bot.enabled);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      if (typeof node.showModal === 'function') node.showModal();
      else node.setAttribute('open', '');
    } else if (!open && node.open) node.close();
  }, [open]);

  useEffect(() => {
    if (!awaitingProfile) return;
    const created = bots.find(bot => !before.current.has(bot.id));
    if (!created) return;
    setAwaitingProfile(false);
    setDraft(EMPTY);
    onCreated(created.profile);
  }, [awaitingProfile, bots, onCreated]);

  function close() {
    if (busy) return;
    setError('');
    setAwaitingProfile(false);
    setDraft(EMPTY);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      instructions: draft.instructions.trim(),
      avatar: draft.avatar,
    };
    if (!input.name || !input.description || busy) return;
    before.current = new Set(bots.map(bot => bot.id));
    setBusy(true);
    setError('');
    try {
      await mutate(repo => repo.createSpecialist(input));
      setAwaitingProfile(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : lang === 'bm' ? 'Bot tidak dapat disimpan.' : 'Could not save the bot.');
    } finally {
      setBusy(false);
    }
  }

  return <dialog
    ref={dialog}
    className="bot-creator-dialog"
    aria-labelledby="bot-creator-title"
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}
  >
    <form className="bot-creator-form" onSubmit={event => void submit(event)}>
      <header>
        <div>
          <h2 id="bot-creator-title">{lang === 'bm' ? 'Cipta bot baharu' : 'Create a new bot'}</h2>
          <p>{lang === 'bm' ? 'Berikan satu peranan yang jelas. Anda boleh ubah butiran kemudian.' : 'Give it one clear role. You can refine the details later.'}</p>
        </div>
        <button type="button" className="bot-creator-close" onClick={close} aria-label={lang === 'bm' ? 'Tutup' : 'Close'}><X size={20} /></button>
      </header>

      {!snap.canManageBots ? <p className="bots-message" role="alert">{lang === 'bm' ? 'Hanya pemilik perniagaan boleh menambah bot.' : 'Only the business owner can add bots.'}</p> : bots.length >= 8 ? <p className="bots-message" role="alert">{lang === 'bm' ? 'Had lapan bot tambahan telah dicapai.' : 'You have reached the limit of eight additional bots.'}</p> : <fieldset className="bot-editor-fields" disabled={busy}>
        <label>{lang === 'bm' ? 'Nama bot' : 'Bot name'}<input autoFocus required maxLength={60} placeholder={lang === 'bm' ? 'Contoh: Pengurus pemasaran' : 'For example: Marketing manager'} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label>{lang === 'bm' ? 'Apakah tugas bot ini?' : 'What does this bot help with?'}<textarea required maxLength={500} rows={2} placeholder={lang === 'bm' ? 'Satu ayat tentang tanggungjawab utamanya.' : 'One sentence about its main responsibility.'} value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} /></label>
        <label>{lang === 'bm' ? 'Arahan tambahan (pilihan)' : 'Extra instructions (optional)'}<textarea maxLength={4000} rows={3} placeholder={lang === 'bm' ? 'Gaya kerja, had, dan bila perlu meminta kelulusan.' : 'Working style, boundaries, and when to ask for approval.'} value={draft.instructions} onChange={event => setDraft(current => ({ ...current, instructions: event.target.value }))} /></label>
        <fieldset className="bot-avatar-picker">
          <legend>{lang === 'bm' ? 'Pilih avatar' : 'Pick an avatar'}</legend>
          <div className="bot-creator-avatars">
            {BOT_AVATARS.map(avatar => <label className="bot-avatar-option" key={avatar.id} title={avatar.name}>
              <input type="radio" name={group} value={avatar.id} checked={draft.avatar === avatar.id} onChange={() => setDraft(current => ({ ...current, avatar: avatar.id }))} />
              <span><BotAvatar avatar={avatar.id} size={48} /><span>{avatar.name}</span></span>
            </label>)}
          </div>
        </fieldset>
        {error && <p className="bots-message" role="alert">{error}</p>}
        <div className="bot-actions">
          <Button type="submit" disabled={busy || !draft.name.trim() || !draft.description.trim()}>{busy ? (lang === 'bm' ? 'Menyimpan…' : 'Saving…') : (lang === 'bm' ? 'Cipta dan berbual' : 'Create and chat')}</Button>
          <Button type="button" variant="ghost" onClick={close}>{lang === 'bm' ? 'Batal' : 'Cancel'}</Button>
        </div>
      </fieldset>}
    </form>
  </dialog>;
}
