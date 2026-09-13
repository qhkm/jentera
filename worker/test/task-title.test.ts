import { expect, it } from 'vitest';
import { taskTitle } from '../src/task-title';

it('stores only the short objective, not continuation context', () => {
  expect(taskTitle('Continue this task: Research costs\nPrevious result: long reply')).toBe('Research costs');
  expect(taskTitle('Teruskan tugasan ini: Semak kos Hasil terdahulu: panjang')).toBe('Semak kos');
  expect(taskTitle('Research costs')).toBe('Research costs');
});
