import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../src/plan-code.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {canonicalPlanId,canonicalPlanText,canonicalPlanRecord}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('all 22 old identifiers map one-to-one, without changing unrelated identifiers',()=>{
 const ids=Array.from({length:22},(_,i)=>String(i+1).padStart(3,'0'));assert.equal(new Set(ids.map(id=>canonicalPlanId(`PM-2026-V2-${id}`))).size,22);
 for(const id of ids)assert.equal(canonicalPlanId(`PM-2026-V2-${id}`),`PM-2026-${id}`);
 for(const id of ['PM-2026-V2-000','PM-2026-V2-023','STAT-001','PM-2026-001'])assert.equal(canonicalPlanId(id),id);
});
test('old drafts and backups retain record, photos and approval while updating plan references',()=>{
 const old={id:'record',preventivePlanId:'PM-2026-V2-001',note:'계획 PM-2026-V2-001\n확인',photoIds:['photo'],planning:{approval:'승인'}};
 const current=canonicalPlanRecord(old);assert.equal(current.preventivePlanId,'PM-2026-001');assert.equal(current.note,'계획 PM-2026-001\n확인');assert.equal(current.id,old.id);assert.equal(current.planning,old.planning);assert.equal(current.photoIds,old.photoIds);assert.equal(old.preventivePlanId,'PM-2026-V2-001');
 assert.equal(canonicalPlanText('PM-2026-V2-0010'), 'PM-2026-V2-0010');
});
