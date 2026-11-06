// Daily plans use saved past records and explicitly applied current-day snapshots.
// Live current-day records are used only for progress and remaining-work displays.
function dailyCondition(p,date,key) {
  const own=p.daily?.[date]?.[key]||{};
  return {price:own.price===''||own.price===undefined?pn(p.calc[key]):pn(own.price),uph:own.uph===''||own.uph===undefined?pn(p.calc.uph):pn(own.uph),count:own.count??''};
}
function dailyMinutes(u,d,conditions) {
  const uphU=pn(conditions.u.uph),uphD=pn(conditions.d.uph);
  if(u>0&&!uphU||d>0&&!uphD)return null;
  return Math.ceil((u/(uphU||1)+d/(uphD||1))*60);
}
function dailyTime(minutes) {return minutes===null?'UPH未設定':Math.floor(minutes/60)+'時間'+minutes%60+'分';}
function dailyPeriod(vault,goals,p,date,cursor,range,rewardDate=cursor,afterActual=false) {
  const saved=Object.keys(p.confirmed||{}).filter(d=>d>=cursor&&d>=range[0]&&d<=range[1]&&pdaySetting(p,goals,d).mode!=='off').sort();
  const anchor=p.planAnchors?.[range[0]];
  const held=anchor?.asOf===rewardDate&&(!afterActual||anchor.afterApply===true)?Object.fromEntries(Object.entries(anchor.held).filter(([d])=>d>=cursor&&pdaySetting(p,goals,d).mode!=='off')):{};
  let effective=p;
  if(saved.length||Object.keys(held).length){
    // A confirmation affects that day and later days only. Earlier automatic
    // days retain their baseline; all other confirmations reserve their values.
    const days={...p.days},daily={...p.daily};
    for(const [d,s] of Object.entries({...held,...Object.fromEntries(saved.map(d=>[d,p.confirmed[d]]))})){
      days[d]={mode:'amt',value:s.target};daily[d]={u:s.u,d:s.d};
    }
    effective={...p,days,daily};
  }
  const settings={...effective,calc:{...p.calc,strategy:'quest'}};
  const w=pweek(vault,goals,settings,date,cursor,range,rewardDate);
  const fill=p.dailyPeriods?.[range[0]]?.fill||'d';
  const rows=w.rows.map(r=>{
    const conditions={u:dailyCondition(effective,r.date,'u'),d:dailyCondition(effective,r.date,'d')};
    // Legacy count-fixed days remain readable without overwriting their data.
    if(conditions.u.count===''&&r.setting.mode==='cnt')conditions.u.count=pn(r.setting.value);
    return {...r,conditions,fill,confirmed:p.confirmed?.[r.date]||null,locked:!!(held[r.date]||saved.includes(r.date)),quest:0,u:0,d:0,extraU:0,extraD:0};
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
    // Manual counts are retained. They cannot cap the mandatory quest quota:
    // if every working day is specified, spread the remaining obligation too.
    const receivers=free.length?free:eligible.filter(r=>!r.locked);
    const part=receivers.length?Math.ceil(left/receivers.length):0;
    for(const r of receivers){const n=Math.min(left,part);r.quest+=n;left-=n;}
    unallocatedUber+=left;
  }
  for(const r of active){r.u=Math.max(r.quest,pn(r.conditions.u.count));r.d=pn(r.conditions.d.count);}
  const planned=()=>active.reduce((n,r)=>n+r.u*r.conditions.u.price+r.d*r.conditions.d.price,0);
  const delivery=Math.max(0,w.goal-w.actual-w.forecast);
  for(const r of active){
    // Each daily delivery target is independent of quest rewards and other
    // days' rounding/overages. Never shrink a manually specified money target.
    r.deliveryGap=Math.max(0,r.target-r.u*r.conditions.u.price-r.d*r.conditions.d.price);
    const price=r.conditions[fill].price;
    r.salesAdded=!r.locked&&price?Math.ceil(r.deliveryGap/price):0;
    r[fill]+=r.salesAdded;
  }
  for(const r of rows){
    r.revenue=r.u*r.conditions.u.price+r.d*r.conditions.d.price;
    r.minutes=dailyMinutes(r.u,r.d,r.conditions);
    r.extraU=r.u-r.quest;r.extraD=r.d;
    r.dayShortfall=r.eligible?Math.max(0,r.target-r.revenue):0;
  }
  return {w,rows,fill,delivery,planned:planned(),shortfall:w.unallocated+active.reduce((n,r)=>n+r.dayShortfall,0),targetExcess:w.excess,projectionExcess:Math.max(0,planned()-delivery),unallocatedUber};
}
function dailyPlan(vault,goals,p,date,today,includeDrafts=true) {
  const past=Object.fromEntries(Object.entries(vault).filter(([d])=>d<today));
  const ranges=ppartRanges(goals,date);
  // Legacy whole-week goals remain unchanged until the split targets are edited.
  const split=phasSplit(goals,date);
  if(!split)ranges.splice(0,2,[...prange(date,'week'),pgoal(goals,date,'week')]);
  // Derive the carry from saved actuals only after Mon–Thu has ended. Do not
  // persist it into the configured goal, snapshots, or the next week's quest.
  const carry=split&&today>ranges[0][1]?Math.max(0,ranges[0][2]-pactual(past,ranges[0][0],ranges[0][1])):0;
  const parts=ranges.map((configured,index)=>{
    const carried=index===1?carry:0,range=[configured[0],configured[1],configured[2]+carried];
    const original=dailyPeriod(past,goals,p,date,today,range);
    original.configuredGoal=configured[2];original.carried=carried;original.carryOut=index===0?carry:0;
    const snapshot=p.applied?.[today];
    if(snapshot&&today>=range[0]&&today<=range[1]){
      const reflected=dailyPeriod({...past,[today]:snapshot.record},goals,p,date,pdate(today,1),range,today,true);
      original.rows=original.rows.map(r=>r.date>today?reflected.rows.find(x=>x.date===r.date):r);
      original.reflected=reflected;
    }
    const display=original.reflected||original;
    original.nextShortfall=display.shortfall;
    original.nextUnallocatedUber=display.unallocatedUber;
    original.draftPlanned=display.planned;
    if(includeDrafts)original.rows=original.rows.map(r=>{
      const draft=p.drafts?.[r.date];if(!draft||!r.eligible)return r;
      const next=dailyDraftRow(r,draft);
      if(!original.reflected||r.date>today)original.draftPlanned+=next.revenue-r.revenue;
      return next;
    });
    for(const r of original.rows){
      const actual=pday(vault,r.date);
      // Targets are delivery-only. Recorded quest rewards are already credited
      // at period level and must not reduce today's delivery remainder again.
      r.actual=actual.real;r.actualTotal=actual.total;r.actualU=actual.u.cnt;r.actualD=actual.d.cnt;
      r.remaining=Math.max(0,r.target-r.actual);r.over=Math.max(0,r.actual-r.target);
      r.planRemainingU=r.eligible?Math.max(0,r.u-r.actualU):0;
      r.planRemainingD=r.eligible?Math.max(0,r.d-r.actualD):0;
      const questActual=original.w.quests.reduce((n,{q})=>n+(r.date>=q.start&&r.date<=q.end?Math.max(0,pprogress(vault,q,r.date)-pprogress(vault,q,pdate(r.date,-1))):0),0);
      r.remainingQuest=r.eligible?Math.max(0,r.quest-questActual):0;
      r.remainingU=r.remainingQuest;r.remainingD=0;
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
  const plan=dailyPlan(vault,goals,p,today,today,false),r=plan.rows.find(x=>x.date===today);
  return {plan,row:r,target:r.target,actual:r.actual,remain:r.remaining,over:r.over,hasGoal:pgoal(goals,today,'week')>0||r.fixed!==null,off:r.setting.mode==='off',manual:r.fixed!==null,need:r.missingPrice?null:r.remainingU+r.remainingD,time:r.missingPrice?'単価未設定':dailyTime(r.remainingMinutes),uberNeed:r.remainingQuest,reason:r.missingPrice?'不足売上を補う会社の通常単価を設定してください。':'',quotas:plan.parts.filter(part=>today>=part.w.start&&today<=part.w.end&&part.w.quests.length).map(part=>({id:part.w.start,today:r.remainingQuest,remaining:part.questRemaining,days:part.rows.filter(x=>x.eligible).length,unallocated:part.nextUnallocatedUber}))};
}
function dailyApply(vault,p,today,goals=null) {
  const record=JSON.parse(JSON.stringify(vault[today]||{sets:[]}));
  // Keep the earlier-day baseline for today's goal, while releasing future
  // automatic days to the actual-based reallocation. A later plan confirmation
  // may establish a new baseline for its preceding, still-open days.
  const planAnchors=Object.fromEntries(Object.entries(p.planAnchors||{}).map(([start,a])=>[start,start<=today&&a.end>=today&&a.asOf===today?{...a,afterApply:false}:a]));
  const end=pdate(prange(today,'week')[0],goals&&!phasSplit(goals,today)?6:new Date(today+'T12:00:00').getDay()>=1&&new Date(today+'T12:00:00').getDay()<=4?3:6);
  const confirmed={...p.confirmed},drafts={...p.drafts},daily={...p.daily},days={...p.days};
  for(const date of pdays(pdate(today,1),end)){
    const saved=confirmed[date],base=daily[date]||{},pending=drafts[date]||{},conditions={u:{...base.u,...saved?.u,...pending.u},d:{...base.d,...saved?.d,...pending.d}};
    daily[date]={...daily[date],u:{...conditions.u,count:''},d:{...conditions.d,count:''}};
    if(days[date]?.mode!=='off')days[date]={mode:'auto',value:''};else days[date]={...days[date],resumeMode:'auto'};
    delete confirmed[date];delete drafts[date];
  }
  return {...p,confirmed,drafts,daily,days,...(p.planAnchors?{planAnchors}:{}),applied:{...p.applied,[today]:{record}}};
}
function dailyDraftRow(row,draft) {
  const condition=c=>({...c,price:pn(c.price),uph:pn(c.uph)});
  const r={...row,draft,conditions:{u:condition(draft.u),d:condition(draft.d)}};
  if(draft.basis==='counts'){
    r.u=pn(draft.u.count);r.d=pn(draft.d.count);r.quest=Math.min(row.quest,r.u);
    r.target=r.u*pn(draft.u.price)+r.d*pn(draft.d.price);r.deliveryGap=0;r.salesAdded=0;
  }else{
    r.target=draft.target===''?row.target:pn(draft.target);r.u=r.quest;r.d=0;
    r.deliveryGap=Math.max(0,r.target-r.u*pn(draft.u.price));
    r.salesAdded=pn(draft[r.fill].price)?Math.ceil(r.deliveryGap/pn(draft[r.fill].price)):0;r[r.fill]+=r.salesAdded;
  }
  r.revenue=r.u*pn(draft.u.price)+r.d*pn(draft.d.price);r.extraU=r.u-r.quest;r.extraD=r.d;
  r.minutes=dailyMinutes(r.u,r.d,r.conditions);r.dayShortfall=Math.max(0,r.target-r.revenue);
  return r;
}
function dailyEdit(p,row,key,field,value) {
  const draft=JSON.parse(JSON.stringify(p.drafts?.[row.date]||{basis:p.confirmed?.[row.date]?.basis||'amount',target:row.target,u:row.conditions.u,d:row.conditions.d}));
  if(key==='target'){
    draft.basis='amount';draft.target=value;draft.u.count='';draft.d.count='';
  }else{
    if(field==='count'){
      if(value===''){draft.basis='amount';draft.target=row.target;draft.u.count='';draft.d.count='';}
      else {if(draft.basis!=='counts'){draft.u.count=row.u;draft.d.count=row.d;}draft.basis='counts';}
    }
    draft[key][field]=value;
  }
  return {...p,drafts:{...p.drafts,[row.date]:draft}};
}
function dailyConfirm(vault,goals,p,date,today) {
  const plan=dailyPlan(vault,goals,p,date,today),part=plan.parts.find(part=>part.w.start<=date&&part.w.end>=date),r=part.rows.find(r=>r.date===date);
  if(!r?.eligible)throw Error('過去の日と休みの日は確定できません');
  if(r.u&&!r.conditions.u.price||r.d&&!r.conditions.d.price)throw Error('配達する会社の通常単価を設定してください');
  const snapshot=dailySnapshot(r);
  const committed=dailyPlan(vault,goals,p,date,today,false);
  const held=Object.fromEntries(committed.rows.filter(r=>r.eligible&&r.date>=part.w.start&&r.date<date).map(r=>[r.date,dailySnapshot(r)]));
  const drafts={...p.drafts};delete drafts[date];
  return {...p,drafts,confirmed:{...p.confirmed,[date]:snapshot},planAnchors:{...p.planAnchors,[part.w.start]:{asOf:today,date,end:part.w.end,held,afterApply:!!p.applied?.[today]}}};
}
function dailySnapshot(r) {return {basis:r.draft?.basis||r.confirmed?.basis||'amount',target:r.target,u:{count:r.u,price:r.conditions.u.price,uph:r.conditions.u.uph},d:{count:r.d,price:r.conditions.d.price,uph:r.conditions.d.uph}};}
function dailyRelease(p,date) {
  const confirmed={...p.confirmed},drafts={...p.drafts};delete confirmed[date];delete drafts[date];
  const planAnchors=Object.fromEntries(Object.entries(p.planAnchors||{}).filter(([,a])=>a.date!==date&&!a.held[date]));return {...p,confirmed,drafts,planAnchors};
}
function dailyValidate(p) {
  const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const date=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&pdate(d)===d;
  for(const name of ['daily','dailyPeriods','applied','drafts','confirmed','planAnchors'])if(p[name]!==undefined&&!obj(p[name]))throw Error('日別計画の形式が不正です');
  const snapshots=[p.drafts||{},p.confirmed||{}];
  for(const [start,a] of Object.entries(p.planAnchors||{})){
    if(!date(start)||!obj(a)||!date(a.asOf)||!date(a.date)||!date(a.end)||a.end<start||pdays(start,a.end).length>7||a.date<start||a.date>a.end||a.date<a.asOf||typeof a.afterApply!=='boolean'||!obj(a.held)||Object.keys(a.held).some(d=>d<start||d>=a.date||d<a.asOf))throw Error('計画再配分の形式が不正です');snapshots.push(a.held);
  }
  for(const group of snapshots)for(const [d,s] of Object.entries(group)){
    if(!date(d)||!obj(s)||!['counts','amount'].includes(s.basis)||!['number','string'].includes(typeof s.target)||!Number.isFinite(Number(s.target))||Number(s.target)<0)throw Error('確定計画・編集中の目標が不正です');
    for(const key of ['u','d']){
      if(!obj(s[key]))throw Error('確定計画・編集中の会社別条件が不正です');
      for(const f of ['count','price','uph']){const v=s[key][f];if(!['number','string'].includes(typeof v)||!Number.isFinite(Number(v))||Number(v)<0||f==='count'&&!Number.isSafeInteger(Number(v))||f==='uph'&&Math.abs(Number(v)*10-Math.round(Number(v)*10))>1e-7)throw Error('確定計画・編集中の件数・単価・UPHが不正です');}
    }
  }
  for(const s of Object.values(p.days))if(s.resumeMode!==undefined&&!['auto','amt','cnt'].includes(s.resumeMode))throw Error('稼働再開時の設定が不正です');
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
