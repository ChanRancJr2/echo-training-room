import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const issueIds=['lunch','return','focus'];
const sampleText=()=> '这周六我希望';
function harness(){
  const screen={innerHTML:''},toast={textContent:'',classList:{add(){},remove(){}}};
  const fields={guardian:{checked:true},'custom-topic':{value:'照护安排'},'invite-password':{value:'1234'},'teen-name':{value:'小禾'},'guardian-pin':{value:'1234'},'guardian-unlock':{value:''},'observer-note':{value:'可以问午饭是否有条件'},'observer-tag':{value:'重点被误解'},nickname:{value:'小回声'}};
  const handlers={},clock=new Map();let nextTimer=1,currentAudio,pauses=0;
  class Audio { readyState=1; currentTime=0; play(){currentAudio=this;return Promise.resolve();} pause(){pauses++;} }
  class SpeechSynthesisUtterance{constructor(text){this.text=text}}
  const document={getElementById:id=>id==='screen'?screen:id==='toast'?toast:fields[id]||null,querySelectorAll:()=>[],addEventListener:(type,fn)=>{handlers[type]=fn}};
  const ctx=vm.createContext({document,window:{scrollTo(){}},setTimeout:()=>nextTimer++,clearTimeout(){},setInterval:fn=>{const id=nextTimer++;clock.set(id,fn);return id},clearInterval:id=>clock.delete(id),Audio,Date});
  vm.runInContext(source,ctx);
  const click=(dataset,disabled=false)=>handlers.click({target:{closest:()=>({dataset,disabled})}});
  const input=(id,value)=>{fields[id]={value};handlers.input({target:{id,value}})};
  const change=(dataset,value,checked)=>handlers.change({target:{dataset,value,checked,id:dataset?.id}});
  const has=text=>assert.ok(screen.innerHTML.includes(text),`missing ${text}`);
  const lacks=text=>assert.ok(!screen.innerHTML.includes(text),`unexpected ${text}`);
  const step=n=>has(`第 ${n} 步 / 9`);
  return {screen,fields,click,input,change,has,lacks,step,get audio(){return currentAudio},get pauses(){return pauses},clock,ctx};
}

