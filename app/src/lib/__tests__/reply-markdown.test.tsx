import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderReplyMarkdown } from '@/lib/reply-markdown';

/**
 * An answer is model output, and since `web_extract` began pulling arbitrary
 * pages into the model's context it can carry text a stranger's page chose.
 * So the tests that matter here are as much about what does *not* render as
 * what does.
 */

function show(text: string) {
  return render(<div data-testid="body">{renderReplyMarkdown(text)}</div>);
}

describe('the marks the agent actually writes', () => {
  it('renders bold, inline code and fenced blocks instead of their punctuation', () => {
    show('**Two ways to use it:**\n\nCall `web_extract`.\n\n```py\nimport firecrawl\n```');
    const body = screen.getByTestId('body');

    expect(body.querySelector('strong')?.textContent).toBe('Two ways to use it:');
    expect(body.querySelector('code.reply-code')?.textContent).toBe('web_extract');
    expect(body.querySelector('pre.reply-pre')?.textContent).toBe('import firecrawl');
    // The punctuation is consumed, not displayed.
    expect(body.textContent).not.toContain('**');
    expect(body.textContent).not.toContain('```');
  });

  it('groups consecutive bullets into one list rather than a run of strays', () => {
    show('Options:\n- first\n- second\n- third');
    const items = screen.getByTestId('body').querySelectorAll('ul.reply-list li');
    expect([...items].map((li) => li.textContent)).toEqual(['first', 'second', 'third']);
  });

  it('numbers a list the same way, since the model writes both', () => {
    show('1. one\n2. two');
    expect(screen.getByTestId('body').querySelectorAll('li')).toHaveLength(2);
  });

  it('leaves the inside of a fence alone', () => {
    show('```\n**not bold** and `not code`\n```');
    const pre = screen.getByTestId('body').querySelector('pre.reply-pre');
    expect(pre?.textContent).toBe('**not bold** and `not code`');
    expect(screen.getByTestId('body').querySelector('strong')).toBeNull();
  });

  it('supports table alignment, optional outer pipes, escaped pipes and short rows', () => {
    show('Name | Qty | Note\n:--- | ---: | :---:\n**Tea** | 12 | `hot`\\|cold\nCoffee | 3');
    const table = screen.getByRole('table');
    expect(table.querySelectorAll('th')).toHaveLength(3);
    expect(table.querySelectorAll('td')).toHaveLength(6);
    expect(table.querySelectorAll('th')[1]).toHaveStyle({ textAlign: 'right' });
    expect(table.querySelectorAll('th')[2]).toHaveStyle({ textAlign: 'center' });
    expect(table.querySelector('strong')).toHaveTextContent('Tea');
    expect(table.querySelector('code')).toHaveTextContent('hot');
    expect(table).toHaveTextContent('hot|cold');
    expect(table.querySelectorAll('td')[5]).toHaveTextContent('');
  });

  it('leaves malformed table separators and ordinary pipes as text', () => {
    show('a | b\n-- | ---\n1 | 2\n\nleft | right');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByTestId('body')).toHaveTextContent('left | right');
  });

  it('keeps HTML and links inert inside table cells', () => {
    show('| A | B |\n| --- | --- |\n| <img src=x onerror=alert(1)> | [click](https://evil.example) |');
    const table = screen.getByRole('table');
    expect(table.querySelector('img, a')).toBeNull();
    expect(table).toHaveTextContent('<img src=x onerror=alert(1)>');
  });
});

describe('what a stranger writing through the model cannot do', () => {
  it('never renders a link as something to click', () => {
    show('Please [Verify your account](https://evil.example/steal) now.');
    const body = screen.getByTestId('body');

    /* The words survive and the address is readable, so the owner can judge
       it. Neither is navigable. */
    expect(body.textContent).toContain('Verify your account');
    expect(body.textContent).toContain('https://evil.example/steal');
    expect(body.querySelector('a')).toBeNull();
  });

  it('renders HTML in an answer as the characters it is', () => {
    show('<img src=x onerror="alert(1)"> and <script>alert(2)</script>');
    const body = screen.getByTestId('body');

    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('script')).toBeNull();
    // Shown to the owner as text, exactly as written.
    expect(body.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('keeps ordinary prose and its line breaks untouched', () => {
    show('Yes, it works.\nI checked example.com.');
    expect(screen.getByTestId('body').textContent).toBe('Yes, it works.\nI checked example.com.');
  });
});
