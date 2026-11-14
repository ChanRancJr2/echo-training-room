const root = document.getElementById('screen');
const modes = {
  sync: ['双人同步练','◎','两台设备，一人表达，一人先听再复述。'],
  solo: ['双座位自练','↔','同一人切换两个座位，练习换位倾听。'],
  teen: ['亲子同机练','✳','监护人与孩子在一台手机上交棒。'],
  async: ['异步留言练','◷','先留下表达，对方有空时再盲听复述。']
};
const topics = ['家庭日常','大学生活','疾病与需求','工作需求'];
const asyncQuestions = ['用自己的话复述原意','列出需要一起决定的安排','说出表达者最在意的条件'];
const labels = ['遗漏重要信息','理解不到位','理解偏了','杜撰信息','强加信息','我表达不清','我言不达意','语气被误解','重点被误解','AI 误判'];
const stepNames = ['训练室','定任务','表达者说','系统划重点','复述者复述','系统对比','表达者标注','复述者澄清','收下建议','复盘归档'];
const sample = {
  speech:'这周六我希望我们先去看外婆。如果她身体允许，再一起吃午饭；如果她累了，就早点回来。',
  retell:'你希望周六去看外婆，然后一起吃午饭。',
  points:[['人物','外婆、我们'],['事件','周六先去看望外婆'],['需求','如果外婆身体允许，再一起吃午饭'],['因果','如果外婆累了，就早点回来'],['重点','午饭安排取决于外婆的身体情况']]
};
const asyncRetells=[sample.retell,'你想周六先去看外婆。午饭要看她身体情况，如果累了就早点回来。','周六先去看外婆，先看她的状态，再决定是否一起吃午饭；累了就早点回来。'];
const pointEvidence = [
  {id:'person',complete:true,accurate:true},
  {id:'visit',complete:true,accurate:true},
  {id:'lunch',complete:false,accurate:false,tag:'理解偏了',title:'午饭的前提被省略',original:'如果她身体允许，再一起吃午饭。',retell:'然后一起吃午饭。',clarify:'午饭是否需要先看外婆的身体情况？'},
  {id:'return',complete:false,accurate:false,tag:'遗漏重要信息',title:'疲累时早归没有复述',original:'如果她累了，就早点回来。',retell:'（没有提到早归安排）',clarify:''},
  {id:'focus',complete:false,accurate:false,tag:'重点被误解',title:'最重要的条件没有保留',original:'如果她身体允许，再一起吃午饭；如果她累了，就早点回来。',retell:'然后一起吃午饭。',clarify:'“午饭”是否被听成已经确定的安排？'}
];
const mockHistory = [
  {id:'sync-3',mode:'sync',topic:'家庭日常',complete:4,total:5,accurate:4,tags:['遗漏重要信息'],sample:true},
  {id:'sync-2',mode:'sync',topic:'照护与需求',complete:3,total:5,accurate:3,tags:['遗漏重要信息','理解偏了'],sample:true},
  {id:'sync-1',mode:'sync',topic:'工作需求',complete:2,total:5,accurate:2,tags:['遗漏重要信息','理解偏了','重点被误解'],sample:true},
  {id:'solo-3',mode:'solo',topic:'家庭日常',complete:4,total:6,accurate:4,tags:['遗漏重要信息'],sample:true},
  {id:'solo-2',mode:'solo',topic:'家庭日常',complete:3,total:6,accurate:3,tags:['遗漏重要信息','理解不到位'],sample:true},
  {id:'solo-1',mode:'solo',topic:'大学生活',complete:2,total:6,accurate:3,tags:['遗漏重要信息','重点被误解','理解不到位'],sample:true},
  {id:'teen-2',mode:'teen',topic:'家庭日常',complete:4,total:5,accurate:4,tags:['重点被误解'],sample:true},
  {id:'teen-1',mode:'teen',topic:'家庭日常',complete:2,total:5,accurate:3,tags:['遗漏重要信息','理解偏了'],sample:true},
  {id:'async-2',mode:'async',topic:'照护与需求',complete:4,total:6,accurate:4,tags:['遗漏重要信息'],sample:true},
  {id:'async-1',mode:'async',topic:'照护与需求',complete:3,total:6,accurate:3,tags:['遗漏重要信息','理解偏了'],sample:true}
];
const misunderstandingLabels = new Set(['遗漏重要信息','理解不到位','理解偏了','杜撰信息','强加信息','语气被误解','重点被误解']);
const s = {
  view:'home',mode:null,stage:0,topic:'家庭日常',customTopic:'',duration:30,assist:'纯听觉',
  nickname:'小回声',guardian:false,teenName:'小禾',guardianPin:'1234',teenRole:'listener',teenSeat:'guardian',handoffTarget:4,returnTarget:5,actorRole:'speaker',anonymous:false,roomId:null,roomCounter:0,deleteIntent:null,deleteReturnView:'history',invited:false,observer:false,observerNote:'',observerTag:'遗漏重要信息',
  expiry:'24 小时',passwordOn:false,password:'',once:false,linkUsed:false,
  focus:'',recording:false,paused:false,recorded:false,seconds:0,transcriptionEnabled:false,
  playback:'idle',plays:0,keywords:false,retellConsent:false,retold:false,retelling:false,retellPaused:false,retellSeconds:0,reviewTab:'sync',selectedHistoryId:null,
  asyncDelivered:false,asyncReminder:false,asyncVariant:0,
  showSamplePoints:false,points:[],extraPoint:'',review:{},adopted:false,history:mockHistory.map(row=>({...row,tags:[...row.tags]}))
};
let ticker=null,retellTicker=null;
let sampleAudio=null, playbackAttempt=0;
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function toast(v){const e=document.getElementById('toast');e.textContent=v;e.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>e.classList.remove('show'),2500);}
function button(v,a,kind='primary',disabled=false){return `<button type="button" class="${kind}" data-action="${a}" ${disabled?'disabled':''}>${v}</button>`;}
function chip(v,attr,on){return `<button type="button" class="chip ${on?'active':''}" ${attr} aria-pressed="${on}">${esc(v)}</button>`;}
function back(){return button('← 返回','back','back');}
function heading(k,t,d=''){return `<p class="eyebrow">${k}</p><h1 class="page-title">${t}</h1>${d?`<p class="lead">${d}</p>`:''}`;}
function stepper(){return `<div class="step-label">${s.stage?`一轮九步 · 第 ${s.stage} 步 / 9 · ${stepNames[s.stage]}`:'训练室'}</div><div class="stepper">${stepNames.slice(1).map((_,i)=>`<span class="${i<s.stage?'done':''}"></span>`).join('')}</div>${s.observer&&s.mode==='sync'&&s.stage>0?`<div class="observer-entry">${button('切换至观察者视角','observerView','ghost')}</div>`:''}`;}
function currentTopic(){return s.topic==='custom'?s.customTopic:s.topic;}
function retellText(){return s.mode==='async'?asyncRetells[s.asyncVariant]:sample.retell;}
function scoredPoints(){
  const rows=s.points.map(i=>{
    const row=pointEvidence[i];if(!row)return null;
    const result={...row};
    if(s.mode==='async'&&s.asyncVariant>=1&&[2,3].includes(i)){result.complete=true;result.accurate=true;}
    if(s.mode==='async'&&s.asyncVariant>=2&&i===4){result.complete=true;result.accurate=true;}
    if(s.mode==='async'&&s.asyncVariant>=1&&i===4)result.retell=s.asyncVariant===1?'午饭要看她身体情况，如果累了就早点回来。':asyncRetells[2];
    return result;
  }).filter(Boolean);
  if(s.extraPoint.trim())rows.push({id:'extra',complete:false,accurate:false,tag:'遗漏重要信息',title:'补充的重点未被复述',original:s.extraPoint.trim(),retell:'（示例复述未提及）',clarify:''});
  return rows;
}
function issues(){return scoredPoints().filter(row=>!row.complete||!row.accurate);}
function metrics(){const rows=scoredPoints();return {complete:rows.filter(row=>row.complete).length,accurate:rows.filter(row=>row.accurate).length,total:rows.length};}
function reviewFor(issue){return s.review[issue.id]||(s.review[issue.id]={tag:issue.tag,resolution:'真误解',speakerOK:false,listenerOK:false});}
function allConfirmed(){return issues().every(issue=>{const item=reviewFor(issue);return item.speakerOK&&item.listenerOK;});}
function confirmedTags(){return issues().filter(issue=>{const item=reviewFor(issue);return item.speakerOK&&item.listenerOK&&item.resolution==='真误解';}).map(issue=>reviewFor(issue).tag);}
function coverage(){const m=metrics();return `${m.complete} / ${m.total}`;}
function accuracy(){const m=metrics();return `${m.accurate} / ${m.total}`;}
function home(){return `<section class="hero"><p class="eyebrow">LISTEN · RETELL · UNDERSTAND</p><h1>让“听懂了”，<br>变成<em>真的听懂。</em></h1><p class="lead">先复述，不评价。把说出去的和听到的放在一起，再慢慢聊清楚。</p><div class="hero-art" aria-hidden="true"><div class="wave"></div></div></section><div class="section-head"><h2>今天怎么练？</h2><small>选择一种方式</small></div>${Object.entries(modes).map(([k,m])=>`<button class="mode-card" data-mode="${k}"><span class="icon">${m[1]}</span><span><strong>${m[0]}</strong><small>${m[2]}</small></span><span class="arrow">↗</span></button>`).join('')}<div class="notice">AI 仅提供辅助提示，非诊断结论。此页面使用模拟数据，不能跨设备同步。</div>`;}
function setup(){
  const teen=s.mode==='teen'?`<div class="card"><h3>青少年临时身份</h3><p class="subtle">仅填写昵称，不收集孩子手机号。孩子可担任表达者或复述者；交棒与中途退出需监护人验证。</p><div class="field"><label for="teen-name">孩子昵称</label><input id="teen-name" class="input" maxlength="12" value="${esc(s.teenName)}"></div><div class="field"><label>孩子本轮身份</label><div class="option-grid">${chip('表达者','data-teen-role="speaker"',s.teenRole==='speaker')}${chip('复述者','data-teen-role="listener"',s.teenRole==='listener')}</div></div><div class="field"><label for="guardian-pin">监护人退出码（演示）</label><input id="guardian-pin" class="input" type="password" inputmode="numeric" maxlength="4" value="${esc(s.guardianPin)}"></div><label class="point"><input id="guardian" type="checkbox" ${s.guardian?'checked':''}> 我是监护人，同意本次模拟训练与交棒</label><p class="mini">这只是交互原型，退出码没有服务端安全保护。</p></div>`:'';
  return `${back()}${heading('CREATE A ROOM',modes[s.mode][0],modes[s.mode][2])}<div class="card"><div class="field"><label>本轮主题</label><div class="option-grid">${topics.map(t=>chip(t,`data-topic="${t}"`,s.topic===t)).join('')}${chip('自定义填写','data-topic="custom"',s.topic==='custom')}</div>${s.topic==='custom'?`<input id="custom-topic" class="input topic-input" maxlength="30" placeholder="写下本轮主题" value="${esc(s.customTopic)}" aria-label="自定义本轮主题">`:''}</div><div class="field"><label>每人发言时长</label><div class="choice-row">${[30,60,120,300].map(n=>chip(n===30?'30 秒':`${n/60} 分钟`,`data-duration="${n}"`,s.duration===n)).join('')}</div></div><div class="field"><label>复述方式</label><div class="choice-row">${['纯听觉','关键词辅助'].map(a=>chip(a,`data-assist="${a}"`,s.assist===a)).join('')}</div></div></div>${teen}${s.mode==='async'?'<div class="notice">先留言、模拟提醒、搭档稍后盲听；同一留言可换问法再练。</div>':''}${button('继续，创建训练室','create')}`;
}
function inviteOptions(){return `<div class="card"><h3>邀请搭档</h3><p class="subtle">演示链接：echo.room/demo-${s.mode}。以下设置只模拟界面，不会保护真实链接。</p><div class="field"><label>有效期</label><div class="choice-row">${['1 小时','24 小时','7 天'].map(x=>chip(x,`data-expiry="${x}"`,s.expiry===x)).join('')}</div></div><div class="field">${chip(s.passwordOn?'已开启密码':'设置密码','data-action="togglePassword"',s.passwordOn)}${s.passwordOn?`<input id="invite-password" class="input topic-input" inputmode="numeric" maxlength="4" placeholder="输入 4 位数字密码" value="${esc(s.password)}" aria-label="邀请密码">`:''}</div><div class="field">${chip(s.once?'一次性 · 用后失效':'一次性链接','data-action="toggleOnce"',s.once)}</div><p class="mini">${s.linkUsed?'此演示链接已使用，不能再次加入。':'创建后可模拟搭档加入。'}</p>${button(s.invited?'搭档已模拟加入':'模拟搭档打开链接','invite','secondary',s.invited)}</div>`;}
function room(){
  const special=s.mode==='solo'||s.mode==='teen';
  const speaker=s.mode==='teen'?(s.teenRole==='speaker'?s.teenName:'监护人'):special?'你自己':'你';
  const listener=s.mode==='teen'?(s.teenRole==='listener'?s.teenName:'监护人'):s.mode==='solo'?'交棒后还是你自己':s.invited?'练习搭档':'等待邀请';
  const observer=s.mode==='sync'?`<div class="seat"><div><b>观察者（可选）</b><br><small>只观看和建议标注，不参与最终确认</small></div>${chip(s.observer?'已加入':'模拟加入','data-action="observer"',s.observer)}</div>${s.observer?button('查看观察者视角','observerView','secondary'):''}`:'';
  return `${back()}${stepper()}${heading('YOUR TRAINING ROOM','准备好，慢慢开始',`本轮 · ${esc(currentTopic())} · ${s.duration} 秒 · ${esc(s.assist)}`)}<div class="card"><h3>${modes[s.mode][1]} ${modes[s.mode][0]}</h3><div class="seat"><div><b>座位 A · 表达者</b><br><small>${esc(speaker)}</small></div><span class="status">已就位</span></div><div class="seat"><div><b>座位 B · 复述者</b><br><small>${esc(listener)}</small></div><span class="status ${!special&&!s.invited?'wait':''}">${special||s.invited?'已就位':'待加入'}</span></div>${observer}<p class="mini">最多 3 人：表达者、复述者、观察者。</p></div>${!special?inviteOptions():`<div class="notice">${s.mode==='teen'?`孩子本轮担任${s.teenRole==='speaker'?'表达者':'复述者'}，交棒与退出需经过监护人确认。`:'一人使用两个座位，交棒后再复述。'}</div>`}${button(s.mode==='async'?'开始录制留言':'开始这一轮','next','primary',!special&&!s.invited)}`;
}
function task(){return `${back()}${stepper()}${heading('SET THE TASK','先定这轮任务','表达者可以预先标记最想让对方听到的重点。')}<div class="card"><h3>本轮设置</h3><p class="subtle">主题：${esc(currentTopic())} · 每人 ${s.duration} 秒 · ${esc(s.assist)}</p><div class="field"><label>预标本轮重点（可选）</label><input id="task-focus" class="input" maxlength="80" placeholder="例如：午饭要看外婆身体情况" value="${esc(s.focus)}"></div></div>${button('开始表达录音','next')}`;}
function record(){
  const time=`${String(Math.floor(s.seconds/60)).padStart(2,'0')}:${String(s.seconds%60).padStart(2,'0')}`;
  const recordLabel=s.recording?'暂停录音':s.paused?'继续录音':'开始录音';
  const status=s.recording?'正在模拟录音':s.paused?'已暂停，可继续或结束':s.recorded?'录音已完成':'点击开始，慢慢说';
  return `${back()}${stepper()}${heading('SPEAKER · SEAT A','先说出你的想法','围绕本轮主题说一小段。录音和计时均为模拟。')}<div class="card center"><div class="record-orb ${s.recording?'active':''}">${s.recording?'Ⅱ':'◉'}</div><div class="timer" id="record-time">${time}</div><p class="subtle">${status}</p>${!s.recorded?button(recordLabel,'record','primary'):''}${s.recording||s.paused?button('结束录音','finishRecord','secondary'):''}${s.recording||s.paused||s.recorded?button('删除录音，重新录入','deleteRecord','secondary'):''}</div><div class="card"><div class="seat"><div><b>录音转写</b><br><small>${s.recorded?'结束录音后，可选择查看本轮转写':'结束录音后才可开启'}</small></div><button type="button" class="chip ${s.transcriptionEnabled?'active':''}" data-action="toggleTranscription" aria-pressed="${s.transcriptionEnabled}" ${s.recorded?'':'disabled'}>${s.transcriptionEnabled?'已开启':'开启'}</button></div>${s.transcriptionEnabled?`<p class="transcript" aria-live="polite">${esc(sample.speech)}</p>`:''}</div><div class="notice">演示不调用麦克风、不上传录音；开启后显示预置模拟转写。关闭时可手动填写重点。</div>${button('确认录音，填写或确认重点','next','primary',!s.recorded)}`;
}
function points(){
  const examples=s.showSamplePoints?sample.points.map(([kind,text],i)=>`<label class="point"><input type="checkbox" data-point="${i}" ${s.points.includes(i)?'checked':''}><span><b>${kind}：</b>${text}</span></label>`).join(''):button('载入预置示例要点','loadExamplePoints','secondary');
  return `${back()}${stepper()}${heading('KEY POINTS','你真正想说的重点',s.transcriptionEnabled?'请核对示例转写和要点。':'转写已关闭，请手动填写重点。')}<div class="card">${s.transcriptionEnabled?`<p class="quote">${sample.speech}</p>`:''}<h3>本轮信息点</h3>${examples}<div class="field"><label for="extra-point">${s.showSamplePoints?'补充信息点（可选）':'手动填写信息点'}</label><input id="extra-point" class="input" maxlength="80" placeholder="例如：情绪：有点担心外婆" value="${esc(s.extraPoint)}"></div></div>${button('确认重点，请搭档复述','next')}`;
}
function playbackLabel(){return s.playback==='loading'?'正在加载音频…':s.playback==='playing'?'暂停表达者音频':s.playback==='paused'?'继续播放':s.plays?'已听过 · 再听一次':'播放表达者音频';}
function listen(){
  const hint=s.keywords?'第 3 级 · 看了关键词':s.plays>1?'第 2 级 · 已重听':'第 1 级 · 纯听觉';
  const label=s.retold?'复述已完成':s.retelling?'暂停复述':s.retellPaused?'继续复述':'开始模拟复述';
  const time=`${String(Math.floor(s.retellSeconds/60)).padStart(2,'0')}:${String(s.retellSeconds%60).padStart(2,'0')}`;
  const modeNote=s.mode==='async'?`<div class="notice">异步留言 · 第 ${s.asyncVariant+1} 种问法：${asyncQuestions[s.asyncVariant]}。对方稍后才来接棒。</div>`:s.mode==='teen'?`<div class="notice">当前为 ${s.teenRole==='listener'?esc(s.teenName):'监护人'} 的复述者座位。${s.teenRole==='listener'?'孩子只可听、复述与查看本轮提示。':''}</div>`:'';
  return `${back()}${stepper()}${heading('LISTENER · SEAT B','先听，再用自己的话说','先复述，不评价。默认不展示表达者原文。')}${modeNote}<div class="card"><div class="seat"><div><b>表达者的录音</b><br><small>内置中文示例音频</small></div><span class="status">可播放</span></div>${button(playbackLabel(),'play','secondary',s.playback==='loading')}<p class="mini">${s.plays?`已完整听过 ${s.plays} 次。重听会记录到报告。`:'可以边听边开始复述；开始时会先暂停表达者音频。'}</p><p class="mini">提示级别：${hint}</p>${s.assist==='关键词辅助'?button(s.keywords?'关键词：周六 / 外婆 / 午饭':'查看关键词提示','keywords','secondary',!s.plays):''}<div class="divider"></div><h3>你的复述</h3><p class="subtle">演示用计时与预置复述文本代替真实录音。</p><p class="timer retell-time" id="retell-time">${time}</p>${s.retelling||s.retellPaused||s.retold?button('删除当前复述，重新开始','deleteRetell','secondary'):''}${button(label,'retell','primary',s.retold)}${s.retelling||s.retellPaused?button('结束复述','finishRetell','secondary'):''}${s.retold?`<label class="point"><input id="retell-consent" type="checkbox" ${s.retellConsent?'checked':''}> 我同意提交后转写复述，用于本轮逐条对照（演示）。</label>`:''}</div>${button('提交复述，查看差异','next','primary',!s.retold||!s.retellConsent)}`;
}
function compare(){
  const problems=issues(),types=[...new Set(problems.map(row=>row.tag))],questions=problems.filter(row=>row.clarify);
  const tiles=[['完整度',coverage(),'完整保留的要点句数'],['准确度',accuracy(),'意思准确的要点句数'],['偏差类型',`${types.length} 类`,types.join(' / ')||'无'],['可澄清点',`${questions.length} 处`,questions.map(row=>row.clarify).join('；')||'无']];
  return `${back()}${stepper()}${heading('AI COMPARISON','先看差异','模拟 AI 提示：辅助提示，非诊断结论。每个要点分别判断完整与准确。')}<div class="card"><div class="metric-grid">${tiles.map(([title,value,detail])=>`<div class="metric-tile"><span>${title}</span><b>${esc(value)}</b><small>${esc(detail)}</small></div>`).join('')}</div><p class="mini">分母是表达者确认的要点句数；完整与准确分别按句计数。此处为固定示例对照。</p></div><div class="card"><h3>有问题的要点 · 逐条对照</h3>${problems.length?problems.map((row,i)=>`<article class="issue-card"><div class="issue-head"><strong>${i+1}. ${esc(row.title)}</strong><span class="tag">${esc(row.tag)}</span></div><p class="mini">表达者原话</p><p class="quote">${esc(row.original)}</p><p class="mini">复述者原话</p><p class="quote">${esc(row.retell)}</p>${row.clarify?`<p class="subtle">可澄清：${esc(row.clarify)}</p>`:''}</article>`).join(''):'<p class="subtle">所选要点在此示例中没有发现偏差。</p>'}${s.observer&&s.observerNote?`<div class="notice">观察者建议 · ${esc(s.observerTag)}：${esc(s.observerNote)}。不计入双方确认结论。</div>`:''}</div>${button('请表达者逐条标注','next')}`;
}
function labelStep(){
  return `${back()}${stepper()}${heading('SPEAKER LABELS','表达者逐条标注','每一条问题独立选标签；AI 的预分类只作建议。')}<div class="card">${issues().map((issue,i)=>{const r=reviewFor(issue);return `<div class="issue-card"><h3>${i+1}. ${esc(issue.title)}</h3><p class="subtle">AI 建议：${esc(issue.tag)}</p><label for="tag-${issue.id}" class="field-label">表达者标签</label><select id="tag-${issue.id}" data-review-tag="${issue.id}" aria-label="${esc(issue.title)}的标签">${labels.map(tag=>`<option ${r.tag===tag?'selected':''}>${esc(tag)}</option>`).join('')}</select></div>`;}).join('')||'<p class="subtle">没有待标注的问题。</p>'}</div>${button('提交标注，邀请澄清','next')}`;
}
function confirm(){
  const separate=s.mode==='sync'||s.mode==='async';
  const device=separate?`<div class="card"><h3>当前模拟设备</h3><div class="option-grid">${chip('表达者手机','data-confirm-device="speaker"',s.actorRole==='speaker')}${chip('复述者手机','data-confirm-device="listener"',s.actorRole==='listener')}</div><p class="mini">点击切换仅用于演示两台手机的界面。当前页面没有真实账号验证或跨设备同步。</p></div>`:'';
  const seat=(role,r,id)=>{const isSpeaker=role==='speaker',name=isSpeaker?'表达者':'复述者',ok=isSpeaker?r.speakerOK:r.listenerOK,allowed=!separate||s.actorRole===role;return `<div class="seat"><b>${name}</b>${allowed?chip(ok?'已确认':'点击确认',`data-action="${isSpeaker?'speakerConfirm':'listenerConfirm'}" data-issue="${id}"`,ok):`<span class="status ${ok?'':'wait'}">${ok?'已确认 · 另一台手机':'等待另一台手机确认'}</span>`}</div>`;};
  return `${back()}${stepper()}${heading('CONFIRM TOGETHER','把误解逐条聊清楚','复述者可以解释或申诉；每条由双方分别确认。')}${device}<div class="card">${issues().map((issue,i)=>{const r=reviewFor(issue);return `<div class="issue-card"><h3>${i+1}. ${esc(issue.title)}</h3><p class="subtle">表达者标签：${esc(r.tag)}</p><div class="feedback"><strong>复述者澄清</strong><p>${issue.id==='lunch'?'“我听到要吃午饭，但没注意到还要看外婆的身体。”':'“我当时没有把这一点复述出来，可以补充说明。”'}</p></div><div class="field"><label>最终结论${separate?' · 由表达者选择':''}</label><div class="choice-row">${['真误解','表达问题','AI 误判'].map(x=>`<button type="button" class="chip ${r.resolution===x?'active':''}" data-resolution="${x}" data-issue="${issue.id}" aria-pressed="${r.resolution===x}" ${separate&&s.actorRole!=='speaker'?'disabled':''}>${esc(x)}</button>`).join('')}</div></div>${seat('speaker',r,issue.id)}${seat('listener',r,issue.id)}</div>`;}).join('')||'<p class="subtle">没有需要确认的差异。</p>'}</div>${s.observer&&s.observerNote?`<div class="notice">观察者建议：${esc(s.observerNote)}。观察者不能代替双方确认。</div>`:''}<div class="notice">修改标签或结论会清除该条旧确认。只有双方确认的条目进入报告。${separate?'全部确认后由表达者手机提交。':''}</div>${button(separate?'表达者提交，查看改写建议':'查看改写建议','next','primary',!allConfirmed()||(separate&&s.actorRole!=='speaker'))}`;
}
function advice(){return `${back()}${stepper()}${heading('NEXT PRACTICE','收下一条建议','建议可以采纳，也可以直接进入复盘。')}<div class="card"><h3>下一次可以这样确认</h3><p class="quote">“我听到我们周六先去看外婆。午饭要看她身体情况，累了就早点回来，对吗？”</p><p class="subtle">下一轮任务：复述时留意带条件的安排。</p>${button(s.adopted?'已采纳，下轮会提示':'采纳这条建议','adopt','secondary')}</div>${button('归档本轮并查看报告','next')}`;}
function report(){
  const agreed=issues().filter(issue=>{const r=reviewFor(issue);return r.speakerOK&&r.listenerOK;});
  const hint=s.keywords?'看了关键词':s.plays>1?'重听了录音':s.plays===1?'听过一次':'首次未完整听完';
  return `${back()}${stepper()}${heading('ROUND COMPLETE','这一次，听见了什么','报告只收录双方确认的结论，AI 未确认的提示不计入。')}<div class="card"><h3>要点句统计</h3><div class="metric-grid"><div class="metric-tile"><span>复述完整率</span><b>${coverage()}</b><small>完整保留要点句</small></div><div class="metric-tile"><span>复述准确率</span><b>${accuracy()}</b><small>意思准确的要点句</small></div></div><div class="divider"></div><h3>双方逐条确认</h3>${agreed.map(issue=>{const r=reviewFor(issue);return `<p class="subtle"><b>${esc(issue.title)}</b> · ${esc(r.tag)} · ${esc(r.resolution)}</p>`;}).join('')||'<p class="subtle">本轮没有确认的误解条目。</p>'}<div class="divider"></div><p class="mini">表达者原话</p><p class="quote">${sample.speech}</p><p class="mini">复述者原话</p><p class="quote">${esc(retellText())}</p><p class="subtle">${s.adopted?'已采纳改写建议':'未采纳改写建议'} · ${hint} · 完整播放 ${s.plays} 次</p></div>${s.mode==='async'?button('同一留言换问法再练','asyncRetry','secondary'):''}${button('再练一轮（交换角色）','again')}${button('查看复盘记录','history','secondary')}`;
}
function asyncWait(){return `${back()}${heading('ASYNC MESSAGE','留言已准备好','表达者先离开，搭档稍后打开同一条留言。以下均为模拟。')}<div class="card"><div class="seat"><div><b>留言状态</b><br><small>${s.asyncDelivered?'已模拟发送，等待搭档接棒':'仅保存在当前演示页面'}</small></div><span class="status">异步</span></div><p class="subtle">本轮主题：${esc(currentTopic())} · 第 ${s.asyncVariant+1} 种问法：${asyncQuestions[s.asyncVariant]}</p><p class="mini">搭档打开前不显示表达者原文，只能先听音频再复述。</p>${button(s.asyncReminder?'已模拟提醒搭档':'模拟发送空闲提醒','asyncRemind','secondary',s.asyncReminder)}${button('模拟搭档稍后打开留言','asyncOpen')}</div><div class="notice">正式产品需要持久留言、通知渠道、有效期和访问授权；本页不发送消息。</div>`;}
function teenHandoff(){const role=s.teenRole==='speaker'?'表达者':'复述者';return `${back()}${heading('HAND OFF','交棒给孩子',`请先把手机交给孩子，再进入${role}座位。`)}<div class="card"><div class="seat"><div><b>${esc(s.teenName)} · ${role}</b><br><small>${s.teenRole==='speaker'?'只使用本轮表达与重点确认功能':'只使用本轮听取与复述功能'}</small></div><span class="status wait">待交棒</span></div>${button(`确认交棒给 ${esc(s.teenName)}`,'teenEnter')}</div><div class="notice">孩子座位退出演示需监护人退出码。正式产品还需要服务端身份与监护验证。</div>`;}
function teenReturn(){return `${back()}${heading('RETURN PHONE','请把手机交还监护人',s.teenRole==='speaker'?'孩子已完成表达与重点确认；请交给监护人继续复述。':'孩子的复述已经完成；后续差异、标注与双方确认由监护人继续引导。')}<div class="card">${button('监护人已接回手机','teenBack')}</div>`;}
function guardianExit(){return `${heading('GUARDIAN CHECK','需要监护人验证','当前仍在青少年临时座位。退出或切换页面需监护人输入演示退出码。')}<div class="card"><label for="guardian-unlock" class="field-label">监护人退出码</label><input id="guardian-unlock" class="input" type="password" inputmode="numeric" maxlength="4" placeholder="4 位数字">${button('验证并退出孩子座位','unlockGuardian')}${button('返回孩子座位','cancelGuardian','secondary')}</div><div class="notice">该验证码只用于模拟交互，不能用于真实未成年人身份保护。</div>`;}
function observerView(){
  const details=s.stage>=5?`<div class="card"><h3>可旁观的逐条差异</h3>${issues().map(issue=>`<div class="issue-card"><strong>${esc(issue.title)}</strong><p class="mini">表达：${esc(issue.original)}</p><p class="mini">复述：${esc(issue.retell)}</p></div>`).join('')}</div>`:'';
  return `${button('← 返回训练流程','observerBack','back')}${heading('OBSERVER · SEAT C','观察者视角','只观看、写建议标注；不能替表达者或复述者确认。')}<div class="card"><h3>本轮动态</h3><div class="seat"><b>当前进度</b><span class="status">${esc(stepNames[s.stage])}</span></div><div class="seat"><b>表达者</b><span class="status ${s.stage>=3?'':'wait'}">${s.stage>=3?'重点已确认':'表达中'}</span></div><div class="seat"><b>复述者</b><span class="status ${s.retold?'':'wait'}">${s.retold?'复述已提交':'待复述'}</span></div><p class="subtle">主题：${esc(currentTopic())}。旁观内容为本轮模拟状态。</p></div>${details}<div class="card"><h3>建议标注</h3><div class="field"><label for="observer-tag">建议标签</label><select id="observer-tag">${labels.map(tag=>`<option ${s.observerTag===tag?'selected':''}>${esc(tag)}</option>`).join('')}</select></div><div class="field"><label for="observer-note">建议说明</label><textarea id="observer-note" class="input" rows="3" maxlength="180" placeholder="例如：可以问对方是否听到了午饭的条件">${esc(s.observerNote)}</textarea></div>${button('保存建议并返回','saveObserver')}</div><div class="notice">建议会独立显示，不计入复述完整率、误解标签数或双方确认结论。</div>`;
}
function roomOf(h){return h.roomId||`sample-${h.mode}`;}
function participants(h){return s.anonymous?'座位 A · 座位 B':`${h.speakerName||'表达者'} · ${h.listenerName||'复述者'}`;}
function anonymousControl(){return `<div class="seat"><div><b>匿名展示</b><br><small>开启后仅显示座位代号，导出报告也使用座位代号</small></div>${chip(s.anonymous?'已开启':'关闭','data-action="toggleAnonymous"',s.anonymous)}</div>`;}
function exportLink(h){const lines=['回声训练室 轮次报告',`练法：${modes[h.mode][0]}`,`主题：${h.topic}`,`参与者：${participants(h)}`,`复述完整率：${h.complete}/${h.total}（${h.total?Math.round(h.complete/h.total*100):0}%）`,`复述准确率：${h.accurate}/${h.total}`,`双方确认的误解类标签：${h.tags.join('、')||'无'}`,h.sample?'数据说明：预置演示示例':'数据说明：本次页面内演示'];const href=`data:text/plain;charset=utf-8,${encodeURIComponent(lines.join('\n'))}`;return `<a class="secondary download-link" href="${esc(href)}" download="回声训练室-轮次报告.txt">导出报告（TXT）</a>`;}
function deleteConfirm(){const intent=s.deleteIntent;if(!intent)return `${back()}${heading('DELETE','没有待删除的数据')}`;return `${back()}${heading('PRIVACY','确认删除',`范围：${esc(intent.label)} · ${intent.count} 轮记录`)}<div class="card"><h3>删除后不可恢复</h3><p class="subtle">正式产品将删除此范围内的录音、转写、对照和报告。请确认范围无误。</p><p class="mini">当前 Demo 只清除本页面内的模拟记录；刷新页面会恢复预置示例。这不是正式数据删除服务。</p>${button('确认清除本次演示数据','confirmDelete','danger')}${button('取消','cancelDelete','secondary')}</div>`;}
function historyDetail(){
  const h=s.history.find(row=>row.id===s.selectedHistoryId);
  if(!h)return `${button('← 返回复盘','history','back')}${heading('REVIEW','记录已不存在')}`;
  return `${button('← 返回复盘','history','back')}${heading('ROUND REVIEW',`${modes[h.mode][0]} · 轮次详情`,`${esc(h.topic)} · ${h.sample?'预置示例':'本次演示'}`)}<div class="card">${anonymousControl()}<p class="subtle">参与者：${esc(participants(h))}</p><div class="metric-grid"><div class="metric-tile"><span>复述完整率</span><b>${h.complete} / ${h.total}</b></div><div class="metric-tile"><span>复述准确率</span><b>${h.accurate} / ${h.total}</b></div></div><h3>确认的误解类标签</h3>${h.tags.length?h.tags.map(tag=>`<span class="tag">${esc(tag)}</span>`).join(''):'<p class="subtle">无</p>'}<p class="mini">${h.sample?'这是为展示趋势预置的示例数据。':'此记录仅在当前页面会话中存在。'}</p>${exportLink(h)}</div><div class="card"><h3>删除数据</h3><p class="mini">删除前会显示范围和不可恢复提示。</p>${button('删除本轮','requestDeleteRound','secondary')}${button('删除整个训练室','requestDeleteRoom','secondary')}</div>`;
}
function history(){
  const tabs=[['sync','双人同步'],['solo','双座位自练'],['teen','亲子同机'],['async','异步留言']];
  const records=s.history.filter(h=>h.mode===s.reviewTab);
  const timeline=[...records].reverse();
  const counts=timeline.map(h=>h.tags.filter(tag=>misunderstandingLabels.has(tag)).length);
  const maxTags=Math.max(1,...counts);
  const tagTotals=new Map();for(const h of records)for(const tag of h.tags)if(misunderstandingLabels.has(tag))tagTotals.set(tag,(tagTotals.get(tag)||0)+1);
  const mapRows=[...tagTotals].sort((a,b)=>b[1]-a[1]);
  return `${back()}${heading('YOUR JOURNEY','复盘记录','用已确认的轮次看复述完整率和误解类标签如何变化。')}<div class="choice-row review-tabs">${tabs.map(([key,name])=>chip(name,`data-review="${key}"`,s.reviewTab===key)).join('')}</div><div class="card"><h3>变化趋势</h3><div class="chart-legend"><span><i class="legend-complete"></i>复述完整率（%）</span><span><i class="legend-tags"></i>误解类标签（条）</span></div>${timeline.length?`<div class="dual-chart" role="img" aria-label="复述完整率与误解类标签逐轮趋势">${timeline.map((h,i)=>{const pct=h.total?Math.round(h.complete/h.total*100):0;const count=counts[i];return `<div class="chart-group"><div class="chart-bars"><div class="chart-bar complete" style="height:${Math.max(8,pct)}%"><b>${pct}%</b></div><div class="chart-bar mistakes" style="height:${Math.max(8,Math.round(count/maxTags*100))}%"><b>${count}</b></div></div><small>第 ${i+1} 轮</small></div>`;}).join('')}</div><div class="chart-data">${timeline.map((h,i)=>`<p>第 ${i+1} 轮：复述完整率 ${h.complete}/${h.total}（${h.total?Math.round(h.complete/h.total*100):0}%）；误解类标签 ${counts[i]} 条${h.sample?' · 示例':''}</p>`).join('')}</div>`:'<p class="subtle">这个练法还没有记录。完成一轮后会出现趋势。</p>'}<p class="mini">按时间从左到右。示例轮次只用于展示变化；本次新轮次会追加在右侧。</p></div><div class="card"><h3>误解类标签分布</h3>${mapRows.length?mapRows.map(([tag,count])=>`<div class="map-row"><span>${esc(tag)}</span><div class="map-track"><i style="width:${Math.round(count/Math.max(1,mapRows[0][1])*100)}%"></i></div><b>${count}</b></div>`).join(''):'<p class="subtle">暂无双方确认的误解类标签。</p>'}<p class="mini">“我表达不清”“我言不达意”“AI 误判”不计入误解类标签数。</p></div><div class="section-head"><h2>轮次记录</h2><small>${records.length} 轮</small></div>${records.length?records.map((h,i)=>`<button class="mode-card" data-action="viewReport" data-history-id="${h.id}"><span class="icon">${modes[h.mode][1]}</span><span><strong>${modes[h.mode][0]} · 第 ${records.length-i} 轮${h.sample?' · 示例':''}</strong><small>${esc(h.topic)} · 完整 ${h.complete}/${h.total} · 误解标签 ${h.tags.filter(tag=>misunderstandingLabels.has(tag)).length} 条</small></span><span class="arrow">↗</span></button>`).join(''):'<div class="card center"><p class="subtle">还没有记录。完成一轮后会显示在这里。</p></div>'}${button('开始新的训练','home')}`;
}
function profile(){return `${back()}${heading('MY SPACE','我的训练空间','身份与隐私为交互原型。')}<div class="card"><h3>演示身份</h3><input id="nickname" class="input" value="${esc(s.nickname)}" maxlength="12" aria-label="昵称">${button('保存昵称','saveName','secondary')}</div><div class="card"><h3>隐私与数据</h3>${anonymousControl()}<p class="subtle">正式产品需实现成员授权、录音与转写加密。当前页面不保存真实录音。</p><p class="mini">单轮与整个训练室可在轮次详情中删除。以下按钮清除全部演示记录。</p>${button('删除全部数据','requestDeleteAll','secondary')}</div>`;}
const stages=[room,task,record,points,listen,compare,labelStep,confirm,advice,report];
const otherViews={home,setup,history,historyDetail,profile,asyncWait,teenHandoff,teenReturn,guardianExit,observerView,deleteConfirm};
function render(scroll=true){root.innerHTML=s.view==='session'?stages[s.stage]():otherViews[s.view]();document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.action===s.view));if(scroll)window.scrollTo?.(0,0);}
function stopRecording(){if(ticker){clearInterval(ticker);ticker=null;}s.recording=false;}
function tickRecording(){if(ticker)clearInterval(ticker);ticker=setInterval(()=>{if(!s.recording)return;s.seconds++;const time=document.getElementById('record-time');if(time)time.textContent=`${String(Math.floor(s.seconds/60)).padStart(2,'0')}:${String(s.seconds%60).padStart(2,'0')}`;if(s.seconds>=s.duration){stopRecording();s.recorded=true;render(false);toast('已达到本轮时长');}},1000);}
function stopRetellTimer(){if(retellTicker){clearInterval(retellTicker);retellTicker=null;}s.retelling=false;}
function pauseRetell(){if(!s.retelling)return;stopRetellTimer();s.retellPaused=true;}
function startRetell(){
  if(s.playback==='playing'||s.playback==='loading'){playbackAttempt++;sampleAudio?.pause();s.playback='paused';}
  if(retellTicker)clearInterval(retellTicker);
  s.retelling=true;s.retellPaused=false;s.retold=false;s.retellConsent=false;
  retellTicker=setInterval(()=>{s.retellSeconds++;const el=document.getElementById('retell-time');if(el)el.textContent=`${String(Math.floor(s.retellSeconds/60)).padStart(2,'0')}:${String(s.retellSeconds%60).padStart(2,'0')}`;if(s.retellSeconds>=s.duration){finishRetell();render(false);toast('已达到本轮复述时长');}},1000);
}
function finishRetell(){stopRetellTimer();s.retellPaused=false;s.retold=true;}
function deleteRetell(){stopRetellTimer();s.retellPaused=false;s.retold=false;s.retellConsent=false;s.retellSeconds=0;}
function stopPlayback(){
  playbackAttempt++;
  if(sampleAudio){sampleAudio.pause();if(sampleAudio.readyState)sampleAudio.currentTime=0;}
  s.playback='idle';
}
async function playAudio(){
  if(s.retelling)pauseRetell();
  if(!sampleAudio){
    sampleAudio=new Audio('./speaker-sample.mp3');
    sampleAudio.preload='none';
    sampleAudio.onended=()=>{
      if(s.playback!=='playing')return;
      s.playback='idle';
      s.plays++;
      render(false);
    };
  }
  if(s.playback==='playing'){sampleAudio.pause();s.playback='paused';render(false);return;}
  const attempt=++playbackAttempt;
  s.playback='loading';
  render(false);
  try{
    await sampleAudio.play();
    if(attempt!==playbackAttempt)return;
    s.playback='playing';
    render(false);
  }catch{
    if(attempt!==playbackAttempt)return;
    s.playback='idle';
    render(false);
    toast('音频暂时无法播放，请重试。');
  }
}
function resetRound(){stopRecording();stopRetellTimer();stopPlayback();s.recorded=false;s.paused=false;s.seconds=0;s.transcriptionEnabled=false;s.plays=0;s.keywords=false;s.retold=false;s.retellConsent=false;s.retellPaused=false;s.retellSeconds=0;s.showSamplePoints=false;s.points=[];s.extraPoint='';s.focus='';s.review={};s.adopted=false;s.asyncDelivered=false;s.asyncReminder=false;s.asyncVariant=0;s.teenSeat='guardian';s.actorRole='speaker';s.observerNote='';}
function archiveRound(){const m=metrics();s.history.unshift({id:`round-${Date.now()}-${s.history.length}`,roomId:s.roomId||`sample-${s.mode}`,mode:s.mode,topic:currentTopic(),complete:m.complete,total:m.total,accurate:m.accurate,tags:confirmedTags(),speakerName:s.mode==='teen'&&s.teenRole==='speaker'?s.teenName:s.nickname,listenerName:s.mode==='teen'&&s.teenRole==='listener'?s.teenName:s.mode==='solo'?s.nickname:'练习搭档',sample:false});s.history=s.history.slice(0,40);}
function advance(){if(s.stage===4){stopRetellTimer();stopPlayback();}if(s.stage===5&&s.mode==='async')s.actorRole='speaker';if(s.stage===8)archiveRound();s.stage=Math.min(9,s.stage+1);render();}
document.addEventListener('input',e=>{
  const v=e.target.value;
  if(e.target.id==='custom-topic')s.customTopic=v;
  if(e.target.id==='invite-password')s.password=v;
  if(e.target.id==='task-focus')s.focus=v;
  if(e.target.id==='extra-point')s.extraPoint=v;
  if(e.target.id==='teen-name')s.teenName=v;
  if(e.target.id==='guardian-pin')s.guardianPin=v;
  if(e.target.id==='observer-note')s.observerNote=v;
});
document.addEventListener('change',e=>{
  if(e.target.dataset?.point!==undefined){const i=Number(e.target.dataset.point);s.points=e.target.checked?[...new Set([...s.points,i])]:s.points.filter(x=>x!==i);}
  if(e.target.dataset?.reviewTag){const issue=issues().find(row=>row.id===e.target.dataset.reviewTag);if(issue){const r=reviewFor(issue);r.tag=e.target.value;r.speakerOK=false;r.listenerOK=false;}}
  if(e.target.id==='observer-tag')s.observerTag=e.target.value;
  if(e.target.id==='guardian')s.guardian=e.target.checked;
  if(e.target.id==='retell-consent'){s.retellConsent=e.target.checked;render(false);}
});
function guardianGate(action){if(s.mode!=='teen'||s.teenSeat!=='child')return false;pauseRetell();stopPlayback();s.pendingExitAction=action;s.view='guardianExit';render();return true;}
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-action],[data-mode],[data-duration],[data-assist],[data-topic],[data-expiry],[data-resolution],[data-review],[data-teen-role],[data-confirm-device]');
  if(!t||t.disabled)return;
  const d=t.dataset;
  if(d.mode){resetRound();s.mode=d.mode;s.view='setup';render();return;}
  if(d.duration){s.duration=Number(d.duration);render(false);return;}
  if(d.assist){s.assist=d.assist;render(false);return;}
  if(d.topic){s.topic=d.topic;render(false);return;}
  if(d.expiry){s.expiry=d.expiry;render(false);return;}
  if(d.review){s.reviewTab=d.review;render(false);return;}
  if(d.teenRole){s.teenRole=d.teenRole;render(false);return;}
  if(d.confirmDevice){s.actorRole=d.confirmDevice;render(false);return;}
  if(d.resolution&&d.issue){if(['sync','async'].includes(s.mode)&&s.actorRole!=='speaker')return;const issue=issues().find(row=>row.id===d.issue);if(issue){const r=reviewFor(issue);r.resolution=d.resolution;r.speakerOK=false;r.listenerOK=false;render(false);}return;}
  switch(d.action){
    case 'home':case 'history':case 'profile':if(guardianGate(d.action))return;stopRecording();pauseRetell();stopPlayback();s.view=d.action;render();break;
    case 'back':if(guardianGate('back'))return;stopRecording();pauseRetell();stopPlayback();if(s.view==='session'){if(s.stage)s.stage--;else s.view='setup';}else if(s.view==='asyncWait'){s.view='session';s.stage=3;}else if(s.view==='teenHandoff'){s.view='session';s.stage=s.teenRole==='speaker'?1:3;}else if(s.view==='teenReturn'){s.view='session';s.stage=s.teenRole==='speaker'?3:4;}else if(s.view==='historyDetail')s.view='history';else if(s.view==='deleteConfirm')s.view=s.deleteReturnView;else s.view='home';render();break;
    case 'create':{
      if(s.topic==='custom'&&!s.customTopic.trim()){toast('请填写本轮主题');return;}
      if(s.mode==='teen'){
        s.guardian=!!document.getElementById('guardian')?.checked;
        s.teenName=document.getElementById('teen-name')?.value.trim()||s.teenName;
        s.guardianPin=document.getElementById('guardian-pin')?.value||s.guardianPin;
        if(!s.guardian){toast('请先确认监护人须知');return;}
        if(!s.teenName||!/^\d{4}$/.test(s.guardianPin)){toast('请填写孩子昵称和 4 位演示退出码');return;}
      }
      resetRound();s.view='session';s.stage=0;s.roomId=`demo-${++s.roomCounter}`;s.invited=false;s.observer=false;s.linkUsed=false;render();break;
    }
    case 'togglePassword':s.passwordOn=!s.passwordOn;render(false);break;
    case 'toggleOnce':s.once=!s.once;render(false);break;
    case 'invite':if(s.once&&s.linkUsed){toast('一次性演示链接已失效');return;}if(s.passwordOn&&!/^\d{4}$/.test(s.password)){toast('请先设置 4 位数字密码');return;}s.invited=true;s.linkUsed=s.once;render(false);toast('搭档已模拟加入');break;
    case 'observer':s.observer=!s.observer;if(!s.observer)s.observerNote='';render(false);break;
    case 'observerView':if(!s.observer)return;s.view='observerView';render();break;
    case 'observerBack':s.view='session';render();break;
    case 'saveObserver':s.observerNote=document.getElementById('observer-note')?.value.trim()||'';s.observerTag=document.getElementById('observer-tag')?.value||s.observerTag;s.view='session';render();toast('观察者建议已保存，不计入最终确认');break;
    case 'loadExamplePoints':s.showSamplePoints=true;s.points=sample.points.map((_,i)=>i);render(false);break;
    case 'next':
      if(s.stage===0&&!['solo','teen'].includes(s.mode)&&!s.invited){toast('请先模拟搭档加入');return;}
      if(s.stage===2&&!s.recorded){toast('请先完成表达');return;}
      if(s.stage===2){s.showSamplePoints=s.transcriptionEnabled;s.points=s.showSamplePoints?sample.points.map((_,i)=>i):[];}
      if(s.stage===3&&!s.points.length&&!s.extraPoint.trim()){toast('请先填写或选择至少一个信息点');return;}
      if(s.stage===4&&!s.retold){toast('请先结束复述');return;}
      if(s.stage===4&&!s.retellConsent){toast('请先确认复述转写说明');return;}
      if(s.stage===7&&!allConfirmed()){toast('请逐条完成双方确认');return;}
      if(s.stage===7&&['sync','async'].includes(s.mode)&&s.actorRole!=='speaker'){toast('请切换到表达者手机提交');return;}
      if(s.stage===1&&s.mode==='teen'&&s.teenRole==='speaker'){s.handoffTarget=2;s.view='teenHandoff';render();return;}
      if(s.stage===3&&s.mode==='async'){s.asyncDelivered=true;s.view='asyncWait';render();return;}
      if(s.stage===3&&s.mode==='teen'){if(s.teenRole==='speaker'){s.returnTarget=4;s.view='teenReturn';}else{s.handoffTarget=4;s.view='teenHandoff';}render();return;}
      if(s.stage===4&&s.mode==='teen'&&s.teenRole==='listener'){stopRetellTimer();stopPlayback();s.returnTarget=5;s.view='teenReturn';render();return;}
      advance();break;
    case 'asyncRemind':s.asyncReminder=true;render(false);toast('已模拟提醒；没有发送真实消息');break;
    case 'asyncOpen':s.actorRole='listener';s.stage=4;s.view='session';render();break;
    case 'asyncRetry':stopRetellTimer();stopPlayback();s.asyncVariant=(s.asyncVariant+1)%asyncQuestions.length;s.asyncReminder=false;s.plays=0;s.keywords=false;s.retold=false;s.retellConsent=false;s.retellPaused=false;s.retellSeconds=0;s.review={};s.adopted=false;s.stage=4;s.view='asyncWait';render();break;
    case 'teenEnter':s.teenSeat='child';s.stage=s.handoffTarget;s.view='session';render();break;
    case 'teenBack':s.teenSeat='guardian';s.stage=s.returnTarget;s.view='session';render();break;
    case 'unlockGuardian':if(document.getElementById('guardian-unlock')?.value!==s.guardianPin){toast('演示退出码不正确');return;}s.teenSeat='guardian';if(s.pendingExitAction==='back'){s.stage=Math.max(0,s.stage-1);s.view='session';}else s.view=s.pendingExitAction||'home';render();break;
    case 'cancelGuardian':s.view='session';render();break;
    case 'record':if(s.recorded)return;if(s.recording){stopRecording();s.paused=true;}else{s.paused=false;s.recording=true;tickRecording();}render(false);break;
    case 'finishRecord':stopRecording();s.paused=false;s.recorded=true;render(false);break;
    case 'deleteRecord':stopRecording();s.paused=false;s.recorded=false;s.seconds=0;s.transcriptionEnabled=false;render(false);toast('当前录音已删除，可以重新录入');break;
    case 'toggleTranscription':if(!s.recorded)return;s.transcriptionEnabled=!s.transcriptionEnabled;render(false);break;
    case 'play':playAudio();break;
    case 'keywords':s.keywords=true;render(false);break;
    case 'retell':if(s.retelling)pauseRetell();else if(!s.retold)startRetell();render(false);break;
    case 'finishRetell':finishRetell();render(false);break;
    case 'deleteRetell':deleteRetell();render(false);toast('当前复述已删除，可以重新开始');break;
    case 'speakerConfirm':case 'listenerConfirm':{const role=d.action==='speakerConfirm'?'speaker':'listener';if(['sync','async'].includes(s.mode)&&s.actorRole!==role)return;const issue=issues().find(row=>row.id===d.issue);if(!issue)return;const r=reviewFor(issue);if(role==='speaker')r.speakerOK=!r.speakerOK;else r.listenerOK=!r.listenerOK;render(false);break;}
    case 'adopt':s.adopted=!s.adopted;render(false);break;
    case 'again':resetRound();s.stage=0;s.view='session';render();break;
    case 'viewReport':s.selectedHistoryId=d.historyId;s.view='historyDetail';render();break;
    case 'toggleAnonymous':s.anonymous=!s.anonymous;render(false);break;
    case 'requestDeleteRound':case 'requestDeleteRoom':case 'requestDeleteAll':{
      const h=s.history.find(row=>row.id===s.selectedHistoryId);
      const scope=d.action==='requestDeleteRound'?'round':d.action==='requestDeleteRoom'?'room':'all';
      if(scope!=='all'&&!h)return;
      const count=scope==='round'?1:scope==='room'?s.history.filter(row=>roomOf(row)===roomOf(h)).length:s.history.length;
      s.deleteIntent={scope,id:h?.id,roomId:h?roomOf(h):null,count,label:scope==='round'?'单轮':scope==='room'?'整个训练室':'全部数据'};
      s.deleteReturnView=s.view;s.view='deleteConfirm';render();break;
    }
    case 'cancelDelete':s.view=s.deleteReturnView;s.deleteIntent=null;render();break;
    case 'confirmDelete':{
      const intent=s.deleteIntent;if(!intent)return;
      s.history=s.history.filter(row=>intent.scope==='round'?row.id!==intent.id:intent.scope==='room'?roomOf(row)!==intent.roomId:false);
      s.selectedHistoryId=null;s.deleteIntent=null;s.view=intent.scope==='all'?'profile':'history';render();toast('已清除当前页面的模拟记录');break;
    }
    case 'saveName':s.nickname=document.getElementById('nickname').value.trim()||'小回声';render(false);toast('昵称已保存（仅当前演示）');break;
  }
});
render();