for(const mode of ['sync','solo','teen','async']){
  const h=harness(),{click,input,change,has,lacks,step}=h;
  click({mode});has('自定义填写');
  click({topic:'custom'});input('custom-topic','照护安排');
  click({duration:'60'});click({assist:'关键词辅助'});
  if(mode==='teen'){input('teen-name','小禾');input('guardian-pin','1234');}
  click({action:'create'});has('照护安排');
  if(mode==='sync'||mode==='async'){
    click({expiry:'1 小时'});click({action:'togglePassword'});input('invite-password','1234');
    click({action:'toggleOnce'});click({action:'invite'});has('链接已使用');
  }
  if(mode==='sync'){
    click({action:'observer'});has('查看观察者视角');click({action:'observerView'});has('不能替表达者或复述者确认');
    input('observer-note','可以问午饭是否有条件');change({id:'observer-tag'},'杜撰信息');
    click({action:'saveObserver'});has('准备好，慢慢开始');
  }
  click({action:'next'});step(1);click({action:'next'});step(2);
  has('录音转写');lacks('实时文字提示');
  assert.equal(vm.runInContext('s.transcriptionEnabled',h.ctx),false,`${mode}: transcription defaults off`);
  assert.match(h.screen.innerHTML, /data-action="toggleTranscription"[^>]*disabled/,`${mode}: transcription disabled until recording ends`);
  click({action:'toggleTranscription'});assert.equal(vm.runInContext('s.transcriptionEnabled',h.ctx),false);
  click({action:'record'});has('正在模拟录音');
  click({action:'record'});has('继续录音');has('删除录音，重新录入');lacks(sampleText());
  click({action:'deleteRecord'});has('开始录音');lacks('继续录音');assert.equal(vm.runInContext('s.seconds',h.ctx),0);
  click({action:'record'});click({action:'record'});has('继续录音');
  click({action:'record'});click({action:'finishRecord'});has('录音已完成');
  lacks(sampleText());click({action:'toggleTranscription'});has(sampleText());
  click({action:'deleteRecord'});has('开始录音');lacks(sampleText());assert.equal(vm.runInContext('s.transcriptionEnabled',h.ctx),false);
  click({action:'record'});click({action:'finishRecord'});click({action:'toggleTranscription'});has(sampleText());
  click({action:'next'});step(3);for(const kind of ['人物：','事件：','需求：','因果：','重点：'])has(kind);
  click({action:'next'});
  if(mode==='async'){
    has('留言已准备好');click({action:'asyncRemind'});has('已模拟提醒搭档');click({action:'asyncOpen'});
  }
  if(mode==='teen'){
    has('交棒给孩子');click({action:'teenEnter'});has('当前为 小禾 的复述者座位');
    click({action:'profile'});has('需要监护人验证');
    h.fields['guardian-unlock'].value='0000';click({action:'unlockGuardian'});has('需要监护人验证');
    click({action:'cancelGuardian'});step(4);
  }
  step(4);
  has('开始模拟复述');
  assert.ok(!h.screen.innerHTML.match(/<button[^>]*data-action="retell"[^>]*>/)?.[0].includes('disabled'),'retell can start before audio completes');
  click({action:'next'});step(4);
  click({action:'play'});await Promise.resolve();has('暂停表达者音频');
  click({action:'retell'});has('暂停复述');has('继续播放');assert.equal(h.pauses,1,'starting retell pauses expression audio');
  assert.equal(vm.runInContext('s.plays',h.ctx),0,'first expression playback was interrupted');
  click({action:'retell'});has('继续复述');
  click({action:'deleteRetell'});has('开始模拟复述');lacks('继续复述');assert.equal(vm.runInContext('s.retellSeconds',h.ctx),0);
  click({action:'retell'});click({action:'finishRetell'});has('复述已完成');
  click({action:'next'});step(4);change({id:'retell-consent'},undefined,true);
  click({action:'next'});
  if(mode==='teen'){has('请把手机交还监护人');click({action:'teenBack'});}
  step(5);has('完整度');has('准确度');has('偏差类型');has('可澄清点');has('2 / 5');
  for(const text of ['午饭的前提被省略','疲累时早归没有复述','最重要的条件没有保留','表达者原话','复述者原话'])has(text);
  if(mode==='sync'){has('观察者建议');click({action:'observerView'});has('可旁观的逐条差异');has('复述：然后一起吃午饭');click({action:'observerBack'});step(5);}
  click({action:'next'});step(6);has('表达者逐条标注');
  change({reviewTag:'lunch'},'我表达不清');
  click({action:'next'});step(7);
  for(const id of issueIds)click({action:'speakerConfirm',issue:id});
  if(mode==='sync'||mode==='async')click({confirmDevice:'listener'});
  for(const id of issueIds)click({action:'listenerConfirm',issue:id});
  has('查看改写建议');
  if(mode==='sync'||mode==='async')click({confirmDevice:'speaker'});
  click({resolution:'表达问题',issue:'lunch'});has('点击确认');
  click({action:'speakerConfirm',issue:'lunch'});
  if(mode==='sync'||mode==='async')click({confirmDevice:'listener'});
  click({action:'listenerConfirm',issue:'lunch'});
  if(mode==='sync'||mode==='async')click({confirmDevice:'speaker'});
  click({action:'next'});step(8);click({action:'adopt'});
  click({action:'next'});step(9);has('双方逐条确认');has('2 / 5');
  if(mode==='sync')assert.ok(!vm.runInContext('s.history[0].tags.includes("杜撰信息")',h.ctx),'observer suggestion is excluded from confirmed tags');
  if(mode==='sync'){click({action:'again'});has('准备好，慢慢开始');click({action:'next'});step(1);click({action:'history'});}
  if(mode==='async'){
    click({action:'asyncRetry'});has('第 2 种问法');click({action:'asyncOpen'});step(4);
    click({action:'retell'});click({action:'finishRetell'});change({id:'retell-consent'},undefined,true);click({action:'next'});step(5);has('4 / 5');
    assert.equal(vm.runInContext('issues().length',h.ctx),1,'second formulation leaves one issue');
    click({action:'next'});click({action:'next'});click({action:'speakerConfirm',issue:'focus'});click({confirmDevice:'listener'});click({action:'listenerConfirm',issue:'focus'});click({confirmDevice:'speaker'});
    click({action:'next'});click({action:'next'});step(9);
    click({action:'asyncRetry'});has('第 3 种问法');click({action:'asyncOpen'});
    click({action:'retell'});click({action:'finishRetell'});change({id:'retell-consent'},undefined,true);click({action:'next'});step(5);has('5 / 5');has('没有发现偏差');
    click({action:'next'});click({action:'next'});click({action:'next'});click({action:'next'});step(9);
    assert.equal(vm.runInContext('s.history.filter(h=>h.mode==="async"&&!h.sample).length',h.ctx),3,'same message has three archived attempts');
    click({action:'history'});click({review:'async'});has('复述完整率（%）');has('误解类标签（条）');
  }else{
    click({action:'history'});has('复述完整率（%）');has('误解类标签（条）');
    click({review:mode});has('变化趋势');has('轮次记录');
    const records=vm.runInContext(`s.history.filter(h=>h.mode==='${mode}').length`,h.ctx);
    assert.ok(records>=2,`${mode}: new round archived`);
    const latestId=vm.runInContext(`s.history.find(h=>h.mode==='${mode}').id`,h.ctx);
    click({action:'viewReport',historyId:latestId});has('轮次详情');has('本次演示');
    click({action:'history'});has('变化趋势');
  }
  console.log(`${mode}: role flow, recording, comparison, confirmations, report and trend passed`);
}

