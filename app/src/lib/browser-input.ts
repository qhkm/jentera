import type { BrowserInputTarget, BusinessBrowserState } from '@/lib/repo/types';

export type DirectInputCommand = { action: 'click'; x: number; y: number }
  | ({ action: 'input'; inputId: string; sequence: number } & ({ text: string } | { key: string }));
export type DirectInputState = { phase: 'idle' | 'selecting' | 'ready'; kind?: BrowserInputTarget['kind'] };
type Operation = { click: { x: number; y: number } } | { text: string } | { key: string };

/** Ephemeral, ordered input. Never retry an ambiguous send or carry queued
 * credentials into a different field. Only an explicit click/Tab can retarget. */
export class BrowserInput {
  private queue: Operation[] = [];
  private target: BrowserInputTarget | null = null;
  private revision = 0;
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private accepting = false;

  constructor(
    private dispatch: (command: DirectInputCommand) => Promise<BusinessBrowserState | null>,
    private change: (state: DirectInputState) => void,
    private interrupted: () => void,
  ) {}

  reset() {
    this.revision++;
    this.queue = [];
    this.target = null;
    this.accepting = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.change({ phase: 'idle' });
  }

  select(x: number, y: number) {
    this.accepting = true;
    this.change({ phase: 'selecting' });
    this.enqueue({ click: { x, y } });
  }

  text(text: string) {
    if (!text || !this.accepting) return;
    if (text.length > 4096) { this.stop(); return; }
    this.enqueue({ text });
  }

  key(key: string) {
    if (this.accepting) this.enqueue({ key });
  }

  observe(frame: BusinessBrowserState) {
    // Polls can predate our own click or keystroke acknowledgement.
    if (this.running || this.queue.length || !this.target) return;
    if (frame.inputTarget?.id !== this.target.id || frame.inputTarget.nextSequence !== this.target.nextSequence) this.reset();
  }

  private stop() { this.reset(); this.interrupted(); }

  private enqueue(operation: Operation) {
    const chars = this.queue.reduce((sum, item) => sum + ('text' in item ? item.text.length : 0), 0);
    if (this.queue.length >= 64 || chars + ('text' in operation ? operation.text.length : 0) > 4096) { this.stop(); return; }
    const previous = this.queue.at(-1);
    if ('text' in operation && previous && 'text' in previous) previous.text += operation.text;
    else this.queue.push(operation);
    if (this.running) return;
    clearTimeout(this.timer);
    // Batch adjacent characters, not field selection or keyboard commands.
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 'text' in operation ? 60 : 0);
  }

  private async flush() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const revision = this.revision;
        const operation = this.queue.shift()!;
        const before = this.target;
        if (!('click' in operation) && (!before || ('text' in operation && before.kind === 'control'))) { this.stop(); break; }
        const command: DirectInputCommand = 'click' in operation
          ? { action: 'click', ...operation.click }
          : { action: 'input', inputId: before!.id, sequence: before!.nextSequence, ...operation };
        let next: BusinessBrowserState | null;
        try { next = await this.dispatch(command); }
        catch { next = null; }
        if (revision !== this.revision) continue;
        if (!next || next.directTyping !== 1) { this.stop(); break; }
        const target = next.inputTarget ?? null;
        const transition = 'click' in operation || ('key' in operation && ['Tab', 'Shift+Tab', 'Enter'].includes(operation.key));
        if (!transition && (target?.id !== before?.id || target?.nextSequence !== before!.nextSequence + 1)) {
          this.stop(); break;
        }
        this.target = target;
        if (!target) {
          // Clicking a link/blank area can legitimately leave no typing
          // target. Drop its pending text, but preserve a newer explicit
          // click and text belonging to that later selection.
          const selection = this.queue.findIndex(item => 'click' in item);
          if (selection >= 0) { this.queue = this.queue.slice(selection); continue; }
          this.reset(); break;
        }
        if (!this.queue.some(item => 'click' in item)) this.change({ phase: 'ready', kind: target.kind });
        // Enter may submit/navigate. Queued text must not move with that page.
        if ('key' in operation && operation.key === 'Enter' && target.id !== before?.id) { this.reset(); break; }
      }
    } finally {
      this.running = false;
      if (this.queue.length) void this.flush();
    }
  }
}
