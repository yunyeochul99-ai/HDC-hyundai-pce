import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=(await readFile(new URL('../src/catalog.ts',import.meta.url),'utf8')).replace("import {readableError,supabase} from './backend';",'');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {mergeCatalog}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('legal inspection targets remain registered without duplicating normal assets or periodic templates',()=>{
 const base={equipment:[{id:'MACHINE',name:'Existing machine'},{id:'LEGAL-TARGET',name:'Inspection target',isStatutoryTarget:true}],checklists:[],workorders:[{id:'PLAN',equipment:'LEGAL-TARGET'}]};
 const extra={equipment:[{id:'CUSTOM',name:'Purchased machine'}],checklists:[]};
 const before=JSON.stringify(base);
 const merged=mergeCatalog(base,extra);
 assert.deepEqual(merged.equipment.map(e=>e.id),['MACHINE','CUSTOM']);
 assert.equal(base.equipment.find(e=>e.id==='LEGAL-TARGET').name,'Inspection target');
 assert.equal(merged.workorders[0].equipment,'LEGAL-TARGET');
 assert.equal(JSON.stringify(base),before);
});
test('unflagged equipment stays visible and registered ids stay unique',()=>{
 const result=mergeCatalog({equipment:[{id:'A',name:'Original'}],checklists:[]},{equipment:[{id:'A',name:'Duplicate'},{id:'B',name:'Added',isStatutoryTarget:false}],checklists:[]});
 assert.deepEqual(result.equipment.map(e=>e.name),['Original','Added']);
});