{
  const h=harness(),{click,input,change,has,lacks,step}=h;
  click({mode:'solo'});click({action:'create'});click({action:'next'});click({action:'next'});
  click({action:'record'});click({action:'finishRecord'});click({action:'next'});step(3);
  has('转写已关闭');lacks(sampleText());click({action:'next'});step(3);
  click({action:'loadExamplePoints'});input('extra-point','情绪：有点担心外婆');
  change({point:'1'},undefined,false);
  click({action:'next'});click({action:'retell'});click({action:'finishRetell'});change({id:'retell-consent'},undefined,true);click({action:'next'});
  step(5);has('1 / 5');has('补充的重点未被复述');
  assert.equal(vm.runInContext('issues().length',h.ctx),4,'all problematic selected points get paired evidence');
  console.log('custom point and deselection update both metrics and issue list');
}

{
  const h=harness(),{click,change,has,step}=h;
  click({mode:'teen'});click({action:'create'});click({action:'next'});click({action:'next'});
  click({action:'record'});click({action:'finishRecord'});click({action:'next'});click({action:'loadExamplePoints'});click({action:'next'});
  click({action:'teenEnter'});step(4);click({action:'back'});has('需要监护人验证');
  h.fields['guardian-unlock'].value='1234';click({action:'unlockGuardian'});step(3);
  console.log('guardian verification restores parent seat before leaving child view');
}

for(const mode of ['sync','async']){
  const h=harness(),{click,change,has,step}=h;
  vm.runInContext(`s.mode='${mode}';s.view='session';s.stage=7;s.points=sample.points.map((_,i)=>i);render()`,h.ctx);
  has('表达者手机');has('复述者手机');has('当前页面没有真实账号验证或跨设备同步');
  click({action:'listenerConfirm',issue:'lunch'});
  assert.equal(vm.runInContext('s.review.lunch.listenerOK',h.ctx),false,'speaker device cannot confirm as listener');
  for(const id of issueIds)click({action:'speakerConfirm',issue:id});
  click({confirmDevice:'listener'});
  click({resolution:'AI 误判',issue:'lunch'});
  assert.equal(vm.runInContext('s.review.lunch.resolution',h.ctx),'真误解','listener device cannot change speaker resolution');
  for(const id of issueIds)click({action:'listenerConfirm',issue:id});
  assert.equal(vm.runInContext('allConfirmed()',h.ctx),true);
  click({action:'next'});step(7);
  click({confirmDevice:'speaker'});click({action:'next'});step(8);
  console.log(`${mode}: separate device confirmations and speaker-only submission passed`);
}

{
  const h=harness(),{click,change,has,step}=h;
  click({mode:'teen'});click({teenRole:'speaker'});has('孩子本轮身份');
  click({action:'create'});has('小禾');has('孩子本轮担任表达者');
  click({action:'next'});step(1);click({action:'next'});has('交棒给孩子');
  click({action:'teenEnter'});step(2);click({action:'profile'});has('需要监护人验证');
  click({action:'cancelGuardian'});has('录音转写');click({action:'record'});click({action:'deleteRecord'});has('开始录音');
  click({action:'record'});click({action:'finishRecord'});click({action:'toggleTranscription'});has('这周六我希望');
  click({action:'next'});step(3);click({action:'next'});has('请把手机交还监护人');
  click({action:'teenBack'});step(4);has('当前为 监护人 的复述者座位');
  console.log('teen speaker role and handoff passed');
}

{
  const h=harness(),{click,has,ctx}=h;
  click({action:'history'});click({action:'viewReport',historyId:'sync-3'});
  has('导出报告（TXT）');has('表达者 · 复述者');
  click({action:'toggleAnonymous'});has('座位 A · 座位 B');
  assert.ok(!h.screen.innerHTML.includes('参与者：表达者 · 复述者'),'anonymous view hides participant names');
  const link=h.screen.innerHTML.match(/href="(data:text\/plain[^\"]+)"/)[1];
  assert.ok(decodeURIComponent(link).includes('参与者：座位 A · 座位 B'),'export respects anonymous mode');
  click({action:'requestDeleteRound'});has('删除后不可恢复');has('单轮');
  click({action:'cancelDelete'});has('轮次详情');
  click({action:'requestDeleteRound'});click({action:'confirmDelete'});
  assert.equal(vm.runInContext('s.history.some(h=>h.id==="sync-3")',ctx),false);
  click({action:'viewReport',historyId:'sync-2'});click({action:'requestDeleteRoom'});has('整个训练室');
  click({action:'confirmDelete'});
  assert.equal(vm.runInContext('s.history.filter(h=>h.mode==="sync").length',ctx),0);
  click({action:'profile'});click({action:'requestDeleteAll'});has('全部数据');
  click({action:'confirmDelete'});
  assert.equal(vm.runInContext('s.history.length',ctx),0);
  console.log('anonymous export and three deletion scopes passed');
}
