const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
const start=source.indexOf('function updateInstallChoice(){');
const end=source.indexOf("$('#install-os').addEventListener",start);
function choose(os,browser){
 const elements={};for(const id of ['install-os','install-browser','install-download','download-help','install-guidance','browser-help','os-help'])elements['#'+id]={value:'',hidden:false,textContent:'',href:''};
 elements['#install-os'].value=os;elements['#install-browser'].value=browser;
 const context=vm.createContext({$:id=>elements[id]});vm.runInContext(source.slice(start,end),context);context.updateInstallChoice();return elements;
}
test('Windows Edge selects the Windows release and Edge guidance',()=>{const x=choose('windows','edge');assert.match(x['#install-download'].href,/MedicareCorsair\.exe$/);assert.match(x['#browser-help'].textContent,/Edge:/);assert.equal(x['#install-download'].hidden,false);});
test('Mac Firefox selects the Mac release and explains temporary setup',()=>{const x=choose('mac','firefox');assert.match(x['#install-download'].href,/MedicareCorsair-macOS\.zip$/);assert.match(x['#install-guidance'].textContent,/temporary/);});
test('Safari and missing selections cannot present a download',()=>{assert.equal(choose('mac','safari')['#install-download'].hidden,true);assert.equal(choose('','chrome')['#install-download'].hidden,true);});
