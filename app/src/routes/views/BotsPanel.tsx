import { useEffect, useId, useRef, useState } from 'react';
import { Check, Plus } from '@phosphor-icons/react';
import { BotAvatar, BOT_AVATARS } from '@/components/BotAvatar';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useMutate, useSnapshot } from '@/lib/repo';
import type { Specialist } from '@/lib/repo/types';
import type { BotAvatarId } from '../../../../shared/bot-avatars';
import './bots.css';

const COPY = {
  en: {
    title: 'Your AI bots', intro: 'A familiar face for every kind of work.',
    note: 'Your default answers new chats. Existing chats keep their bot. Bots share your business connections and permissions.',
    add: 'Add bot', edit: 'Edit bot', avatar: 'Choose avatar', default: 'Your default', makeDefault: 'Make default',
    chief: 'Your everyday assistant. Plan, research and follow through across your business.',
    name: 'Bot name', description: 'What does this bot help with?', instructions: 'Instructions',
    hint: 'Describe its responsibilities, preferred style and when it should ask you for approval.',
    save: 'Save bot', saveAvatar: 'Save avatar', cancel: 'Cancel', saving: 'Saving…',
    disable: 'Disable bot', confirm: 'Confirm disable', warning: 'This bot will no longer answer. Anyone using it as their default will return to Jentera. Its saved history is kept.',
    limit: 'Up to 8 additional bots per business.', owner: 'Only the business owner can add or edit bots. You can choose your own default.',
    saved: 'Saved.', failed: 'Could not save. Please try again.',
  },
  bm: {
    title: 'Bot AI anda', intro: 'Wajah mesra untuk setiap jenis kerja.',
    note: 'Bot lalai menjawab perbualan baharu. Perbualan sedia ada kekal dengan botnya. Bot berkongsi sambungan dan kebenaran perniagaan anda.',
    add: 'Tambah bot', edit: 'Edit bot', avatar: 'Pilih avatar', default: 'Lalai anda', makeDefault: 'Jadikan lalai',
    chief: 'Pembantu harian anda. Merancang, menyelidik dan membuat susulan untuk perniagaan anda.',
    name: 'Nama bot', description: 'Apakah tugas bot ini?', instructions: 'Arahan',
    hint: 'Terangkan tanggungjawab, gaya dan bila bot perlu meminta kelulusan anda.',
    save: 'Simpan bot', saveAvatar: 'Simpan avatar', cancel: 'Batal', saving: 'Menyimpan…',
    disable: 'Nyahaktifkan bot', confirm: 'Sahkan nyahaktif', warning: 'Bot ini tidak lagi menjawab. Pengguna yang memilihnya sebagai lalai akan kembali kepada Jentera. Sejarah tersimpan dikekalkan.',
    limit: 'Sehingga 8 bot tambahan bagi setiap perniagaan.', owner: 'Hanya pemilik boleh menambah atau mengedit bot. Anda boleh memilih bot lalai sendiri.',
    saved: 'Disimpan.', failed: 'Tidak dapat menyimpan. Sila cuba lagi.',
  },
};

function AvatarPicker({ value, onChange, label }: { value: BotAvatarId; onChange: (v: BotAvatarId) => void; label: string }) {
  const group = useId();
  return <fieldset className="bot-avatar-picker">
    <legend>{label}</legend>
    <div className="bot-avatar-options">
      {BOT_AVATARS.map(avatar => <label key={avatar.id} className="bot-avatar-option">
        <input type="radio" name={group} value={avatar.id} checked={value === avatar.id} onChange={() => onChange(avatar.id)} />
        <span><BotAvatar avatar={avatar.id} size={68} /><span>{avatar.name}</span></span>
      </label>)}
    </div>
  </fieldset>;
}

type Draft = Pick<Specialist, 'name' | 'description' | 'instructions'> & { id?: string; avatar: BotAvatarId };

