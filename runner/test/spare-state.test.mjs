import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, test } from 'node:test';
import { spareState } from '../bin/spare-state.mjs';

const RELEASE='2026.09.17-3';
const BUNDLE='a'.repeat(40);
const pinSource=await fs.readFile(new URL('../../worker/src/runtime/hermes-pin.ts',import.meta.url),'utf8');
const HERMES=pinSource.match(/export const HERMES_COMMIT = '([0-9a-f]{40})'/)?.[1];
assert.ok(HERMES,'spare fixtures must supply the current central Hermes pin');
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const fixtures=[];
afterEach(async()=>{
  for(const root of fixtures.splice(0)) await fs.rm(root,{ recursive:true,force:true });
});

async function fixture() {
  const root=await fs.mkdtemp(path.join(tmpdir(),'jentera-clean-spare-'));
  fixtures.push(root); await fs.mkdir(path.join(root,'aisar','runner'),{ recursive:true }); return root;
}
async function installed(root) {
  await fs.mkdir(path.join(root,'.hermes','hermes-agent'),{ recursive:true });
  await fs.mkdir(path.join(root,'.hermes','bin'));
  for(const name of ['cron','sessions','logs','pairing','hooks','memories','image_cache','audio_cache','skills']) {
    await fs.mkdir(path.join(root,'.hermes',name));
  }
  for(const name of ['.env','config.yaml','SOUL.md']) await fs.writeFile(path.join(root,'.hermes',name),'public installer template');
}
const operation=(root,mode,businessId)=>spareState(mode,RELEASE,BUNDLE,businessId,HERMES,root);

test('prepares clean software, removes only new installer templates and claims once',async()=>{
  const root=await fixture(); await operation(root,'start'); await installed(root); await operation(root,'finish');
  const marker=path.join(root,'aisar','spare-state.json');
  assert.equal((await fs.stat(marker)).mode & 0o777,0o600);
  assert.equal(JSON.parse(await fs.readFile(marker,'utf8')).state,'prepared');
  await assert.rejects(fs.stat(path.join(root,'.hermes','.env')),/ENOENT/);
  assert.ok((await fs.stat(path.join(root,'.hermes','hermes-agent'))).isDirectory());
  await operation(root,'claim',A);
  await fs.writeFile(path.join(root,'aisar','runtime.env'),'customer credentials');
  await operation(root,'claim',A); // Exact owner's retry never clears their data.
  assert.equal(await fs.readFile(path.join(root,'aisar','runtime.env'),'utf8'),'customer credentials');
  await assert.rejects(operation(root,'claim',B),/already used/);
  await assert.rejects(operation(root,'finish'),/already used/);
});

test('refuses to prepare any previously installed Hermes computer',async()=>{
  const root=await fixture(); await installed(root);
  await assert.rejects(operation(root,'start'),/existing installation/);
  assert.equal(await fs.readFile(path.join(root,'.hermes','.env'),'utf8'),'public installer template');
});

test('refuses to prepare a computer containing customer files',async()=>{
  const root=await fixture(); await fs.mkdir(path.join(root,'aisar','outputs'));
  await assert.rejects(operation(root,'start'),/unclean/);
});

test('refuses histories or browser sessions without deleting any files',async()=>{
  for(const target of ['.hermes/sessions/run.json','.hermes/memories/MEMORY.md','aisar/browser-profile/Cookies']) {
    const root=await fixture(); await operation(root,'start'); await installed(root);
    const file=path.join(root,target); await fs.mkdir(path.dirname(file),{ recursive:true }); await fs.writeFile(file,'private');
    await assert.rejects(operation(root,'finish'),/unclean/);
    assert.equal(await fs.readFile(file,'utf8'),'private');
    assert.equal(await fs.readFile(path.join(root,'.hermes','.env'),'utf8'),'public installer template');
  }
});

test('rejects mismatched bundle/release and missing markers',async()=>{
  const root=await fixture(); await assert.rejects(operation(root,'claim',A),/ENOENT/);
  await operation(root,'start'); await installed(root); await operation(root,'finish');
  await assert.rejects(spareState('claim',RELEASE,'b'.repeat(40),A,HERMES,root),/pin mismatch/);
  await assert.rejects(spareState('claim','2026.09.17-4',BUNDLE,A,HERMES,root),/pin mismatch/);
  await assert.rejects(operation(root,'claim','invalid'),/invalid spare owner/);
});

test('fails closed if a previously verified spare becomes dirty before assignment',async()=>{
  const root=await fixture(); await operation(root,'start'); await installed(root); await operation(root,'finish');
  await fs.writeFile(path.join(root,'.hermes','.env'),'secret');
  await assert.rejects(operation(root,'claim',A),/unclean/);
  assert.equal(await fs.readFile(path.join(root,'.hermes','.env'),'utf8'),'secret');
});

test('rejects symbolic links without touching their targets',async()=>{
  const root=await fixture(); await operation(root,'start'); await installed(root);
  const target=path.join(root,'target'); await fs.writeFile(target,'untouched');
  await fs.unlink(path.join(root,'.hermes','.env')); await fs.symlink(target,path.join(root,'.hermes','.env'));
  await assert.rejects(operation(root,'finish'),/unclean/);
  assert.equal(await fs.readFile(target,'utf8'),'untouched');
});

test('duplicate preparation and truncated state do not reset the computer',async()=>{
  const root=await fixture(); await operation(root,'start'); await assert.rejects(operation(root,'start'),/EEXIST/);
  await fs.writeFile(path.join(root,'aisar','spare-state.json'),'{');
  await assert.rejects(operation(root,'finish'),SyntaxError);
});

test('invalid metadata is rejected before any filesystem change',async()=>{
  const root=await fixture(); await assert.rejects(spareState('start','release','main',undefined,HERMES,root),/invalid/);
  assert.deepEqual(await fs.readdir(path.join(root,'aisar')),['runner']);
});
