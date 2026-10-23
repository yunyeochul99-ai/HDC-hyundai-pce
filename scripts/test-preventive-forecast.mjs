import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compiled=ts.transpileModule(await readFile(new URL('../src/preventive-forecast.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {readForecast,writeForecast,buildForecast,nextForecastDate,forecastWorkDate,emptyForecast}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const settings={...emptyForecast,partCode:'WIRE-1',partName:'권상 와이어',interval:1,unit:'months',lastDate:'2026-01-31'};
const plan={id:'P1',equipment:'E1',equipmentName:'크레인',title:'와이어 점검',method:'PM',catalogState:'approved',checklist:[{name:'와이어 마모',criteria:'승인 기준 대조'}],evidence:writeForecast(settings,'원본 근거 유지')};
const equipment=new Set(['E1']);
const record=(id,date,extra={})=>({id,type:'workorder',status:'완료',equipmentId:'E1',preventivePlanId:'P1',note:'부품코드: WIRE-1',planning:{actualEndAt:date+'T09:00'},...extra});
test('metadata round trip preserves original evidence and legacy/malformed text',()=>{
 assert.deepEqual(readForecast(plan.evidence),{settings,evidence:'원본 근거 유지'});
 for(const text of ['기존 이력','HDC-PREVENTIVE-V1\n{broken'])assert.equal(readForecast(text).evidence,text);
 assert.equal(writeForecast(emptyForecast,'기존 이력'),'기존 이력');
 assert.throws(()=>writeForecast({...settings,interval:0},''));
 assert.throws(()=>writeForecast({...settings,lastDate:'2026-02-30'},''));
 assert.throws(()=>writeForecast(settings,'x'.repeat(2000)));
});
test('calendar recurrence clamps month end and supports leap years without skipping overdue cycles',()=>{
 assert.equal(nextForecastDate('2026-01-31',1,'months'),'2026-02-28');
 assert.equal(nextForecastDate('2024-01-31',1,'months'),'2024-02-29');
 assert.equal(nextForecastDate('2024-02-29',12,'months'),'2025-02-28');
 assert.equal(nextForecastDate('2026-12-31',1,'days'),'2027-01-01');
 const row=buildForecast([plan],[],'2026-10-23',equipment)[0];assert.equal(row.due,'2026-02-28');assert.ok(row.days<0);
});
test('only completed records for the same plan, equipment and part reset the baseline',()=>{
 const rows=[record('ok','2026-03-01'),record('request','2026-10-01',{status:'접수'}),record('other','2026-09-01',{equipmentId:'E2'}),record('part','2026-08-01',{note:'부품코드: WIRE-2'}),record('legacy','2026-07-01',{note:''}),record('future','2027-01-01')];
 const row=buildForecast([plan],rows,'2026-10-23',equipment)[0];assert.equal(row.baseline,'2026-03-01');assert.equal(row.due,'2026-04-01');assert.equal(row.active.length,1);assert.equal(row.candidate,null);
});
test('three unique completion dates yield a review candidate, never overwrite configured recurrence',()=>{
 const rows=[record('a','2026-01-01'),record('b','2026-01-11'),record('c','2026-01-31'),record('duplicate','2026-01-31')];
 const row=buildForecast([plan],rows,'2026-10-23',equipment)[0];assert.equal(row.candidate,15);assert.equal(row.due,'2026-02-28');assert.equal(row.datedCount,3);
});
test('incomplete/group/unapproved plans are explicit gaps; legal and archived plans are excluded',()=>{
 const p={...plan,equipment:'GROUP',catalogState:'pending',checklist:[],evidence:''};
 const row=buildForecast([p],[],'2026-10-23',equipment)[0];assert.equal(row.due,'');assert.equal(row.issues.length,6);
 assert.equal(buildForecast([{...plan,method:'법정검사'},{...plan,method:'법정'},{...plan,catalogState:'archived'}],[],'2026-10-23',equipment).length,0);
});
test('manual corrections are used only when valid and not in the future; deterministic sorting does not mutate input',()=>{
 const input=[{...plan,id:'Z',evidence:writeForecast({...settings,lastDate:'2027-01-01'},'')},plan];
 const rows=buildForecast(input,[],'2026-10-23',equipment);assert.equal(rows[0].plan.id,'P1');assert.equal(rows[1].due,'');assert.ok(rows[1].issues.includes('기준 완료일 확인 필요'));assert.equal(input[0].id,'Z');
});

test('Sunday due dates retain their deadline while suggesting Saturday work',()=>{assert.equal(forecastWorkDate('2026-10-25'),'2026-10-24');assert.equal(forecastWorkDate('2026-10-24'),'2026-10-24');});
