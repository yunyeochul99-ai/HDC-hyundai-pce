import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/inspection-templates.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {periodicTemplates}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('each registered equipment has three stable periodic forms, including newly purchased equipment',()=>{
 const catalog={equipment:Array.from({length:21},(_,i)=>({id:`EQ-${i}`,name:`Equipment ${i}`})),checklists:[]};
 const forms=periodicTemplates(catalog);assert.equal(forms.length,63);assert.equal(new Set(forms.map(t=>t.id)).size,63);
 for(const eq of catalog.equipment)assert.deepEqual(forms.filter(t=>t.equipment===eq.id).map(t=>t.cycle),['일일','주간','월간']);
 const added=periodicTemplates({...catalog,equipment:[...catalog.equipment,{id:'NEW',name:'Purchased'}]});assert.equal(added.length,66);assert.deepEqual(added.slice(0,63),forms);
});
test('existing cycle-specific standards are preserved without copying them into unrelated cycles',()=>{
 const item={id:'source-item',name:'Check',criteria:'Approved standard'};
 const forms=periodicTemplates({equipment:[{id:'EQ',name:'Equipment'}],checklists:[{id:'SOURCE',equipment:'EQ',title:'Source',cycle:'주간/월간',items:[item]}]});
 assert.deepEqual(forms[1].items,[item]);assert.deepEqual(forms[2].items,[item]);assert.match(forms[0].items[0].criteria,/현장 확인 필요/);
});
test('missing standards are explicit field-review drafts and source arrays are not mutated',()=>{
 const catalog={equipment:[{id:'EQ',name:'Equipment'}],checklists:[]};const before=JSON.stringify(catalog);
 for(const form of periodicTemplates(catalog)){assert.ok(form.items.length>0);assert.match(form.items[0].criteria,/현장 확인 필요/);assert.match(form.items[0].criteria,/미등록/);}
 assert.equal(JSON.stringify(catalog),before);
});
