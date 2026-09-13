import { expect, it } from 'vitest';
import { taskDisplayTitle } from '../task';

it('removes continuation context from existing headings in either language', () => {
  expect(taskDisplayTitle('Continue this task: Research costs\nPrevious result: long reply')).toBe('Research costs');
  expect(taskDisplayTitle('Teruskan tugasan ini: Semak kos Hasil terdahulu: panjang')).toBe('Semak kos');
  expect(taskDisplayTitle('a'.repeat(300))).toHaveLength(118);
});
