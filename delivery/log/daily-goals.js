// Daily inputs are the source of monetary goals. Stored weekly goals and
// allocation anchors remain in backups, but do not drive this view.
function dailyGoalSource(p,goals,date) {
  const snapshot=p.drafts?.[date]||p.confirmed?.[date];
  if(snapshot)return snapshot;
  const u=dailyCondition(p,date,'u'),d=dailyCondition(p,date,'d');
  const setting=pdaySetting(p,goals,date);
  if(setting.mode==='amt')return {basis:'amount',target:setting.value,u,d};
  if(setting.mode==='cnt')return {basis:'counts',target:0,u:{...u,count:setting.value},d:{...d,count:d.count===''?0:d.count}};
  if(u.count!==''||d.count!=='')return {basis:'counts',target:0,u,d};
  return null;
}
function dailyGoalEntered(p,date,source) {
  if(!source)return false;
  if(source.basis==='counts')return source.u.count!==''||source.d.count!=='';
  // A price-only draft starts at numeric 0. Explicitly typed zero is a plan;
  // blank amounts and legacy deletion placeholders are not allocation days.
  return source.target!==''&&(pn(source.target)>0||typeof source.target==='string'||!!p.confirmed?.[date]);
}
function dailyQuestAllocations(vault,goals,p,today) {
  const days={};
  const quests=pquestMoney(vault,p,today).map(({q,recorded})=>{
    const amount=Math.round(pbudget(q)),claimed=Math.min(amount,Math.round(pn(recorded)));
    const dates=pdays(q.start,q.end).filter(date=>p.days[date]?.mode!=='off'&&dailyGoalEntered(p,date,dailyGoalSource(p,goals,date)));
    const share=(total,i)=>Math.floor(total/dates.length)+(i<total%dates.length?1:0);
    const allocations=dates.map((date,i)=>{
      const value=share(amount,i),recordedShare=share(claimed,i),pending=value-recordedShare;
      const item={id:q.id,date,reward:amount,amount:value,recorded:recordedShare,pending,forecast:q.status==='n',expired:q.status==='n'&&q.end<today};
      const day=days[date]||(days[date]={amount:0,recorded:0,pending:0,forecast:0,items:[]});
      day.amount+=value;day.recorded+=recordedShare;day.pending+=pending;day.forecast+=item.forecast?value:0;day.items.push(item);
      return item;
    });
    return {q,amount,recorded:claimed,pending:amount-claimed,dates,allocations,unallocated:dates.length?0:amount,unallocatedPending:dates.length?0:amount-claimed};
  });
  return {quests,days};
}
function dailyGoalPlan(vault,goals,p,date,today) {
  const [mon,sun]=prange(date,'week'),past=Object.fromEntries(Object.entries(vault).filter(([d])=>d<today));
  const sources={},days={...p.days},daily={...p.daily};
  for(const d of pdays(mon,sun)){
    const s=dailyGoalSource(p,goals,d);sources[d]=s;
    const target=s?(s.basis==='counts'&&s.u.count!==''&&s.d.count!==''?pn(s.u.count)*pn(s.u.price)+pn(s.d.count)*pn(s.d.price):pn(s.target)):0;
    days[d]=p.days[d]?.mode==='off'?p.days[d]:{mode:'amt',value:target};
    if(s)daily[d]={u:{...s.u,count:s.basis==='counts'?s.u.count:''},d:{...s.d,count:s.basis==='counts'?s.d.count:''}};
  }
  const effective={...p,days,daily,confirmed:{},planAnchors:{}};
  const parts=[[mon,pdate(mon,3)],[pdate(mon,4),sun]].map(([start,end])=>{
    const part=dailyPeriod(past,{},effective,date,today,[start,end,0],today);
    part.rows=part.rows.map(base=>{
      const s=sources[base.date],off=base.setting.mode==='off';
      let r=s?dailyDraftRow(base,s):{...base,target:0};
      if(s?.basis==='counts')r.target=r.revenue;
      if(off)r={...r,target:0,u:0,d:0,quest:0,revenue:0,minutes:0};
      r.draft=p.drafts?.[r.date];r.confirmed=p.confirmed?.[r.date]||null;r.hasPlan=dailyGoalEntered(p,r.date,s)&&!off;
      if(!r.hasPlan)r={...r,target:0,u:0,d:0,revenue:0,minutes:0,extraU:0,extraD:0};
      r.fixed=r.hasPlan?r.target:null;
      const a=pday(vault,r.date);r.actual=a.real;r.actualTotal=a.total;r.actualU=a.u.cnt;r.actualD=a.d.cnt;
      r.remaining=Math.max(0,r.target-r.actual);r.over=Math.max(0,r.actual-r.target);
      r.planRemainingU=r.eligible?Math.max(0,r.u-a.u.cnt):0;r.planRemainingD=r.eligible?Math.max(0,r.d-a.d.cnt):0;
      const questActual=part.w.quests.reduce((n,{q})=>n+(r.date>=q.start&&r.date<=q.end?Math.max(0,pprogress(vault,q,r.date)-pprogress(vault,q,pdate(r.date,-1))):0),0);
      r.remainingQuest=r.eligible?Math.max(0,r.quest-questActual):0;
      r.remainingU=r.remainingQuest;r.remainingD=0;
      let uncovered=r.eligible?Math.max(0,r.remaining-r.remainingU*r.conditions.u.price):0;
      for(const key of [r.fill==='u'?'d':'u',r.fill]){
        const price=r.conditions[key].price,field=key==='u'?'remainingU':'remainingD';
        const available=Math.max(0,(key==='u'?r.planRemainingU:r.planRemainingD)-r[field]);
        if(price&&uncovered){const n=Math.min(available,Math.ceil(uncovered/price));r[field]+=n;uncovered=Math.max(0,uncovered-n*price);}
      }
      if(uncovered){const price=r.conditions[r.fill].price;if(price)r[r.fill==='u'?'remainingU':'remainingD']+=Math.ceil(uncovered/price);else r.missingPrice=true;}
      r.missingPrice=!!r.missingPrice||(r.remainingU>0&&!r.conditions.u.price)||(r.remainingD>0&&!r.conditions.d.price);
      r.remainingMinutes=dailyMinutes(r.remainingU,r.remainingD,r.conditions);
      return r;
    });
    const sum=k=>part.rows.reduce((n,r)=>n+r[k],0),goal=sum('target');
    part.w={...part.w,goal};part.configuredGoal=goal;part.carried=0;part.carryOut=0;
    part.actual=pactual(vault,start,end);part.actualDelivery=sum('actual');
    const rewards=pquestMoney(vault,p,today).filter(x=>x.q.end>=start&&x.q.end<=end);
    part.recordedRewards=rewards.reduce((n,x)=>n+x.recorded,0);part.pendingRewards=rewards.reduce((n,x)=>n+x.pending,0);
    part.questRemaining=rewards.reduce((n,{q})=>n+(q.aim==='n'||q.status==='miss'?0:Math.max(0,pn(q.count)+(q.aim==='extra'?10:0)-pprogress(vault,q,today))),0);
    part.nextUnallocatedUber=rewards.reduce((n,{q})=>n+Math.max(0,simulationQuestTarget(q)-pprogress(vault,q,today)-part.rows.filter(r=>r.eligible&&r.date>=q.start&&r.date<=q.end).reduce((m,r)=>m+r.planRemainingU,0)),0);
    part.nextShortfall=part.rows.filter(r=>r.eligible).reduce((n,r)=>n+Math.max(0,r.target-r.revenue),0);
    part.liveShortfall=Math.max(0,goal-part.actualDelivery);part.draftPlanned=sum('revenue');
    return part;
  });
  const allocations=dailyQuestAllocations(vault,goals,p,today);
  for(const part of parts){
    for(const r of part.rows){
      const share=allocations.days[r.date];
      r.questAllocation=share?.amount||0;r.questPendingAllocation=share?.pending||0;r.questRecordedAllocation=share?.recorded||0;r.questForecastAllocation=share?.forecast||0;r.questShares=share?.items||[];
      r.uberDelivery=r.u*r.conditions.u.price;r.demaecanDelivery=r.d*r.conditions.d.price;
      r.salesTarget=r.target+r.questAllocation;
      // The comparison starts with delivery actuals, never actuals including
      // rewards. Full daily shares therefore cannot add a recorded reward twice.
      r.actualAtAchievement=r.actual+r.questAllocation;
    }
    const sum=k=>part.rows.reduce((n,r)=>n+r[k],0);
    part.inputDeliveryGoal=part.w.goal;
    part.deliveryGoal=p.periodTargets?.[part.w.start]??part.inputDeliveryGoal;
    part.goalHeld=p.periodTargets?.[part.w.start]!==undefined;
    part.pastDelivery=part.rows.filter(r=>r.date<today).reduce((n,r)=>n+r.actual,0);
    part.remainingDeliveryBudget=Math.max(0,part.deliveryGoal-part.pastDelivery);
    part.plannedDelivery=part.rows.reduce((n,r)=>n+(r.date<today?r.actual:Math.max(r.actual,r.hasPlan?r.target:0)),0);
    part.planGap=part.deliveryGoal-part.plannedDelivery;
    part.w={...part.w,goal:part.deliveryGoal};
    part.questAllocation=sum('questAllocation');part.questPendingAllocation=sum('questPendingAllocation');part.salesGoal=part.deliveryGoal+part.questAllocation;
  }
  return {parts,rows:parts.flatMap(p=>p.rows),questAllocations:allocations.quests.filter(x=>x.q.start<=sun&&x.q.end>=mon),applied:null};
}
function dailyGoalSummary(vault,goals,p,today) {
  const plan=dailyGoalPlan(vault,goals,p,today,today),r=plan.rows.find(r=>r.date===today);
  return {plan,row:r,target:r.target,salesTarget:r.salesTarget,actual:r.actual,actualAtAchievement:r.actualAtAchievement,remain:r.remaining,over:r.over,hasGoal:r.hasPlan,off:r.setting.mode==='off',need:r.missingPrice?null:r.remainingU+r.remainingD,time:r.missingPrice?'単価未設定':dailyTime(r.remainingMinutes),uberNeed:r.remainingQuest,reason:r.missingPrice?'配達する会社の通常単価を設定してください。':'',quotas:plan.parts.filter(part=>today>=part.w.start&&today<=part.w.end&&part.w.quests.length).map(part=>({id:part.w.start,today:r.remainingQuest,remaining:part.questRemaining,days:part.rows.filter(x=>x.eligible).length,unallocated:part.nextUnallocatedUber}))};
}
function dailyGoalOutlook(vault,goals,p,date,today) {
  const plan=dailyGoalPlan(vault,goals,p,date,today);
  const parts=plan.parts.map(part=>({part,goal:part.salesGoal,deliveryGoal:part.deliveryGoal,questAllocation:part.questAllocation,questPendingAllocation:part.questPendingAllocation,actual:part.actual,actualDelivery:part.actualDelivery,forecastRewards:part.pendingRewards,active:part.rows.filter(r=>r.eligible),allConfirmed:part.rows.some(r=>r.eligible)&&part.rows.filter(r=>r.eligible).every(r=>r.confirmed&&!r.draft),unallocatedUber:part.nextUnallocatedUber,unallocatedDelivery:part.nextShortfall}));
  const sum=k=>parts.reduce((n,p)=>n+p[k],0);
  return {plan,parts,week:{goal:sum('goal'),deliveryGoal:sum('deliveryGoal'),questAllocation:sum('questAllocation'),questPendingAllocation:sum('questPendingAllocation'),actual:sum('actual'),actualDelivery:sum('actualDelivery'),forecastRewards:sum('forecastRewards')},today};
}
function dailyGoalConfirm(vault,goals,p,date,today) {
  const r=dailyGoalPlan(vault,goals,p,date,today).rows.find(r=>r.date===date);
  if(!r||r.setting.mode==='off')throw Error('休みの日は確定できません');
  if(!r.hasPlan)throw Error('計画件数または目標金額を入力してください');
  if(r.u&&!r.conditions.u.price||r.d&&!r.conditions.d.price)throw Error('配達する会社の通常単価を設定してください');
  const drafts={...p.drafts};delete drafts[date];
  return {...p,drafts,confirmed:{...p.confirmed,[date]:{...dailySnapshot(r),basis:dailyGoalSource(p,goals,date)?.basis||'amount',on:today,seen:pday(vault,today).total}}};
}
function dailyGoalDelete(p,date) {
  const next=dailyRelease(p,date),daily={...next.daily};delete daily[date];
  // This empty setting shadows legacy D-date goals without becoming a plan.
  return {...next,daily,days:{...next.days,[date]:{mode:'auto',value:''}}};
}

