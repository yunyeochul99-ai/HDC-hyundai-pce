import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/record-transfer.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { transferRecord, withTimeout } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const photos = () => [new File(['first'], 'first.png'), new File(['second'], 'second.png')];

test('photo categories and captions survive partial uploads and retry without mixing files', async () => {
  let staged={photoIds:[],photoDetails:{}},uploaded=0;
  const metadata={ 'first.png':{stage:'before',part:'wire',caption:'damaged'},'second.png':{stage:'after',part:'wire',caption:'replaced'} };
  const attach=(record,file,id)=>({...record,photoDetails:{...record.photoDetails,[id]:metadata[file.name]}});
  await assert.rejects(transferRecord({record:staged,files:photos(),upload:async file=>{if(file.name==='second.png')throw Error('interrupted');return 'first-id';},save:async()=>assert.fail('must not save'),onProgress:()=>{},onPhotoUploaded:attach,onStaged:(record,count)=>{staged=record;uploaded=count;}}),/interrupted/);
  assert.deepEqual(staged.photoDetails,{'first-id':metadata['first.png']});
  const saved=await transferRecord({record:staged,files:photos().slice(uploaded),upload:async()=> 'second-id',save:async record=>record,onProgress:()=>{},onPhotoUploaded:attach,onStaged:()=>{}});
  assert.deepEqual(saved.photoDetails,{'first-id':metadata['first.png'],'second-id':metadata['second.png']});
});

test('legacy photos default to unclassified and detached metadata is excluded from saved record', async () => {
  const source=await readFile(new URL('../src/photo-details.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const {attachedPhotoDetails,photoDetail}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  assert.equal(photoDetail(undefined,'legacy-id').stage,'unclassified');
  const details={'keep':{stage:'after',part:'wire',caption:'replaced'},'removed':{stage:'before',part:'wire',caption:'damaged'}};
  assert.deepEqual(attachedPhotoDetails(['keep'],details),{keep:details.keep});
  assert.equal(details.removed.stage,'before');
});

test('uploads photos in order, saves references, then confirms server acknowledgement', async () => {
  const record = { photoIds: ['existing'], title: 'test' }, states = [], staged = [];
  const saved = await transferRecord({ record, files: photos(), upload: async file => file.name, save: async value => ({ ...value, version: 2 }), onProgress: state => states.push(state), onStaged: (value, count) => staged.push({ value, count }) });
  assert.deepEqual(states.map(state => state.phase), ['uploading', 'uploading', 'saving', 'saved']);
  assert.deepEqual(states.map(state => state.completed), [0, 1, 2, 3]);
  assert.deepEqual(saved.photoIds, ['existing', 'first.png', 'second.png']);
  assert.equal(states.at(-1).photoCount, 3);
  assert.deepEqual(record.photoIds, ['existing']);
  assert.deepEqual(staged.map(item => item.count), [1, 2]);
});

test('does not show success while the server write is still pending', async () => {
  const states = []; let acknowledge;
  const pending = transferRecord({ record: { photoIds: [] }, files: [], upload: async () => assert.fail('unexpected upload'), save: () => new Promise(resolve => { acknowledge = resolve; }), onProgress: state => states.push(state.phase), onStaged: () => {} });
  assert.deepEqual(states, ['saving']);
  acknowledge({ photoIds: [] }); await pending;
  assert.deepEqual(states, ['saving', 'saved']);
});

test('partial upload failure keeps successful references and never confirms the record', async () => {
  let staged = { photoIds: ['existing'] }, uploaded = 0, writes = 0; const states = [];
  await assert.rejects(transferRecord({ record: staged, files: photos(), upload: async file => { if (file.name === 'second.png') throw new Error('upload interrupted'); return 'first-id'; }, save: async value => { writes++; return value; }, onProgress: state => states.push(state.phase), onStaged: (value, count) => { staged = value; uploaded = count; } }), /upload interrupted/);
  assert.equal(writes, 0); assert.equal(uploaded, 1);
  assert.deepEqual(staged.photoIds, ['existing', 'first-id']);
  assert.ok(!states.includes('saved'));
  let retried = 0;
  const saved = await transferRecord({ record: staged, files: photos().slice(uploaded), upload: async () => { retried++; return 'second-id'; }, save: async value => value, onProgress: () => {}, onStaged: () => {} });
  assert.equal(retried, 1); assert.deepEqual(saved.photoIds, ['existing', 'first-id', 'second-id']);
});

test('a failed record write retains uploaded references without showing success', async () => {
  let staged; const states = [];
  await assert.rejects(transferRecord({ record: { photoIds: [] }, files: photos(), upload: async file => file.name, save: async () => { throw new Error('server acknowledgement lost'); }, onProgress: state => states.push(state.phase), onStaged: value => { staged = value; } }), /acknowledgement lost/);
  assert.deepEqual(staged.photoIds, ['first.png', 'second.png']);
  assert.equal(states.at(-1), 'saving'); assert.ok(!states.includes('saved'));
});

test('server query timeout rejects and quick queries resolve normally', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 1), /시간 초과/);
  assert.equal(await withTimeout(Promise.resolve('confirmed'), 100), 'confirmed');
});
