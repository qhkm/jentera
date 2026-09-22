import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationList } from '@/components/ChatWorkspace';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { AskSession } from '@/hooks/useAsk';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';

const sessions: AskSession[] = [{
  id: 'marketing-chat',
  title: 'Campaign plan',
  createdAt: 1,
  updatedAt: 2,
  botProfile: 'growth',
  messages: [{ from: 'ai', text: 'The campaign draft is ready.' }],
}];

describe('bot conversation roster', () => {
  it('treats each bot as a persistent workspace and opens the bot creator', async () => {
    const onOpenBot = vi.fn();
    const onNewBot = vi.fn();
    render(
      <RepositoryProvider repository={new LocalRepository()}>
        <I18nProvider><ConversationList
          sessions={sessions}
          activeId="marketing-chat"
          businessName="Acme"
          onOpen={vi.fn()}
          onNew={vi.fn()}
          onDelete={vi.fn()}
          bots={[
            { profile: 'default', name: 'Chief of Staff', description: 'Runs the day.', avatar: 'original', isDefault: true },
            { profile: 'growth', name: 'Marketing', description: 'Plans campaigns.', avatar: 'pink' },
          ]}
          activeBotProfile="growth"
          onOpenBot={onOpenBot}
          onNewBot={onNewBot}
        /></I18nProvider>
      </RepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Your bots' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your chats' })).not.toBeInTheDocument();
    expect(screen.getByText('The campaign draft is ready.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Marketing/ }));
    expect(onOpenBot).toHaveBeenCalledWith('growth');
    fireEvent.click(screen.getByRole('button', { name: 'New bot' }));
    expect(onNewBot).toHaveBeenCalledOnce();
  });
});
