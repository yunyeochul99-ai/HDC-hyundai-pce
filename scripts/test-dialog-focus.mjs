import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Exercise the actual dialog lifecycle through saving-state transitions.
const source=await readFile(new URL('../src/Workspace.tsx',import.meta.url),'utf8');
const lifecycle=source.split('\n').find(line=>line.includes("const dialog=document.querySelector<HTMLElement>('[role=\"dialog\"]')"));
assert.ok(lifecycle,'record dialog lifecycle exists');
const js=ts.transpileModule(lifecycle,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const renderEffect=new Function('useEffect','document','modal','detail','saving','catalogOpen','saveLock','setModal','setDetail',js);
function setup(){
 let active=null,dependencies,cleanup,handler,closed=0;
 const control=()=>({offsetParent:{},focus(){active=this;}});
 const previous=control(),first=control(),missing=control();previous.focus();
 const dialog={querySelector:()=>first,querySelectorAll:()=>[first,missing]};
 const doc={body:{style:{overflow:'auto'}},get activeElement(){return active;},querySelector:()=>dialog,addEventListener:(_,fn)=>{handler=fn;},removeEventListener:()=>{handler=null;}};
 const useEffect=(fn,next)=>{if(!dependencies||next.some((x,i)=>!Object.is(x,dependencies[i]))){cleanup?.();cleanup=fn();dependencies=next;}};
 const lock={current:false};
 return {first,missing,previous,lock,get active(){return active;},get closed(){return closed;},render(saving,modal={}){renderEffect(useEffect,doc,modal,null,saving,false,lock,()=>closed++,()=>closed++);},escape(){handler({key:'Escape'});}};
}
test('server failure and repeated renders preserve focus on the missing field',()=>{
 const view=setup();view.render(false);assert.equal(view.active,view.first);
 view.lock.current=true;view.render(true);
 view.missing.focus();view.lock.current=false;view.render(false);
 assert.equal(view.active,view.missing,'saving completion must not reset dialog focus');
 view.render(false);assert.equal(view.active,view.missing,'record/error refresh must preserve focus');
});
test('Escape uses the current save lock without reinstalling the focus lifecycle',()=>{
 const view=setup();view.render(false);view.lock.current=true;view.escape();assert.equal(view.closed,0);
 view.lock.current=false;view.escape();assert.equal(view.closed,2);
});
test('closing the dialog restores focus to the original control',()=>{
 const view=setup();view.render(false);view.missing.focus();view.render(false,null);assert.equal(view.active,view.previous);
});
