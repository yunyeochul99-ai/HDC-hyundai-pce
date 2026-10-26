import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
async function module(path){const source=await readFile(new URL(path,import.meta.url),'utf8');return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;}
const uri=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const forecastUri=uri(await module('../src/preventive-forecast.ts')),statutoryUri=uri(await module('../src/statutory-plans.ts'));
const source=(await module('../src/maintenance-calendar.ts')).replace(/from ['"]\.\/preventive-forecast['"]/g,`from '${forecastUri}'`).replace(/from ['"]\.\/statutory-plans['"]/g,`from '${statutoryUri}'`);
const {monthDays,shiftCalendarMonth,buildMaintenanceEvents,eventsOnDay,morningOverloads}=await import(uri(source));
const {emptyForecast,writeForecast}=await import(forecastUri);
const {readStatutoryDetails,writeStatutoryDetails}=await import(statutoryUri);
const plan={id:'P1',equipment:'E1',equipmentName:'크레인',title:'사전점검',method:'PM',catalogState:'approved',checklist:[{name:'점검',criteria:'기준'}],evidence:writeForecast({...emptyForecast,partCode:'PART1',partName:'모터',interval:1,lastDate:'2026-10-01'},'')};
const record=(id,extra={})=>({id,type:'workorder',title:'작업',equipmentId:'E1',equipmentName:'크레인',status:'배정',assignee:'시설팀',dueDate:'2026-11-03',preventivePlanId:'P1',planning:{plannedDate:'2026-11-02',plannedStartAt:'',plannedEndAt:'',actualEndAt:'',window:'morning',approval:'승인',estimatedMinutes:60},...extra});
test('month grid covers six complete weeks and year/month boundaries',()=>{
 const days=monthDays('2027-01');assert.equal(days.length,42);assert.equal(days[0],'2026-12-27');assert.equal(days[41],'2027-02-06');assert.equal(new Set(days).size,42);
 assert.ok(monthDays('2024-02').includes('2024-02-29'));assert.deepEqual(monthDays('2026-13'),[]);assert.equal(shiftCalendarMonth('2026-12',1),'2027-01');assert.equal(shiftCalendarMonth('2027-01',-1),'2026-12');
});
test('only a planned date is a reservation; deadline fallback is explicitly unplanned',()=>{
 const rows=buildMaintenanceEvents([record('booked'),record('deadline',{planning:undefined}),record('missing',{planning:undefined,dueDate:''})],[],'2026-10-23',new Set(['E1']));
 assert.equal(rows.find(e=>e.recordId==='booked').kind,'work');assert.equal(rows.find(e=>e.recordId==='deadline').kind,'deadline');assert.equal(rows.some(e=>e.recordId==='missing'),false);
});
test('multi-day work appears on every day of its range without duplicating the source record',()=>{
 const r=record('span');r.planning={...r.planning,window:'weekday',plannedEndAt:'2026-11-04T17:00'};
 const rows=buildMaintenanceEvents([r],[],'2026-10-23',new Set(['E1']));assert.equal(rows.length,1);assert.equal(eventsOnDay(rows,'2026-11-03').length,1);assert.equal(eventsOnDay(rows,'2026-11-05').length,0);
});
test('completed work uses actual completion date rather than a planned or due date',()=>{
 const r=record('done',{status:'완료'});r.planning={...r.planning,actualEndAt:'2026-11-05T09:00'};
 const rows=buildMaintenanceEvents([r,record('unknown',{status:'완료'})],[],'2026-11-06',new Set(['E1']));assert.equal(rows.length,1);assert.equal(rows[0].kind,'done');assert.equal(rows[0].date,'2026-11-05');
});
test('ready forecasts and statutory due dates stay distinct and linked work suppresses duplicate forecasts',()=>{
 const legal={...plan,id:'L1',method:'법정검사',evidence:writeStatutoryDetails({...readStatutoryDetails(),nextDate:'2026-11-12'})};
 let rows=buildMaintenanceEvents([],[plan,legal],'2026-10-23',new Set(['E1']));assert.equal(rows.filter(e=>e.kind==='forecast').length,1);assert.equal(rows.filter(e=>e.kind==='legal').length,1);
 rows=buildMaintenanceEvents([record('active')],[plan,legal],'2026-10-23',new Set(['E1']));assert.equal(rows.filter(e=>e.kind==='forecast').length,0);
});
test('morning overload sums only named, non-held planned work and warns above 90 minutes',()=>{
 const rows=buildMaintenanceEvents([record('a'),record('b'),record('hold',{status:'보류'}),record('unassigned',{assignee:''})],[],'2026-10-23',new Set(['E1']));assert.deepEqual(morningOverloads(rows),[['시설팀',120]]);
});