// Freeze the pre-edit period budget when replanning an already-started period.
// Read-only calculations never migrate or rewrite stored plans or actuals.
function dailyPreservePeriodTargets(vault,goals,before,next,today) {
  const targets={...next.periodTargets};let changed=false;
  const dates=new Set(['days','daily','drafts','confirmed'].flatMap(k=>[...Object.keys(before[k]||{}),...Object.keys(next[k]||{})].filter(d=>JSON.stringify(before[k]?.[d])!==JSON.stringify(next[k]?.[d]))));
  const starts=new Set();
  for(const date of dates){
    const period=dailyGoalPlan(vault,goals,before,date,today).parts.find(x=>date>=x.w.start&&date<=x.w.end);
    if(starts.has(period.w.start))continue;starts.add(period.w.start);
    if(targets[period.w.start]===undefined&&today>period.w.start&&period.rows.some(r=>r.date<today&&r.hasPlan&&(r.confirmed||!r.draft))){
      targets[period.w.start]=period.deliveryGoal;changed=true;
    }
  }
  return changed?{...next,periodTargets:targets}:next;
}
function dailySetPeriodTarget(p,start,value) {
  return {...p,periodTargets:{...p.periodTargets,[start]:Number(value)}};
}
function dailyRebalanceRemaining(vault,goals,p,start,today) {
  const part=dailyGoalPlan(vault,goals,p,start,today).parts.find(x=>x.w.start===start);
  const rows=part.rows.filter(r=>r.eligible&&r.hasPlan);
  if(!rows.length)return p;
  let next=dailySetPeriodTarget(p,start,part.deliveryGoal);
  // Today's entered sales are a floor, not a completed day: only the remainder
  // above that floor is distributed, so live sales are never subtracted twice.
  const floors=rows.map(r=>Math.max(0,Math.ceil(r.actual)));
  const otherActual=part.rows.filter(r=>r.date>=today&&!rows.includes(r)).reduce((n,r)=>n+r.actual,0);
  const spare=Math.max(0,Math.round(part.deliveryGoal-part.pastDelivery-otherActual)-floors.reduce((n,x)=>n+x,0));
  rows.forEach((r,i)=>{next=dailyEdit(next,r,'target',null,String(floors[i]+Math.floor(spare/rows.length)+(i<spare%rows.length?1:0)));});
  return next;
}
