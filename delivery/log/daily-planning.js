// Daily plans use saved past records and explicitly applied current-day snapshots.
// Live current-day records are used only for progress and remaining-work displays.
function dailyCondition(p,date,key) {
  const own=p.daily?.[date]?.[key]||{};
  return {price:own.price===''||own.price===undefined?pn(p.calc[key]):pn(own.price),uph:own.uph===''||own.uph===undefined?pn(p.calc.uph):pn(own.uph),count:own.count??''};
}
function dailyMinutes(u,d,conditions) {
  if(u>0&&!conditions.u.uph||d>0&&!conditions.d.uph)return null;
  return Math.ceil((u/(conditions.u.uph||1)+d/(conditions.d.uph||1))*60);
}
function dailyTime(minutes) {return minutes===null?'UPH未設定':Math.floor(minutes/60)+'時間'+minutes%60+'分';}
function dailyPeriod(vault,goals,p,date,cursor,range) {
  const settings={...p,calc:{...p.calc,strategy:'quest'}};
  const w=pweek(vault,goals,settings,date,cursor,range);
  const fill=p.dailyPeriods?.[range[0]]?.fill||'d';
  const rows=w.rows.map(r=>{
    const conditions={u:dailyCondition(p,r.date,'u'),d:dailyCondition(p,r.date,'d')};
    // Legacy count-fixed days remain readable without overwriting their data.
    if(conditions.u.count===''&&r.setting.mode==='cnt')conditions.u.count=pn(r.setting.value);
    return {...r,conditions,fill,quest:0,u:0,d:0,extraU:0,extraD:0};
  });
  const active=rows.filter(r=>r.eligible);
  let unallocatedUber=0;
  for(const {q} of w.quests){
    if(q.aim==='n'||q.status==='miss')continue;
    let left=Math.max(0,pn(q.count)+(q.aim==='extra'?10:0)-pprogress(vault,q,cursor));
    const eligible=active.filter(r=>r.date>=q.start&&r.date<=q.end);
    const fixed=eligible.filter(r=>r.conditions.u.count!=='');
    for(const r of fixed){const n=Math.min(left,pn(r.conditions.u.count));r.quest+=n;left-=n;}
    const free=eligible.filter(r=>r.conditions.u.count==='');
    const part=free.length?Math.ceil(left/free.length):0;
    for(const r of free){const n=Math.min(left,part);r.quest+=n;left-=n;}
    unallocatedUber+=left;
  }
  for(const r of active){r.u=r.conditions.u.count===''?r.quest:pn(r.conditions.u.count);r.d=pn(r.conditions.d.count);}
  const planned=()=>active.reduce((n,r)=>n+r.u*r.conditions.u.price+r.d*r.conditions.d.price,0);
  const delivery=Math.max(0,w.goal-w.actual-w.forecast);
  let missing=Math.max(0,delivery-planned());
  const free=active.filter(r=>r.conditions[fill].count==='');
  const weights=free.map(r=>Math.max(0,r.target-r.u*r.conditions.u.price-r.d*r.conditions.d.price));
  for(let i=0;i<free.length;i++){
    const r=free[i],price=r.conditions[fill].price;
    if(!price)continue;
    const weightLeft=weights.slice(i).reduce((a,b)=>a+b,0);
    const share=weightLeft>0?weights[i]/weightLeft:1/(free.length-i);
    const count=Math.ceil(missing*share/price);
    r[fill]+=count;
    if(fill==='u')r.extraU+=count;else r.extraD+=count;
    missing=Math.max(0,missing-count*price);
  }
  for(const r of rows){
    r.revenue=r.u*r.conditions.u.price+r.d*r.conditions.d.price;
    r.minutes=dailyMinutes(r.u,r.d,r.conditions);
    r.extraU=r.u-r.quest;r.extraD=r.d;
  }
  return {w,rows,fill,delivery,planned:planned(),shortfall:Math.max(0,delivery-planned()),unallocatedUber};
}
function dailyPlan(vault,goals,p,date,today) {
  const past=Object.fromEntries(Object.entries(vault).filter(([d])=>d<today));
  const ranges=ppartRanges(goals,date);
  // Legacy whole-week goals remain unchanged until the split targets are edited.
  if(!phasSplit(goals,date))ranges.splice(0,2,[...prange(date,'week'),pgoal(goals,date,'week')]);
  const parts=ranges.map(range=>{
    const original=dailyPeriod(past,goals,p,date,today,range);
    const snapshot=p.applied?.[today];
    if(snapshot&&today>=range[0]&&today<=range[1]){
      const reflected=dailyPeriod({...past,[today]:snapshot.record},goals,p,date,pdate(today,1),range);
      original.rows=original.rows.map(r=>r.date>today?reflected.rows.find(x=>x.date===r.date):r);
      original.reflected=reflected;
    }
    const display=original.reflected||original;
    original.nextShortfall=display.shortfall;
    original.nextUnallocatedUber=display.unallocatedUber;
    for(const r of original.rows){
      const actual=pday(vault,r.date);
      r.actual=actual.total;r.actualU=actual.u.cnt;r.actualD=actual.d.cnt;
      r.remaining=Math.max(0,r.target-r.actual);r.over=Math.max(0,r.actual-r.target);
      r.planRemainingU=r.eligible?Math.max(0,r.u-r.actualU):0;
      r.planRemainingD=r.eligible?Math.max(0,r.d-r.actualD):0;
      r.remainingU=r.eligible?Math.max(0,r.quest-r.actualU):0;r.remainingD=0;
      let uncovered=r.eligible?Math.max(0,r.remaining-r.remainingU*r.conditions.u.price):0;
      for(const key of [r.fill==='u'?'d':'u',r.fill]){
        const price=r.conditions[key].price,field=key==='u'?'remainingU':'remainingD';
        const available=Math.max(0,(key==='u'?r.planRemainingU:r.planRemainingD)-r[field]);
        if(price&&uncovered){const n=Math.min(available,Math.ceil(uncovered/price));r[field]+=n;uncovered=Math.max(0,uncovered-n*price);}
      }
      if(r.eligible&&uncovered){const price=r.conditions[r.fill].price;if(price)r[r.fill==='u'?'remainingU':'remainingD']+=Math.ceil(uncovered/price);else r.missingPrice=true;}
      r.remainingMinutes=dailyMinutes(r.remainingU,r.remainingD,r.conditions);
    }
    original.actual=pactual(vault,range[0],range[1]);
    original.questRemaining=original.w.quests.reduce((n,{q})=>n+(q.aim==='n'||q.status==='miss'?0:Math.max(0,pn(q.count)+(q.aim==='extra'?10:0)-pprogress(vault,q,today))),0);
    const liveRewards=pquestMoney(vault,p,today).filter(x=>x.q.end>=range[0]&&x.q.end<=range[1]);
    original.recordedRewards=liveRewards.reduce((n,x)=>n+x.recorded,0);
    original.pendingRewards=liveRewards.reduce((n,x)=>n+x.pending,0);
    original.liveShortfall=Math.max(0,original.w.goal-original.actual-original.pendingRewards);
    return original;
  });
  return {parts,rows:parts.flatMap(x=>x.rows),applied:p.applied?.[today]||null};
}
function dailySummary(vault,goals,p,today) {
  const plan=dailyPlan(vault,goals,p,today,today),r=plan.rows.find(x=>x.date===today);
  return {plan,row:r,target:r.target,actual:r.actual,remain:r.remaining,over:r.over,hasGoal:pgoal(goals,today,'week')>0||r.fixed!==null,off:r.setting.mode==='off',manual:r.fixed!==null,need:r.missingPrice?null:r.remainingU+r.remainingD,time:r.missingPrice?'単価未設定':dailyTime(r.remainingMinutes),uberNeed:r.remainingU,reason:r.missingPrice?'不足売上を補う会社の通常単価を設定してください。':'',quotas:plan.parts.filter(part=>today>=part.w.start&&today<=part.w.end&&part.w.quests.length).map(part=>({id:part.w.start,today:r.remainingU,remaining:part.questRemaining,days:part.rows.filter(x=>x.eligible).length,unallocated:part.nextUnallocatedUber}))};
}
function dailyApply(vault,p,today) {
  const record=JSON.parse(JSON.stringify(vault[today]||{sets:[]}));
  return {...p,applied:{...p.applied,[today]:{record}}};
}
function dailyValidate(p) {
  const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const date=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&pdate(d)===d;
  for(const name of ['daily','dailyPeriods','applied'])if(p[name]!==undefined&&!obj(p[name]))throw Error('日別計画の形式が不正です');
  for(const [d,settings] of Object.entries(p.daily||{})){
    if(!date(d)||!obj(settings))throw Error('日別計画の日付が不正です');
    for(const key of ['u','d'])if(settings[key]!==undefined){
      const c=settings[key];if(!obj(c))throw Error('会社別条件が不正です');
      for(const field of ['count','price','uph'])if(c[field]!==undefined){const v=c[field];if(!['string','number'].includes(typeof v)||!Number.isFinite(Number(v))||Number(v)<0||(field==='count'&&!Number.isSafeInteger(Number(v)))||(field==='uph'&&Math.abs(Number(v)*10-Math.round(Number(v)*10))>1e-7))throw Error('日別の件数・単価・UPHが不正です');}
    }
  }
  for(const [d,s] of Object.entries(p.dailyPeriods||{}))if(!date(d)||!obj(s)||!['u','d'].includes(s.fill))throw Error('不足を補う会社が不正です');
  for(const [d,s] of Object.entries(p.applied||{}))if(!date(d)||!obj(s)||!obj(s.record)||!Array.isArray(s.record.sets)||!s.record.sets.every(obj))throw Error('反映済み実績の形式が不正です');
  return p;
}
