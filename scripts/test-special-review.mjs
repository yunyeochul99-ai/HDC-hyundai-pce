import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=(await readFile(new URL('../src/maintenance.ts',import.meta.url),'utf8')).replace("import { readableError, supabase } from './backend';",'');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {needsSpecialReview,assessPlan,defaultPlan,defaultPolicy}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const policy={...defaultPolicy,highCostThreshold:500000};
const normal={...defaultPlan,plannedDate:'2027-02-15',window:'morning',estimatedMinutes:90,estimatedCost:0};
test('approved 90-minute work leaves review inbox while remaining in morning work and retaining production impact',()=>{
 const plan={...normal,approval:'승인',productionImpact:true};
 assert.equal(needsSpecialReview(plan,policy),false);
 assert.equal(assessPlan(plan,policy).morningEligible,true);
 assert.equal(plan.productionImpact,true);
});
test('approved long, high-cost and impact work is reviewed, while pending versions remain visible',()=>{
 for(const risk of [{estimatedMinutes:91},{estimatedCost:500000},{qualityImpact:true},{productionImpact:true},{plannedDate:'2027-02-14',window:'sundayEmergency',category:'긴급사후보전',emergencyReason:'Emergency'}]){
  assert.equal(needsSpecialReview({...normal,...risk,approval:'승인'},policy),false);
  assert.equal(needsSpecialReview({...normal,...risk,approval:'미검토'},policy),true);
 }
});
test('re-review and rejected plans return to the queue; ordinary work requires no special review',()=>{
 assert.equal(needsSpecialReview({...normal,approval:'검토요청'},policy),true);
 assert.equal(needsSpecialReview({...normal,approval:'반려'},policy),true);
 assert.equal(needsSpecialReview(normal,policy),false);
 assert.equal(needsSpecialReview(undefined,policy),false);
});
test('approval does not bypass execution or completion checks',()=>{
 const plan={...normal,approval:'승인',estimatedCost:null};
 assert.equal(needsSpecialReview(plan,policy),false);
 assert.ok(assessPlan(plan,policy,'배정').errors.some(error=>error.includes('예상비용')));
 assert.ok(assessPlan(plan,policy,'완료').errors.some(error=>error.includes('기능·품질')));
});
