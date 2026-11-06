const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const storage=new Map(),c=vm.createContext({localStorage:{getItem:k=>storage.get(k)||null}});
for(const f of ['simulation-core.js','daily-planning.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),c);
const day='2026-11-06';
const plan=()=>({...c.pdefault(),calc:{u:350,d:500,uph:3.2,company:'u',share:100}});
const goals=(back=30000,front=0)=>c.psetPart(c.psetPart({},day,'front',front),day,'back',back);
const entry=(money,u=0,d=0,reward=0)=>({sets:[{u_cum:money,u_cnt_cum:u,d_cnt_cum:d,u_que_cum:reward}]});
const q=()=>({id:'q',start:day,end:'2026-11-08',count:120,base:13000,extra:0,adjust:0,aim:'base',finish:'n',status:'n',links:[]});
const back=(v,g,p,t=day)=>c.dailyPlan(v,g,p,day,t).parts[1];
const counts=r=>Array.from(r.rows,x=>x.u);
test('quest auto allocation 40/40/40 -> manual 45/45/30; fixed counts and holidays',()=>{
 const p=plan();p.quests=[q()];assert.deepEqual(counts(back({},goals(60000),p)),[40,40,40]);
 p.daily={[day]:{u:{count:45}},'2026-11-07':{u:{count:45}}};assert.deepEqual(counts(back({},goals(60000),p)),[45,45,30]);
 p.days['2026-11-07']={mode:'off',value:''};assert.deepEqual(counts(back({},goals(60000),p)),[45,0,75]);
 p.daily['2026-11-08']={u:{count:30}};const r=back({},goals(60000),p);assert.equal(r.nextUnallocatedUber,0);assert.deepEqual(counts(r),[68,0,52]);assert.equal(p.daily['2026-11-08'].u.count,30);
});
test('5,000 gap -> 10 at 500 or 13 at 400; choose Uber instead of Demaecan',()=>{
 const p=plan();p.quests=[q()];p.days={[day]:{mode:'amt',value:19000},'2026-11-07':{mode:'amt',value:14000}};let r=back({},goals(60000),p);assert.equal(r.rows.reduce((n,x)=>n+x.d,0),10);
 p.calc.d=400;r=back({},goals(60000),p);assert.equal(r.rows.reduce((n,x)=>n+x.d,0),13);
 p.dailyPeriods={[day]:{fill:'u'}};r=back({},goals(60000),p);assert.equal(r.rows.reduce((n,x)=>n+x.d,0),0);assert.equal(r.rows.reduce((n,x)=>n+x.extraU,0),15);
});
test('live actuals preserve today goal and ALL future plans until explicit apply',()=>{
 const p=plan(),g=goals();const original=back({},g,p);for(const amount of [2000,5000,12000,15000]){
 const r=back({[day]:entry(amount)},g,p);assert.deepEqual(Array.from(r.rows,x=>x.target),[10000,10000,10000]);assert.deepEqual(Array.from(r.rows,x=>x.d),Array.from(original.rows,x=>x.d));
 const s=c.dailySummary({[day]:entry(amount)},g,p,day);assert.equal(s.target,10000);assert.equal(s.remain,Math.max(0,10000-amount));assert.equal(s.over,Math.max(0,amount-10000));if(amount>=10000)assert.equal(s.need,0);
 }
});
test('apply snapshots replace cumulative actuals, hold today target; repeated apply has no double count',()=>{
 let p=plan();const g=goals();for(const [amount,next] of [[12000,9000],[15000,7500],[8000,11000]]){
 const v={[day]:entry(amount)};p=c.dailyApply(v,p,day);const r=back(v,g,p);assert.deepEqual(Array.from(r.rows,x=>x.target),[10000,next,next]);
 const twice=c.dailyApply(v,p,day);assert.equal(JSON.stringify(back(v,g,twice)),JSON.stringify(r));
 const later=back({[day]:entry(amount+1000)},g,p);assert.deepEqual(Array.from(later.rows,x=>x.target),[10000,next,next]);assert.equal(v[day].sets[0].u_cum,amount);
 }
});
test('next business day uses latest saved past actuals rather than old applied snapshot',()=>{
 let p=c.dailyApply({[day]:entry(12000)},plan(),day);const r=back({[day]:entry(15000)},goals(),p,'2026-11-07');assert.deepEqual(Array.from(r.rows.filter(x=>x.eligible),x=>x.target),[7500,7500]);
});
test('company-specific daily fare and decimal UPH stay isolated and affect revenue and time',()=>{
 const p=plan();p.quests=[q()];p.daily={[day]:{u:{price:400,uph:3.5}},'2026-11-07':{u:{price:300,uph:3.2},d:{price:500,uph:3}}};
 const r=back({},goals(60000),p);assert.equal(r.rows[0].conditions.u.price,400);assert.equal(r.rows[1].conditions.u.price,300);assert.equal(r.rows[2].conditions.u.price,350);assert.equal(r.rows[0].conditions.u.uph,3.5);assert.equal(r.rows[1].conditions.d.uph,3);assert.equal(c.dailyMinutes(35,0,r.rows[0].conditions),600);
 assert.equal(c.pvalidate(JSON.parse(JSON.stringify(p))).daily[day].u.uph,3.5);
});
test('quests stay independent, Demaecan is excluded, paid rewards never double count',()=>{
 const p=plan();p.quests=[q()];const g=goals(60000,30000),v={'2026-11-05':entry(30000),[day]:entry(0,20,90,13000)};const before=JSON.stringify(v);
 let r=back(v,g,p);assert.equal(r.questRemaining,100);assert.equal(r.pendingRewards,0);assert.equal(r.recordedRewards,13000);
 const applied=c.dailyApply(v,p,day);r=back(v,g,applied);assert.equal(r.reflected.w.forecast,0);assert.equal(r.reflected.delivery,47000);assert.equal(r.reflected.rows.reduce((n,x)=>n+x.quest,0),100);
 assert.equal(c.dailyPlan(v,g,applied,day,day).parts[0].w.goal,30000);assert.equal(JSON.stringify(v),before);
});
test('over-target sales retain Uber obligation; final day/all days off report unmet needs without division by zero',()=>{
 const p=plan();p.quests=[q()];const s=c.dailySummary({[day]:entry(60000,10,50)},goals(60000),p,day);assert.equal(s.remain,0);assert.equal(s.row.remainingU,30);
 for(const d of [day,'2026-11-07','2026-11-08'])p.days[d]={mode:'off',value:''};let r=back({},goals(60000),p);assert.equal(r.nextUnallocatedUber,120);assert.equal(r.rows.reduce((n,x)=>n+x.u+x.d,0),0);
 p.days={};r=back({},goals(60000),p,'2026-11-08');assert.equal(r.rows[2].quest,120);assert.equal(r.rows[0].eligible,false);
});
test('new fields round-trip with legacy keys; corrupt additions protected',()=>{
 const p=plan();p.daily={[day]:{u:{count:45,price:400,uph:3.2},d:{count:'',price:500,uph:3.5}}};p.dailyPeriods={[day]:{fill:'u'}};const saved=c.dailyApply({[day]:entry(12000,30)},p,day);
 storage.set('delivery_log_planning_v15',JSON.stringify(saved));assert.equal(JSON.stringify(c.pload().data),JSON.stringify(saved));assert.equal(c.pload().error,'');
 const legacy=plan();storage.set('delivery_log_planning_v15',JSON.stringify(legacy));assert.equal(JSON.stringify(c.pload().data),JSON.stringify(legacy));
 saved.daily[day].u.uph=3.22;storage.set('delivery_log_planning_v15',JSON.stringify(saved));assert.match(c.pload().error,/保護/);assert.equal(JSON.parse(storage.get('delivery_log_planning_v15')).daily[day].u.uph,3.22);
});
test('missing fares and UPH remain explicitly unresolved rather than a zero-time recommendation',()=>{
 const p=plan();p.calc.d='';const s=c.dailySummary({},goals(),p,day);assert.equal(s.need,null);assert.equal(s.time,'単価未設定');
 p.calc.d=500;p.calc.uph='';assert.equal(c.dailySummary({},goals(),p,day).time,'UPH未設定');
});
test('manual daily money targets also guide automatic company counts',()=>{
 const p=plan();p.calc.d=500;p.days[day]={mode:'amt',value:8000};const r=back({},goals(),p);assert.deepEqual(Array.from(r.rows,x=>x.target),[8000,11000,11000]);assert.deepEqual(Array.from(r.rows,x=>x.d),[16,22,22]);
});
test('applying on the final day does not expire the quest or imply work is finished',()=>{
 const p=plan();p.quests=[q()];const today='2026-11-08',v={[today]:entry(42000,120)},next=c.dailyApply(v,p,today);
 const r=back(v,goals(60000),next,today);assert.equal(r.reflected.w.forecast,13000);assert.equal(r.reflected.delivery,5000);assert.equal(r.reflected.rows.filter(x=>x.eligible).length,0);assert.equal(r.rows[2].eligible,true);assert.equal(r.rows[2].target,47000);assert.equal(c.dailySummary(v,goals(60000),next,today).remain,5000);
});
test('front shortfall is derived once, starts Friday, follows corrected actuals and never mutates goals or quests',()=>{
 const p=plan();p.quests=[{...q(),id:'front',start:'2026-11-02',end:'2026-11-05',count:100}, {...q(),count:100}];const g=goals(50000,30000),v={'2026-11-02':entry(25000,20,90)};
 const before=JSON.stringify({p,g,v});let r=back(v,g,p);assert.equal(r.configuredGoal,50000);assert.equal(r.carried,5000);assert.equal(r.w.goal,55000);assert.equal(r.questRemaining,100);assert.equal(r.rows.reduce((n,x)=>n+x.quest,0),100);
 assert.equal(back(v,g,p,'2026-11-05').carried,0);assert.equal(back(v,g,p,'2026-11-05').w.goal,50000);assert.equal(JSON.stringify({p,g,v}),before);
 let saved=c.dailyApply({ ...v,[day]:entry(12000,20)},p,day);r=back({...v,[day]:entry(12000,20)},g,saved);assert.equal(r.reflected.w.goal,55000);
 for(let i=0;i<3;i++){saved=c.pvalidate(JSON.parse(JSON.stringify(c.dailyApply({...v,[day]:entry(12000,20)},saved,day))));assert.equal(back(v,g,saved).carried,5000);assert.equal(c.pgoal(g,day,'week'),80000);}
 assert.equal(back({'2026-11-02':entry(28000)},g,saved).carried,2000);assert.equal(back({'2026-11-02':entry(35000)},g,saved).carried,0);
 const otherWeek=c.dailyPlan(v,g,p,'2026-11-13','2026-11-13');assert.equal(otherWeek.parts[0].carried,0);
});
test('delivery pool 40,000 preserves 10,000 fixed and spreads 15,000 each; all manual overages retained',()=>{
 const p=plan();p.quests=[{...q(),count:100,base:10000}];p.days={[day]:{mode:'amt',value:10000}};
 let r=back({},goals(50000),p);assert.equal(r.delivery,40000);assert.deepEqual(Array.from(r.rows,x=>x.target),[10000,15000,15000]);
 p.days['2026-11-07']={mode:'amt',value:20000};p.days['2026-11-08']={mode:'amt',value:20000};
 r=back({},goals(50000),p);assert.deepEqual(Array.from(r.rows,x=>x.target),[10000,20000,20000]);assert.equal(r.targetExcess,10000);assert.ok(r.planned>=50000);assert.equal(r.shortfall,0);
 assert.deepEqual(Array.from(back({},goals(50000),c.pvalidate(JSON.parse(JSON.stringify(p)))).rows,x=>x.target),[10000,20000,20000]);
});
test('100 quest, first 20 then 35 actuals -> mandatory 40/40 then 45; final 20,000 target adds 12 Demaecan',()=>{
 let p=plan();p.calc.u=320;p.quests=[{...q(),count:100,base:10000}];p.days={[day]:{mode:'amt',value:10000},'2026-11-07':{mode:'amt',value:20000},'2026-11-08':{mode:'amt',value:20000}};
 const g=goals(50000),v={[day]:entry(6400,20,100)};p=c.dailyApply(v,p,day);let r=back(v,g,p);assert.deepEqual(Array.from(r.rows,x=>x.quest),[34,40,40]);assert.equal(r.questRemaining,80);
 const live={...v,'2026-11-07':entry(11200,35,100)};p=c.dailyApply(live,p,'2026-11-07');r=back(live,g,p,'2026-11-07');const last=r.rows[2];
 assert.equal(r.questRemaining,45);assert.equal(last.quest,45);assert.equal(last.target,20000);assert.equal(last.quest*last.conditions.u.price,14400);assert.equal(last.deliveryGap,5600);assert.equal(last.salesAdded,12);assert.equal(last.d,12);assert.equal(last.revenue,20400);assert.equal(last.minutes,1069);
 const twice=c.dailyApply(live,p,'2026-11-07');assert.equal(JSON.stringify(back(live,g,twice,'2026-11-07')),JSON.stringify(r));
 const restored=c.pvalidate(JSON.parse(JSON.stringify(twice)));assert.equal(back(live,g,restored,'2026-11-08').rows[2].quest,45);
 p.daily={'2026-11-08':{u:{price:320,uph:3.2},d:{price:400,uph:3.5}}};const cheaper=back(live,g,p,'2026-11-07').rows[2];assert.equal(cheaper.salesAdded,14);assert.equal(cheaper.revenue,20000);assert.equal(cheaper.minutes,1084);assert.equal(last.conditions.d.price,500);
 p.dailyPeriods={[day]:{fill:'u'}};const uber=back(live,g,p,'2026-11-07').rows[2];assert.equal(uber.quest,45);assert.equal(uber.salesAdded,18);assert.equal(uber.u,63);assert.equal(uber.d,0);
});
test('daily fill uses that day target even if another day greatly exceeds its goal',()=>{
 const p=plan();p.quests=[{...q(),count:100,base:10000}];p.calc.u=320;
 p.days={[day]:{mode:'amt',value:0},'2026-11-07':{mode:'amt',value:20000},'2026-11-08':{mode:'amt',value:20000}};
 p.daily={[day]:{u:{count:90}},'2026-11-07':{u:{count:5}},'2026-11-08':{u:{count:5}}};
 const r=back({},goals(50000),p);assert.equal(r.rows[0].u,90);assert.equal(r.rows[1].d,37);assert.equal(r.rows[2].d,37);assert.ok(r.rows[1].revenue>=20000);assert.ok(r.rows[2].revenue>=20000);
});
test('reward entries reduce period needs once, never count toward delivery-only daily progress',()=>{
 const p=plan();p.quests=[{...q(),count:100,base:10000}];p.days={[day]:{mode:'amt',value:10000}};const g=goals(50000);
 const v={[day]:entry(2000,5,10,10000)};let s=c.dailySummary(v,g,p,day);assert.equal(s.target,10000);assert.equal(s.actual,2000);assert.equal(s.remain,8000);assert.equal(s.plan.parts[1].pendingRewards,0);
 const applied=c.dailyApply(v,p,day),r=back(v,g,applied);assert.equal(r.reflected.w.forecast,0);assert.equal(r.reflected.delivery,38000);assert.equal(r.rows[0].target,10000);assert.equal(r.rows[0].remaining,8000);
 const unpaid=c.dailyApply({[day]:entry(2000,5,10)},p,day);assert.equal(back({[day]:entry(2000,5,10)},g,unpaid).reflected.delivery,38000);
});
test('carryover + day rollover + holidays + last-day apply retain unmet quest without infinite values',()=>{
 let p=plan();p.quests=[{...q(),count:100,base:10000}];p.days['2026-11-07']={mode:'off',value:''};const v={'2026-11-05':entry(25000),[day]:entry(10000,20,100)},g=goals(50000,30000);p=c.dailyApply(v,p,day);
 let r=back(v,g,p);assert.equal(r.carried,5000);assert.equal(r.rows[1].quest,0);assert.equal(r.rows[2].quest,80);
 v[day]=entry(55000,20,100);r=back(v,g,p,'2026-11-08');assert.equal(r.rows[2].target,0);assert.equal(r.rows[2].quest,80);assert.equal(r.rows[2].u,80);
 v['2026-11-08']=entry(1000,5);p=c.dailyApply(v,p,'2026-11-08');r=back(v,g,p,'2026-11-08');assert.equal(r.nextUnallocatedUber,75);assert.equal(r.rows[2].remainingQuest,75);assert.equal(r.rows[2].remainingU,75);assert.ok(Number.isFinite(r.rows[2].remainingMinutes));assert.ok(Number.isFinite(r.reflected.shortfall));
});
test('carryover handles year-boundary week and signed sales corrections; month/year edits leave daily plans unchanged',()=>{
 const p=plan(),date='2027-01-01';let g=c.psetPart(c.psetPart({},date,'front',30000),date,'back',50000);const v={'2026-12-28':entry(26000),'2026-12-31':entry(-1000)};
 let r=c.dailyPlan(v,g,p,date,date);assert.equal(r.parts[1].carried,5000);assert.equal(r.parts[1].w.goal,55000);const before=JSON.stringify(r);
 g=c.psetGoal(c.psetGoal(g,date,'month',450000),date,'year',6000000);assert.equal(JSON.stringify(c.dailyPlan(v,g,p,date,date)),before);
});
