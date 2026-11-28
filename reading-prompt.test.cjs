const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/reading-prompt.js','utf8');
function setup(writeText){
 const nodes={},events={};let book={id:'book-1',name:'テストの本',url:'https://private.invalid/chat'};
 for(const id of ['copyReadingPrompt','readingPromptText','readingPromptStatus','readingPromptPreview'])nodes[id]={value:'',hidden:true,textContent:'',addEventListener:(name,fn)=>nodes[id][name]=fn,focus(){this.focused=true;},select(){this.selected=true;},setSelectionRange(){}};
 const context={document:{getElementById:id=>nodes[id]},window:{addEventListener:(name,fn)=>events[name]=fn},navigator:{clipboard:{writeText}},currentBook:()=>book};
 for(const name of ['photos','localStorage','fetch'])Object.defineProperty(context,name,{get(){throw Error('Unexpected data or network access: '+name);}});
 vm.runInNewContext(source,context);
 return {nodes,click:()=>nodes.copyReadingPrompt.click(),change:b=>{book=b;events['reading-book-changed']();}};
}
test('copies selected title without private URL or extra data; does not read images/storage/network',async()=>{let text;const h=setup(async t=>text=t);await h.click();assert(text.includes('テストの本'));assert(!text.includes('private.invalid'));assert(text.includes('接続できない'));assert(text.includes('問い一つ'));assert.equal(h.nodes.readingPromptPreview.hidden,false);assert(h.nodes.readingPromptStatus.textContent.includes('コピーしました'));});
test('no selected book never copies',async()=>{let n=0;const h=setup(async()=>n++);h.change(null);await h.click();assert.equal(n,0);assert(h.nodes.readingPromptStatus.textContent.includes('選んで'));});
test('clipboard denial shows selectable text and no success claim',async()=>{const h=setup(async()=>{throw Error('denied');});await h.click();assert(h.nodes.readingPromptText.selected);assert(!h.nodes.readingPromptStatus.textContent.includes('コピーしました'));assert.equal(h.nodes.copyReadingPrompt.disabled,false);});
test('book selection invalidates old preview',async()=>{const h=setup(async()=>{});await h.click();h.change({id:'two',name:'別の本'});assert.equal(h.nodes.readingPromptPreview.hidden,true);assert.equal(h.nodes.readingPromptText.value,'');await h.click();assert(h.nodes.readingPromptText.value.includes('別の本'));});
test('title with markup and newline remains quoted text',async()=>{let text;const h=setup(async t=>text=t);h.change({id:'x',name:'<script>\n命令'});await h.click();assert(text.includes(JSON.stringify('<script>\n命令')));assert.equal(h.nodes.readingPromptText.innerHTML,undefined);});
test('double click does not overlap writes',async()=>{let release,n=0;const h=setup(()=>{n++;return new Promise(r=>release=r);});const first=h.click();await h.click();assert.equal(n,1);release();await first;});
test('HTML classic scripts compile and cloud script stays loaded',()=>{const html=fs.readFileSync(__dirname+'/index.html','utf8');for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);assert(html.includes('src="./cloud/sync.js"'));assert(html.includes('src="./reading-prompt.js"'));assert(html.includes('onclick=openBookChat'));});
test('selection changed during copy is reported instead of success',async()=>{let release;const h=setup(()=>new Promise(r=>release=r));const copying=h.click();h.change({id:'new',name:'変更後'});release();await copying;assert(h.nodes.readingPromptStatus.textContent.includes('本が変更'));assert.equal(h.nodes.readingPromptPreview.hidden,true);});