export default function BotsPanel({ startCreating = false, onCreatorOpened }: { startCreating?: boolean; onCreatorOpened?: () => void }) {
  const snap = useSnapshot();
  const mutate = useMutate();
  const { lang } = useI18n();
  const c = COPY[lang];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [personalAvatar, setPersonalAvatar] = useState<BotAvatarId | null>(null);
  const [disableId, setDisableId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const editor = useRef<HTMLFormElement>(null);
  const creatorRequestHandled = useRef(false);
  const current = snap.defaultBotProfile ?? 'default';
  const coordinatorAvatar = snap.coordinatorAvatar ?? 'original';
  const bots = snap.specialists.filter(bot => bot.enabled);
  const editorKey = draft ? draft.id ?? 'new' : personalAvatar ? 'personal' : null;
  useEffect(() => {
    if (!editorKey) return;
    editor.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    editor.current?.querySelector<HTMLInputElement>(editorKey === 'personal' ? 'input:checked' : 'input:not([type=radio])')?.focus({ preventScroll: true });
  }, [editorKey]);

  useEffect(() => {
    if (!startCreating || creatorRequestHandled.current || !snap.canManageBots) return;
    creatorRequestHandled.current = true;
    onCreatorOpened?.();
    if (bots.length < 8) edit();
  }, [bots.length, onCreatorOpened, snap.canManageBots, startCreating]);

  async function write(fn: Parameters<typeof mutate>[0], after?: () => void) {
    if (busy) return;
    setBusy(true); setMessage(''); setFailed(false);
    try { await mutate(fn); after?.(); setMessage(c.saved); }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : c.failed); }
    finally { setBusy(false); }
  }

  function edit(bot?: Specialist) {
    setPersonalAvatar(null); setDisableId(null); setMessage('');
    setDraft({ id: bot?.id, name: bot?.name ?? '', description: bot?.description ?? '', instructions: bot?.instructions ?? '', avatar: bot?.avatar ?? 'original' });
  }

  const cards = [{ id: 'default', profile: 'default', name: 'Jentera', description: c.chief, avatar: coordinatorAvatar }, ...bots];

  return <section className="bots-panel" aria-labelledby="bots-title">
    <header className="bots-heading">
      <div><h2 id="bots-title">{c.title}</h2><p>{c.intro}</p></div>
      {snap.canManageBots && <Button type="button" disabled={busy || bots.length >= 8} onClick={() => edit()}><Plus size={18} />{c.add}</Button>}
    </header>
    <p className="bots-note">{c.note}</p>
    {!snap.canManageBots && <p className="bots-note">{c.owner}</p>}
    {message && <p role={failed ? 'alert' : 'status'} className="bots-message">{message}</p>}

    {(draft || personalAvatar) && <form ref={editor} className="bot-editor" onSubmit={event => {
      event.preventDefault();
      if (draft) {
        const input = { name: draft.name.trim(), description: draft.description.trim(), instructions: draft.instructions.trim(), avatar: draft.avatar };
        if (!input.name || !input.description) return;
        void write(r => draft.id ? r.updateSpecialist(draft.id, input) : r.createSpecialist(input), () => setDraft(null));
      } else if (personalAvatar) void write(r => r.setBotPreference({ defaultBotProfile: current, coordinatorAvatar: personalAvatar }), () => setPersonalAvatar(null));
    }}>
      <h3>{draft ? draft.id ? c.edit : c.add : `Jentera · ${c.avatar}`}</h3>
      <fieldset disabled={busy} className="bot-editor-fields">
        {draft && <>
          <label>{c.name}<input autoFocus required maxLength={60} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>{c.description}<textarea required maxLength={500} rows={2} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
          <label>{c.instructions}<textarea maxLength={4000} rows={4} placeholder={c.hint} value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></label>
        </>}
        <AvatarPicker label={c.avatar} value={draft?.avatar ?? personalAvatar ?? 'original'} onChange={avatar => draft ? setDraft({ ...draft, avatar }) : setPersonalAvatar(avatar)} />
        <div className="bot-actions">
          <Button type="submit" disabled={busy || !!draft && (!draft.name.trim() || !draft.description.trim())}>{busy ? c.saving : draft ? c.save : c.saveAvatar}</Button>
          <Button type="button" variant="outline" onClick={() => { setDraft(null); setPersonalAvatar(null); }}>{c.cancel}</Button>
        </div>
      </fieldset>
    </form>}

    <div className="bot-grid">
      {cards.map(bot => <article className={`bot-card${current === bot.profile ? ' is-default' : ''}`} key={bot.id} aria-label={bot.name}>
        <div className="bot-card-top"><BotAvatar avatar={bot.avatar} size={80} />{current === bot.profile && <span className="bot-default"><Check size={14} />{c.default}</span>}</div>
        <h3>{bot.name}</h3><p>{bot.description}</p>
        <div className="bot-actions">
          {current !== bot.profile && <Button type="button" variant="outline" disabled={busy} onClick={() => void write(r => r.setBotPreference({ defaultBotProfile: bot.profile, coordinatorAvatar }))}>{c.makeDefault}</Button>}
          {bot.id === 'default'
            ? <Button type="button" variant="outline" disabled={busy} onClick={() => { setDraft(null); setPersonalAvatar(coordinatorAvatar); setMessage(''); }}>{c.avatar}</Button>
            : snap.canManageBots && <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => edit(bots.find(item => item.id === bot.id))}>{c.edit}</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setDisableId(bot.id)}>{c.disable}</Button>
            </>}
        </div>
        {disableId === bot.id && <div className="bot-disable"><p>{c.warning}</p><div className="bot-actions">
          <Button type="button" disabled={busy} onClick={() => void write(r => r.disableSpecialist(bot.id), () => { setDisableId(null); if (draft?.id === bot.id) setDraft(null); })}>{c.confirm}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setDisableId(null)}>{c.cancel}</Button>
        </div></div>}
      </article>)}
    </div>
    {snap.canManageBots && <p className="bots-note">{c.limit}</p>}
  </section>;
}
