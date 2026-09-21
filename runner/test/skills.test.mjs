import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { parseSkillSummary, readHermesSkills, selectedSkillInstructions } from '../src/server.mjs';

test('parses bounded public skill metadata without instruction content', () => {
  assert.deepEqual(parseSkillSummary(`---
name: "Supplier Review"
description: Compare supplier offers
category: operations
---
# Private procedure
Do not expose this body.
  `, '/skills/operations/supplier', '/skills'), {
    id: 'supplier-review',
    name: 'Supplier Review',
    description: 'Compare supplier offers',
    category: 'operations',
  });
});

test('lists actual VM skills by category and reports disabled state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jentera-skills-'));
  try {
    await mkdir(join(root, 'skills', 'research', 'market-scan'), { recursive: true });
    await mkdir(join(root, 'skills', 'meeting-notes'), { recursive: true });
    await writeFile(join(root, 'skills', 'research', 'market-scan', 'SKILL.md'), `---
name: Market scan
description: Compare current public sources.
---
Instructions stay private.
`);
    await writeFile(join(root, 'skills', 'meeting-notes', 'SKILL.md'), `---
name: Meeting notes
---
Turn rough notes into a clear summary.
`);
    await writeFile(join(root, 'config.yaml'), `skills:
  platform_disabled:
    api_server:
      - Meeting notes
`);
    const skills = await readHermesSkills({
      hermesSkillsDir: join(root, 'skills'),
      hermesConfigFile: join(root, 'config.yaml'),
    });
    assert.deepEqual(skills, [
      { id: 'meeting-notes', name: 'Meeting notes', description: 'Turn rough notes into a clear summary.', category: null, disabled: true },
      { id: 'market-scan', name: 'Market scan', description: 'Compare current public sources.', category: 'research', disabled: false },
    ]);
    assert.equal(JSON.stringify(skills).includes('Instructions stay private'), false);
    const prompt = await selectedSkillInstructions({
      hermesSkillsDir: join(root, 'skills'),
      hermesConfigFile: join(root, 'config.yaml'),
    }, ['market-scan']);
    assert.match(prompt, /Owner-selected skill "Market scan"/);
    assert.match(prompt, /Instructions stay private/);
    await assert.rejects(
      selectedSkillInstructions({
        hermesSkillsDir: join(root, 'skills'),
        hermesConfigFile: join(root, 'config.yaml'),
      }, ['meeting-notes']),
      /selected skill is unavailable/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
