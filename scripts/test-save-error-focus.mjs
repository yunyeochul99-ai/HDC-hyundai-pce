import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/save-error-focus.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {saveErrorFields,focusSaveError}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const aggregate='배정·실행 전에 근무일 계획일·시간대·예상 소요시간·예상비용을 입력하세요.';
test('aggregate server validation selects only missing prerequisites, preserving zero cost',()=>{
 assert.deepEqual(saveErrorFields(aggregate,{plannedDate:'2027-02-15',window:'morning',estimatedMinutes:90,estimatedCost:null}),['estimatedCost']);
 assert.deepEqual(saveErrorFields(aggregate,{plannedDate:'2027-02-15',window:'morning',estimatedMinutes:90,estimatedCost:0}),[]);
 assert.deepEqual(saveErrorFields(aggregate,{}),['plannedDate','window','estimatedMinutes','estimatedCost']);
});
test('execution and completion validation resolves timestamps and recovery checks',()=>{
 assert.deepEqual(saveErrorFields('실제 보전 시작 일시를 입력하세요.'),['actualStartAt']);
 assert.deepEqual(saveErrorFields('실제 종료는 시작 이후여야 합니다.'),['actualEndAt']);
 assert.deepEqual(saveErrorFields('완료 전 기능·품질 확인과 생산 인계를 모두 확인하세요.'),['functionChecked','qualityChecked','productionHandedOver']);
 assert.deepEqual(saveErrorFields('배정·진행·완료 전에 예상비용을 입력하세요.'),['estimatedCost']);
});
test('connection, permission and concurrent update errors do not blame an unrelated field',()=>{
 for(const message of ['인터넷 연결이 끊겨 전송을 시작하지 못했습니다.','작성자 또는 관리자만 수정할 수 있습니다.','다른 사용자가 수정한 기록입니다.']) assert.deepEqual(saveErrorFields(message),[]);
});
function control(key,value='',extra={}) {
 const attrs={};const label={setAttribute:(k,v)=>{label[k]=v;}};
 return {dataset:{saveField:key},value,type:'text',disabled:false,readOnly:false,getClientRects:()=>[{}],setAttribute:(k,v)=>{attrs[k]=v;},removeAttribute:k=>{delete attrs[k];},closest:()=>label,scrollIntoView(){this.scrolled=true;},focus(){this.focused=true;},attrs,...extra};
}
test('focus moves to the first visible editable missing field and keeps typed values',()=>{
 globalThis.requestAnimationFrame=fn=>fn();
 const date=control('plannedDate','2027-02-15'),cost=control('estimatedCost'),fallback=control('error');
 const form={isConnected:true,querySelectorAll:s=>s==='[data-save-field]'?[date,cost]:[],querySelector:()=>fallback};
 focusSaveError(form,aggregate,{plannedDate:date.value,window:'morning',estimatedMinutes:90});
 assert.equal(cost.focused,true);assert.equal(cost.scrolled,true);assert.equal(cost.attrs['aria-invalid'],'true');
 assert.equal(date.value,'2027-02-15');assert.equal(date.focused,undefined);
});
test('read-only or hidden fields and non-field failures use the error summary',()=>{
 globalThis.requestAnimationFrame=fn=>fn();
 for(const field of [control('approval','미검토',{disabled:true}),control('approval','미검토',{getClientRects:()=>[]})]) {
  const fallback=control('error');const form={isConnected:true,querySelectorAll:s=>s==='[data-save-field]'?[field]:[],querySelector:()=>fallback};
  focusSaveError(form,'작업계획 승인 후 실행·완료를 등록하세요.');assert.equal(fallback.focused,true);assert.equal(field.focused,undefined);
 }
});
