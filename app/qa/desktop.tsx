// Offline QA entry, not a production build input or public asset.
import { createRoot } from 'react-dom/client';
import { LocalRepository, RepositoryProvider } from '@/lib/repo';
import type { Repository } from '@/lib/repo';
import { I18nProvider } from '@/i18n/I18nProvider';
import BusinessBrowser from '@/routes/views/BusinessBrowser';
import '@/styles/index.css';

const repository: Repository = new LocalRepository();
repository.businessBrowser = async (command) => {
  const response = await fetch('/api/browser', command ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
  } : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.err || 'Fixture unavailable');
  return result;
};
repository.desktopConnection = controlId => ({
  url: `ws://${location.host}/api/browser/desktop`, protocols: ['binary', `jentera-control.${controlId}`],
});
createRoot(document.getElementById('root')!).render(<RepositoryProvider repository={repository}>
  <I18nProvider><main style={{ padding: 24 }}><input aria-label="Chat draft" defaultValue="Keep my unsent draft" />
    <BusinessBrowser /></main></I18nProvider>
</RepositoryProvider>);
