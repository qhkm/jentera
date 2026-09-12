import { useState } from 'react';
import { Folder, FileText } from '@phosphor-icons/react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRepository, type Artifact } from '@/lib/repo';
import { formatBytes } from '@/lib/artifacts';

/** Virtual folders over authorized artifacts, never paths into the runtime. */
export function FileExplorer({ files, onOpen, onOpenTask }: {
  files: Artifact[];
  onOpen: (file: Artifact) => void;
  onOpenTask: (runId: string) => void;
}) {
  const { lang } = useI18n();
  const bm = lang === 'bm';
  const repo = useRepository();
  const [folder, setFolder] = useState('outputs');
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const categories = [
    { id: 'outputs', label: 'outputs' },
    { id: 'images', label: bm ? 'Imej' : 'Images' },
    { id: 'documents', label: bm ? 'Dokumen' : 'Documents' },
    { id: 'other', label: bm ? 'Lain-lain' : 'Other' },
  ];
  const category = (file: Artifact) => file.contentType.startsWith('image/') ? 'images'
    : /^(text\/|application\/(pdf|json|.*officedocument|.*ms-excel))/.test(file.contentType) ? 'documents' : 'other';
  const visible = files.filter(file => (folder === 'outputs' || category(file) === folder)
    && file.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'name'
    ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt));
  const chooseFolder = (id: string) => { setFolder(id); setFoldersOpen(false); };
  return <div className="file-explorer">
    <p className="text-sm text-text-muted">{bm
      ? 'Baca sahaja · Folder maya untuk output tersimpan, bukan cakera komputer. Memaparkan sehingga 100 fail terkini.'
      : 'Read-only · Virtual folders for saved outputs, not the computer’s disk. Showing up to 100 latest files.'}</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn explorer-folder-toggle" aria-expanded={foldersOpen} aria-controls="explorer-folders" onClick={() => setFoldersOpen(!foldersOpen)}><Folder size={18} />{bm ? 'Folder' : 'Folders'}</button>
      <nav aria-label={bm ? 'Lokasi folder' : 'Folder location'} className="flex min-w-0 items-center gap-2 text-sm">
        <button type="button" className="hover:underline" onClick={() => chooseFolder('outputs')}>outputs</button>
        {folder !== 'outputs' && <><span aria-hidden="true">/</span><span aria-current="page">{categories.find(c => c.id === folder)?.label}</span></>}
      </nav>
    </div>
    <div className="explorer-layout">
      <nav id="explorer-folders" aria-label={bm ? 'Folder' : 'Folders'} className={`explorer-folders ${foldersOpen ? 'is-open' : ''}`}>
        {categories.map(c => <button type="button" key={c.id} aria-current={folder === c.id ? 'page' : undefined} onClick={() => chooseFolder(c.id)} className={`explorer-folder ${c.id !== 'outputs' ? 'pl-6' : ''}`}>
          <Folder size={18} aria-hidden="true" /><span>{c.label}</span>
          <span className="ml-auto text-text-muted">{files.filter(f => c.id === 'outputs' || category(f) === c.id).length}</span>
        </button>)}
      </nav>
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap gap-2">
          <input type="search" aria-label={bm ? 'Tapis fail' : 'Filter files'} placeholder={bm ? 'Cari nama fail…' : 'Find a file…'} value={query} onChange={e => setQuery(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-bg-card px-3 py-2 text-text" />
          <select aria-label={bm ? 'Susun fail' : 'Sort files'} value={sort} onChange={e => setSort(e.target.value)} className="rounded-lg border border-border bg-bg-card px-3 py-2 text-text">
            <option value="newest">{bm ? 'Terkini' : 'Newest first'}</option><option value="name">{bm ? 'Nama A–Z' : 'Name A–Z'}</option>
          </select>
        </div>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={bm ? 'Senarai fail' : 'File list'}>
          <table className="explorer-table">
            <thead><tr>{(bm ? ['Nama', 'Jenis', 'Saiz', 'Disimpan', 'Tindakan'] : ['Name', 'Type', 'Size', 'Saved', 'Actions']).map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{visible.map(file => <tr key={file.id}>
              <td><button type="button" className="flex items-center gap-2 text-left hover:underline" onClick={() => onOpen(file)}><FileText className="shrink-0 text-brand" size={18} /><span className="max-w-64 break-words">{file.name}</span></button></td>
              <td>{file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : (bm ? 'Fail' : 'File')}</td>
              <td className="whitespace-nowrap">{formatBytes(file.size)}</td>
              <td className="whitespace-nowrap">{new Date(file.createdAt).toLocaleString(lang === 'bm' ? 'ms-MY' : 'en-GB')}</td>
              <td><div className="flex gap-3 whitespace-nowrap"><a className="text-brand hover:underline" href={repo.artifactUrl?.(file.id) ?? '#'} download={file.name} target="_blank" rel="noopener">{bm ? 'Muat turun' : 'Download'}</a><button type="button" className="hover:underline" onClick={() => onOpenTask(file.runId)}>{bm ? 'Buka tugasan' : 'Open task'}</button></div></td>
            </tr>)}</tbody>
          </table>
        </div>
        {visible.length === 0 && <p role="status" className="py-6 text-text-muted">{bm ? 'Tiada fail dalam paparan ini.' : 'No files in this view.'}</p>}
      </div>
    </div>
  </div>;
}
