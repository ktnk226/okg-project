// Simulation settings share recorded sales, but never mutate accounting records.
const PLAN_KEY = 'delivery_log_planning_v15';
const pn = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
function pdate(s, offset=0) {
  const d = new Date(s+'T12:00:00'); d.setDate(d.getDate()+offset);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function pdays(a,b) { const out=[]; for(let d=a;d<=b;d=pdate(d,1)) {out.push(d);if(out.length>370)throw Error('期間が長すぎます');} return out; }
function prange(date,kind) {
  if(kind==='year')return [date.slice(0,4)+'-01-01',date.slice(0,4)+'-12-31'];
  if(kind==='month') {const [y,m]=date.split('-').map(Number);return [date.slice(0,7)+'-01',pdate([y,String(m).padStart(2,'0'),'01'].join('-'),new Date(y,m,0).getDate()-1)];}
  const mon=pdate(date,-((new Date(date+'T12:00:00').getDay()+6)%7));return [mon,pdate(mon,6)];
}
function pgoalKey(date,kind) {
  if(kind==='year')return 'Y-'+date.slice(0,4);
  if(kind==='month')return 'M-'+date.slice(0,7);
  // Keep the existing week key, including weeks crossing a year boundary.
  const mon=new Date(prange(date,'week')[0]+'T12:00:00'),y=mon.getFullYear(),jan=new Date(y,0,1,12);
  const week=Math.ceil(((Math.round((mon-jan)/86400000))+jan.getDay()+1)/7);
  return 'W-'+y+'-W'+String(week).padStart(2,'0');
}
function pgoal(goals,date,kind) {const v=goals[pgoalKey(date,kind)];return pn(typeof v==='object'?v?.amt:v);}
function psetGoal(goals,date,kind,amount) {
  const key=pgoalKey(date,kind),old=goals[key];
  return {...goals,[key]:{...(old&&typeof old==='object'?old:{cnt:0}),amt:pn(amount)}};
}
function pdefault() {return {quests:[],days:{},models:['閑散期','通常期','繁忙期'].map(name=>({name,u:'',d:'',uph:''})),model:1,calc:{u:'',d:'',uph:'',company:'u',share:100},scenarios:[0,5,10],weekly:{},horizons:{}};}
function pvalidate(p) {
  const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const number=v=>(typeof v==='string'||typeof v==='number')&&Number.isFinite(Number(v))&&Number(v)>=0;
  const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&pdate(v)===v;
  if(!obj(p)||!Array.isArray(p.quests)||!obj(p.days)||!Array.isArray(p.models)||p.models.length!==3||!obj(p.calc)||!Array.isArray(p.scenarios)||p.scenarios.length!==3)throw Error('計画データの形式が違います');
  if(!['u','d','both'].includes(p.calc.company)||!['u','d','uph','share'].every(k=>number(p.calc[k]))||pn(p.calc.share)>100||!Number.isInteger(p.model)||p.model<0||p.model>2||!p.scenarios.every(v=>number(v)&&Number.isInteger(Number(v)))||Number(p.scenarios[0])!==0)throw Error('計算条件が不正です');
  if(!p.models.every(m=>obj(m)&&typeof m.name==='string'&&['u','d','uph'].every(k=>number(m[k]))))throw Error('モデルが不正です');
  if(p.calc.strategy!==undefined&&!['ratio','quest'].includes(p.calc.strategy))throw Error('計画方式が不正です');
  const ids=new Set();
  for(const q of p.quests) {
    if(!obj(q)||typeof q.id!=='string'||ids.has(q.id)||!day(q.start)||!day(q.end)||q.end<q.start||pdays(q.start,q.end).length>4||!['n','base','extra'].includes(q.aim)||!['n','base','extra'].includes(q.finish)||!['n','base','extra','miss'].includes(q.status)||!['count','base','extra','adjust'].every(k=>number(q[k]))||pn(q.count)<10||pn(q.count)>120||pn(q.count)%10||!Array.isArray(q.links))throw Error('クエスト条件が不正です');
    ids.add(q.id);
    for(const l of q.links)if(!obj(l)||!day(l.date)||!number(l.amount))throw Error('報酬紐付けが不正です');
  }
  for(const [d,v] of Object.entries(p.days))if(!day(d)||!obj(v)||!['auto','off','amt','cnt'].includes(v.mode)||!number(v.value))throw Error('日別計画が不正です');
  const ordered=[...p.quests].sort((a,b)=>a.start.localeCompare(b.start));
  for(let i=1;i<ordered.length;i++)if(ordered[i].start<=ordered[i-1].end)throw Error('日跨ぎクエストの期間が重複しています');
  if(p.weekly!==undefined&&(!obj(p.weekly)||Object.values(p.weekly).some(v=>!obj(v)||typeof v.includeQuest!=='boolean')))throw Error('週の設定が不正です');
  if(p.horizons!==undefined&&(!obj(p.horizons)||Object.entries(p.horizons).some(([k,v])=>!/^([MY])-\d{4}(-\d{2})?$/.test(k)||!obj(v)||!number(v.daily)||!number(v.workDays)||!Number.isInteger(Number(v.workDays)))))throw Error('月・年の想定が不正です');
  return p;
}
function pload() {try {const raw=localStorage.getItem(PLAN_KEY);return {data:raw?pvalidate(JSON.parse(raw)):pdefault(),error:''};}catch{return {data:pdefault(),error:'計画データを読み込めません。既存データを保護して保存を停止しています。バックアップから復元してください。'};}}
function pday(vault,date) {
  const day=vault[date]||{},s=(day.sets||[]).slice(-1)[0]||{};
  // Accounting totals retain signed corrections, just like Home's aggregation.
  const recorded=v=>Number.isFinite(Number(v))?Number(v):0;
  const pf=k=>({amt:recorded(s[k+'_cum']),cnt:recorded(s[k+'_cnt_cum']),que:recorded(s[k+'_que_cum'])});
  const u=pf('u'),d=pf('d'),all=['u','d','r','m'].map(pf),real=all.reduce((a,x)=>a+x.amt,0),que=all.reduce((a,x)=>a+x.que,0);
  return {u,d,real,que,total:real+que,cnt:all.reduce((a,x)=>a+x.cnt,0)};
}
function pactual(vault,start,end) {return Object.keys(vault).filter(d=>d>=start&&d<=end).reduce((a,d)=>a+pday(vault,d).total,0);}
function preward(q,c) {return c<pn(q.count)?0:pn(q.base)+(c>=pn(q.count)+10?pn(q.extra):0);}
function pprogress(vault,q,date,extraU=0) {return Math.max(0,pdays(q.start,q.end).filter(d=>d<=date).reduce((a,d)=>a+pday(vault,d).u.cnt,0)-pn(q.adjust)+(date>=q.start&&date<=q.end?extraU:0));}
function pbudget(q) {if(q.status==='miss'||(q.status==='n'&&q.aim==='n'))return 0;const stage=q.status==='n'?q.aim:q.status;return pn(q.base)+(stage==='extra'?pn(q.extra):0);}
function plinkCheck(p,vault) {
  const sums={};for(const q of p.quests)for(const l of q.links)sums[l.date]=(sums[l.date]||0)+pn(l.amount);
  for(const [d,n] of Object.entries(sums))if(n>pday(vault,d).u.que)return d+'：紐付け額がUberの記録済みクエスト報酬を超えています';return '';
}
function pquestMoney(vault,p,asOf) {
  // Claim each recorded yen once. Explicit links take priority; the remaining
  // Uber rewards recorded in a quest's own period reduce its forecast automatically.
  const available=Object.fromEntries(Object.keys(vault).map(d=>[d,pn(pday(vault,d).u.que)]));
  const recorded=Object.fromEntries(p.quests.map(q=>[q.id,0]));
  for(const q of p.quests)for(const l of q.links){const n=Math.min(available[l.date]||0,pn(l.amount));available[l.date]=(available[l.date]||0)-n;recorded[q.id]+=n;}
  return [...p.quests].sort((a,b)=>a.start.localeCompare(b.start)).map(q=>{
    for(const d of pdays(q.start,q.end)){const n=available[d]||0;recorded[q.id]+=n;available[d]=0;}
    const expected=q.status==='n'&&q.end<asOf?0:pbudget(q);
    return {q,recorded:recorded[q.id],expected,pending:Math.max(0,expected-recorded[q.id])};
  });
}
function pmix(c,n) {const u=c.company==='u'?n:c.company==='d'?0:Math.round(n*pn(c.share)/100);return {u,d:n-u,amt:u*pn(c.u)+(n-u)*pn(c.d)};}
function pready(c) {return c.company==='u'?pn(c.u)>0:c.company==='d'?pn(c.d)>0:(pn(c.share)===0||pn(c.u)>0)&&(pn(c.share)===100||pn(c.d)>0);}
function pneed(c,amt) {
  if(amt<=0)return 0;if(!pready(c))return null;
  const fares=[c.company!=='d'&&pn(c.u),c.company!=='u'&&pn(c.d)].filter(n=>n>0);
  let lo=0,hi=Math.ceil(amt/Math.min(...fares))+2;
  if(!Number.isSafeInteger(hi))return null;
  while(lo<hi){const m=Math.floor((lo+hi)/2);if(pmix(c,m).amt>=amt)hi=m;else lo=m+1;}return lo;
}
function ptime(cnt,uph) {if(cnt===0)return '0分';if(cnt===null||pn(uph)<=0)return '未設定';const min=Math.ceil(cnt/pn(uph)*60);return Math.floor(min/60)+'時間'+min%60+'分';}
function pdaySetting(p,goals,date) {
  if(p.days[date])return p.days[date];
  const old=goals['D-'+date],amt=pn(typeof old==='object'?old?.amt:old),cnt=pn(old?.cnt);
  return amt>0?{mode:'amt',value:amt,legacy:true}:cnt>0?{mode:'cnt',value:cnt,legacy:true}:{mode:'auto',value:''};
}
function pweek(vault,goals,p,date,asOf) {
  const [start,end]=prange(date,'week'),dates=pdays(start,end),goal=pgoal(goals,date,'week');
  const actual=pactual(vault,start,end),quests=pquestMoney(vault,p,asOf).filter(x=>x.q.start<=end&&x.q.end>=start);
  const forecast=quests.reduce((a,x)=>a+x.pending,0),includeQuest=p.weekly?.[pgoalKey(date,'week')]?.includeQuest===true;
  const credit=includeQuest||p.calc.strategy==='quest'?forecast:0,remain=Math.max(0,goal-actual),deliveryRemain=Math.max(0,remain-credit);
  const rows=dates.map(d=>{
    const setting=pdaySetting(p,goals,d),actual=pday(vault,d).total,eligible=d>=asOf&&setting.mode!=='off';
    const fixed=setting.mode==='amt'?pn(setting.value):setting.mode==='cnt'?pmix(p.calc,Math.ceil(pn(setting.value))).amt:null;
    return {date:d,setting,actual,eligible,fixed,target:eligible&&fixed!==null?fixed:0};
  });
  const free=rows.filter(r=>r.eligible&&r.fixed===null),fixed=rows.filter(r=>r.eligible&&r.fixed!==null);
  const used=rows.filter(r=>!free.includes(r)).reduce((a,r)=>a+(r.eligible?Math.max(r.actual,r.target):r.actual),0);
  let pool=Math.max(0,goal-credit-used),open=[...free];
  // Equal total daily targets with actual sales as lower bounds. Today's target
  // stays stable until actual sales exceed it, then excess reduces other days.
  while(open.length){
    const high=open.filter(r=>r.actual>pool/open.length);
    if(!high.length){const part=Math.floor(pool/open.length),extra=Math.round(pool-part*open.length);open.forEach((r,i)=>r.target=part+(i<extra?1:0));break;}
    for(const r of high){r.target=r.actual;pool=Math.max(0,pool-r.actual);}open=open.filter(r=>!high.includes(r));
  }
  rows.forEach(r=>r.remaining=r.eligible?Math.max(0,r.target-r.actual):0);
  const allocated=rows.reduce((a,r)=>a+r.remaining,0);
  return {start,end,goal,actual,remain,deliveryRemain,forecast,credit,includeQuest,quests,rows,free,fixed,allocated,unallocated:Math.max(0,deliveryRemain-allocated),excess:Math.max(0,allocated-deliveryRemain)};
}
function pquota(vault,p,date) {
  return p.quests.filter(q=>q.aim!=='n'&&q.status==='n'&&date>=q.start&&date<=q.end).map(q=>{
    const remaining=Math.max(0,pn(q.count)+(q.aim==='extra'?10:0)-pprogress(vault,q,date));
    const days=pdays(date,q.end).filter(d=>p.days[d]?.mode!=='off');
    return {id:q.id,remaining,today:p.days[date]?.mode==='off'?0:days.length?Math.ceil(remaining/days.length):0,days:days.length,unallocated:days.length===0?remaining:0};
  });
}
function prequirements(vault,p,date,target,setting={mode:'auto'}) {
  const day=pday(vault,date),off=setting.mode==='off',amountNeed=off?0:pneed(p.calc,Math.max(0,target-day.total));
  const countNeed=off?0:Math.max(0,(setting.mode==='cnt'?Math.ceil(pn(setting.value)):0)-day.cnt),quotas=pquota(vault,p,date),uberNeed=Math.max(0,...quotas.map(q=>q.today));
  let questNeed=0,reason='';
  if(uberNeed>0){
    if(p.calc.company==='d'||(p.calc.company==='both'&&pn(p.calc.share)===0)){questNeed=null;reason='クエストにはUber Eatsの配達が必要です。会社・Uber比率を変更してください。';}
    else {let lo=0,hi=p.calc.company==='u'?uberNeed:Math.ceil((uberNeed+1)*100/pn(p.calc.share));if(!Number.isSafeInteger(hi)){questNeed=null;reason='Uber比率を確認してください。';}else{while(lo<hi){const n=Math.floor((lo+hi)/2);if(pmix(p.calc,n).u>=uberNeed)hi=n;else lo=n+1;}questNeed=lo;}}
  }
  if(amountNeed===null&&!reason)reason='必要件数を計算するには通常単価を設定してください。';
  return {amountNeed,countNeed,quotas,uberNeed,questNeed,need:amountNeed===null||questNeed===null?null:Math.max(amountNeed,countNeed,questNeed),reason};
}
function psummary(vault,goals,p,date) {
  const w=pweek(vault,goals,p,date,date),row=w.rows.find(r=>r.date===date),target=row.target,actual=row.actual;
  const company=p.calc.strategy==='quest'?pcompanyPlan(vault,goals,p,date,date):null,planned=company?.rows.find(r=>r.date===date);
  return {...prequirements(vault,p,date,target,row.setting),...(company?{need:planned.need,reason:company.reason,uberNeed:planned.u}:{}),w,target,actual,remain:row.remaining,hasGoal:w.goal>0||row.fixed!==null,off:row.setting.mode==='off',manual:row.fixed!==null};
}
function phorizon(vault,goals,p,date,kind,asOf) {
  const [start,end]=prange(date,kind),key=pgoalKey(date,kind),goal=pgoal(goals,date,kind),actual=pactual(vault,start,end),setting=p.horizons?.[key]||{daily:'',workDays:''};
  const remainingDays=pdays(start>asOf?start:asOf,end).length;
  const workDays=setting.workDays===''?remainingDays:Math.min(remainingDays,Math.floor(pn(setting.workDays)));
  const recorded=Object.keys(vault).filter(d=>d>=start&&d<=end&&d<=asOf&&pday(vault,d).total>0);
  const daily=setting.daily===''?(recorded.length?Math.round(recorded.reduce((a,d)=>a+pday(vault,d).total,0)/recorded.length):0):pn(setting.daily);
  const remain=Math.max(0,goal-actual),projection=actual+daily*workDays;
  return {start,end,key,goal,actual,remain,remainingDays,workDays,daily,projection,gap:Math.max(0,goal-projection),required:workDays?Math.ceil(remain/workDays):null,setting};
}

// Quest quotas are allocated within their own deadlines. Revenue is shared by
// the selected week; only unrecorded rewards reduce the remaining delivery need.
function pcompanyPlan(vault,goals,p,date,asOf,baseline=true) {
  const w=pweek(vault,goals,p,date,asOf),rows=w.rows.map(r=>({...r,u:0,d:0}));
  const spread=(n,eligible,key)=>{if(!eligible.length)return n;const part=Math.ceil(n/eligible.length);for(const r of eligible){const take=Math.min(n,part);r[key]+=take;n-=take;}return n;};
  let unallocatedUber=0;
  for(const {q} of w.quests){
    if(q.aim==='n'||q.status==='miss')continue;
    const target=pn(q.count)+((q.status==='extra'||q.status==='n'&&q.aim==='extra')?10:0);
    const remaining=Math.max(0,target-pprogress(vault,q,asOf));
    unallocatedUber+=spread(remaining,rows.filter(r=>r.eligible&&r.date>=q.start&&r.date<=q.end),'u');
  }
  const u=rows.reduce((n,r)=>n+r.u,0)+unallocatedUber;
  const delivery=Math.max(0,w.goal-w.actual-w.forecast),shortfall=Math.max(0,delivery-u*pn(p.calc.u));
  const d=shortfall===0?0:pn(p.calc.d)>0?Math.ceil(shortfall/pn(p.calc.d)):null;
  const unallocatedD=d===null?0:spread(d,rows.filter(r=>r.eligible),'d');
  rows.forEach(r=>{r.need=d===null||r.u>0&&pn(p.calc.u)<=0?null:r.u+r.d;r.hours=ptime(r.need,p.calc.uph);});
  let capacity=0;
  if(baseline){
    const original=pcompanyPlan({},goals,p,date,w.start,false);
    capacity=original.rows.filter(r=>r.eligible&&r.date>=asOf).reduce((n,r)=>n+Math.max(0,r.u-pday(vault,r.date).u.cnt)+Math.max(0,r.d-pday(vault,r.date).d.cnt),0);
  }
  return {w,rows,u,d,delivery,shortfall,unallocatedUber,unallocatedD,need:d===null?null:u+d,capacity,requiredAverage:capacity>0?delivery/capacity:null,reason:u>0&&pn(p.calc.u)<=0?'Uber通常単価を設定してください。':d===null?'出前館通常単価を設定してください。':''};
}
