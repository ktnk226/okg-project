const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const storage=new Map();
const c=vm.createContext({localStorage:{getItem:k=>storage.get(k)||null}});
vm.runInContext(fs.readFileSync(__dirname+'/simulation-core.js','utf8'),c);
const date='2026-11-06'; // Friday: three remaining days.
const plan=()=>({...c.pdefault(),calc:{u:500,d:600,uph:4,company:'u',share:100}});
const goals=()=>c.psetGoal({},date,'week',30000);
const quest=(overrides={})=>({id:'q',start:'2026-11-06',end:'2026-11-08',count:40,base:2000,extra:1000,adjust:0,aim:'base',finish:'n',status:'n',links:[],...overrides});
const log=(u=0,d=0,uq=0,dq=0)=>({sets:[{u_cnt_cum:u,d_cnt_cum:d,u_cum:u*500,d_cum:d*600,u_que_cum:uq,d_que_cum:dq}]});
const week=(p=plan(),v={},g=goals(),anchor=date,asOf=date)=>c.pweek(v,g,p,anchor,asOf);
const targets=w=>Array.from(w.rows.filter(r=>r.eligible),r=>r.target);
test('30,000 over three days; today 8,000 -> 11,000 each, counts and hours follow',()=>{
 const p=plan();assert.deepEqual(targets(week(p)),[10000,10000,10000]);
 p.days[date]={mode:'amt',value:8000};const w=week(p);
 assert.deepEqual(targets(w),[8000,11000,11000]);assert.equal(w.allocated,30000);
 const s=c.psummary({},goals(),p,date);assert.equal(s.target,8000);assert.equal(s.need,16);assert.equal(c.ptime(s.need,p.calc.uph),'4時間0分');
});
test('off and past days receive no allocations; integer remainder is conserved',()=>{
 const p=plan();p.days['2026-11-07']={mode:'off',value:9999};const w=week(p,{},c.psetGoal({},date,'week',30001));
 assert.deepEqual(targets(w),[15001,15000]);assert.equal(w.rows.find(r=>r.date==='2026-11-07').target,0);
 assert.equal(w.allocated,30001);assert.ok(w.rows.filter(r=>r.date<date).every(r=>r.target===0));
});
test('today actual reduces needs, keeps target stable, and overflow reduces future allocations',()=>{
 const p=plan(),g=goals();let s=c.psummary({[date]:log(4)},g,p,date);
 assert.equal(s.target,10000);assert.equal(s.remain,8000);assert.equal(s.need,16);assert.equal(s.w.remain,28000);
 assert.deepEqual(targets(week(p,{[date]:log(24)})),[12000,9000,9000]);
 p.days[date]={mode:'amt',value:8000};s=c.psummary({[date]:log(4)},g,p,date);assert.equal(s.remain,6000);assert.equal(s.need,12);assert.deepEqual(targets(s.w),[8000,11000,11000]);
});
test('past/off-day sales count; ended weeks and fully fixed schedules report unallocated/excess',()=>{
 const p=plan();p.days['2026-11-07']={mode:'off',value:''};const v={'2026-11-02':log(10),'2026-11-07':log(2)};
 assert.deepEqual(targets(week(p,v)),[12000,12000]);const ended=week(p,v,goals(),date,'2026-11-09');assert.equal(ended.allocated,0);assert.equal(ended.unallocated,24000);
 for(const d of [date,'2026-11-07','2026-11-08'])p.days[d]={mode:'off',value:''};assert.equal(week(p).unallocated,30000);
 for(const d of [date,'2026-11-07','2026-11-08'])p.days[d]={mode:'amt',value:1000};assert.equal(week(p).unallocated,27000);
 p.days[date]={mode:'amt',value:40000};assert.equal(week(p).excess,12000);
});
test('month/year goals and assumptions leave weekly allocations unchanged; weekly edit preserves month/year',()=>{
 const p=plan();p.days[date]={mode:'amt',value:8000};const g0=goals();g0['D-'+date]={amt:7000,cnt:20};const snapshot=JSON.stringify(week(p,{},g0));
 let g=c.psetGoal(g0,date,'month',500000);g=c.psetGoal(g,date,'year',6000000);
 p.horizons={'M-2026-11':{daily:25000,workDays:15},'Y-2026':{daily:20000,workDays:40}};
 assert.equal(JSON.stringify(week(p,{},g)),snapshot);assert.equal(g['D-'+date].cnt,20);assert.equal(c.pgoal(g0,date,'month'),0);
 g=c.psetGoal(g,date,'week',45000);assert.equal(c.pgoal(g,date,'month'),500000);assert.equal(c.pgoal(g,date,'year'),6000000);
});
test('month/year actual uses final cumulative amounts of all platforms/rewards within exact boundaries',()=>{
 const v={'2025-12-31':log(50),'2026-01-01':log(2),'2026-10-31':log(4),'2026-11-01':log(10,3,2000,500),'2026-11-30':{sets:[{u_cum:9000},{u_cum:10000,r_cum:3000,m_cum:2000,r_que_cum:1000}]},'2026-12-31':log(6),'2027-01-01':log(100)};
 const before=JSON.stringify(v),p=plan(),g=c.psetGoal({},date,'month',500000);const m=c.phorizon(v,g,p,date,'month',date);
 assert.equal(m.actual,25300);assert.equal(m.remain,474700);assert.equal(c.phorizon(v,{},p,date,'year',date).actual,31300);assert.equal(JSON.stringify(v),before);
});
test('independent horizon projections, leap years, past periods and remaining-day limits',()=>{
 const p=plan();p.horizons={'M-2026-11':{daily:20000,workDays:20},'Y-2026':{daily:10000,workDays:40}};
 let g=c.psetGoal({},date,'month',500000);g=c.psetGoal(g,date,'year',6000000);const v={'2026-11-01':log(200)};
 const h=c.phorizon(v,g,p,date,'month',date);assert.equal(h.actual,100000);assert.equal(h.remain,400000);assert.equal(h.required,20000);assert.equal(h.projection,500000);
 assert.equal(c.phorizon(v,g,p,date,'year',date).workDays,40);
 assert.equal(c.phorizon({},g,p,'2024-02-01','month','2024-02-01').remainingDays,29);assert.equal(c.phorizon({},g,p,'2024-01-01','year','2024-01-01').remainingDays,366);
 assert.equal(c.phorizon({},g,p,'2025-01-01','year',date).remainingDays,0);p.horizons['M-2026-11'].workDays=100;assert.equal(c.phorizon({},g,p,date,'month',date).workDays,25);
});
test('Uber quest excludes Demaecan/others/adjusted deliveries and respects mixed-platform rounding',()=>{
 const p=plan();p.quests=[quest({adjust:2})];const v={[date]:log(5,100)};
 assert.equal(c.pprogress(v,p.quests[0],date),3);assert.equal(c.psummary(v,goals(),p,date).uberNeed,13);
 p.calc.company='both';p.calc.share=50;assert.equal(c.psummary(v,goals(),p,date).need,25);p.calc.company='d';assert.equal(c.psummary(v,goals(),p,date).need,null);
});
test('quest deadlines, extra stage, off days and missing fares/UPH remain explicit',()=>{
 const p=plan();p.quests=[quest()];p.days['2026-11-07']={mode:'off',value:''};p.days['2026-11-08']={mode:'off',value:''};assert.equal(c.psummary({},goals(),p,date).uberNeed,40);
 p.quests[0].aim='extra';assert.equal(c.psummary({},goals(),p,date).uberNeed,50);p.days[date]={mode:'off',value:''};const s=c.psummary({},goals(),p,date);assert.equal(s.need,0);assert.equal(s.quotas[0].unallocated,50);
 p.days={};p.quests=[];p.calc.u='';assert.equal(c.psummary({},goals(),p,date).need,null);assert.equal(c.ptime(5,''),'未設定');
});
test('forecast is separate, recorded rewards auto-deduct; confirmation never writes sales',()=>{
 const p=plan();p.quests=[quest()];p.weekly[c.pgoalKey(date,'week')]={includeQuest:true};const v={[date]:log(0,0,2000)},before=JSON.stringify(v);
 let w=week(p,v);assert.equal(w.actual,2000);assert.equal(w.forecast,0);assert.equal(w.deliveryRemain,28000);
 w=week(p);assert.equal(w.actual,0);assert.equal(w.forecast,2000);assert.equal(w.deliveryRemain,28000);
 p.quests[0].status='base';assert.equal(week(p).actual,0);assert.equal(week(p).forecast,2000);p.quests[0].status='miss';assert.equal(week(p).forecast,0);assert.equal(JSON.stringify(v),before);
});
test('partial/linked rewards claim each yen once across quests, reject excessive links',()=>{
 const p=plan();p.quests=[quest({id:'front',start:'2026-11-02',end:'2026-11-05',status:'base',links:[{date,amount:1000}]}),quest()];const v={[date]:log(0,0,1500)},m=c.pquestMoney(v,p,date);
 assert.equal(m[0].recorded,1000);assert.equal(m[0].pending,1000);assert.equal(m[1].recorded,500);assert.equal(m[1].pending,1500);assert.equal(c.plinkCheck(p,v),'');
 p.quests[0].links[0].amount=2000;assert.match(c.plinkCheck(p,v),/超えています/);
});
test('expired unconfirmed quests have no forecast; extra/confirmed-unrecorded rewards remain distinct',()=>{
 const p=plan();p.quests=[quest({start:'2026-11-02',end:'2026-11-05'})];assert.equal(week(p).forecast,0);p.quests[0].status='extra';assert.equal(week(p).forecast,3000);
 assert.equal(c.preward(p.quests[0],39),0);assert.equal(c.preward(p.quests[0],40),2000);assert.equal(c.preward(p.quests[0],50),3000);
});
test('legacy v15 and daily goals read unchanged, new settings restore, corrupt data stays protected',()=>{
 const p=plan();delete p.horizons;delete p.weekly;p.days[date]={mode:'cnt',value:20};p.quests=[quest({finish:'base'})];storage.set('delivery_log_planning_v15',JSON.stringify(p));
 assert.equal(c.pload().error,'');assert.equal(JSON.stringify(c.pload().data),JSON.stringify(p));assert.equal(c.psummary({},goals(),p,date).target,10000);
 const old={['D-'+date]:{amt:8000,cnt:12}};p.days={};assert.equal(c.psummary({},old,p,date).target,8000);p.days[date]={mode:'auto',value:''};assert.equal(c.psummary({},goals(),p,date).target,10000);
 p.horizons={'M-2026-11':{daily:20000,workDays:12}};p.weekly={'W-2026-W45':{includeQuest:true}};storage.set('delivery_log_planning_v15',JSON.stringify(p));assert.equal(JSON.stringify(c.pload().data),JSON.stringify(p));
 const invalid='{"invalid":true}';storage.set('delivery_log_planning_v15',invalid);assert.match(c.pload().error,/保護/);assert.equal(storage.get('delivery_log_planning_v15'),invalid);
});
test('year boundaries retain existing week keys',()=>{
 assert.equal(c.pgoalKey('2027-01-01','week'),c.pgoalKey('2026-12-28','week'));const g=c.psetGoal({},'2027-01-01','week',70000);assert.equal(week(plan(),{},g,'2027-01-01','2026-12-28').goal,70000);
 assert.equal(c.pgoalKey(date,'month'),'M-2026-11');assert.equal(c.pgoalKey(date,'year'),'Y-2026');
});
test('signed accounting corrections match Home totals and do not create negative reward claims',()=>{
 const p=plan();p.quests=[quest()];const v={[date]:{sets:[{u_cum:1000,d_cum:-200,r_cum:300,m_cum:0,u_que_cum:-100}]}};
 assert.equal(c.pday(v,date).total,1000);assert.equal(c.phorizon(v,{},p,date,'month',date).actual,1000);assert.equal(c.phorizon(v,{},p,date,'year',date).actual,1000);
 assert.equal(c.pquestMoney(v,p,date)[0].recorded,0);assert.equal(c.pquestMoney(v,p,date)[0].pending,2000);
});
test('quest-first example, actual revenue, deadlines, holidays and decimal UPH persistence',()=>{
 const p=plan();p.calc={...p.calc,strategy:'quest',u:320,d:400,uph:3.2};p.models[1].uph=3.5;p.quests=[quest({count:100,base:12000})];const g=c.psetGoal({},date,'week',50000);
 let r=c.pcompanyPlan({},g,p,date,date);assert.equal(r.u,100);assert.equal(r.d,15);assert.deepEqual(Array.from(r.rows.filter(x=>x.eligible),x=>[x.u,x.d]),[[34,5],[34,5],[32,5]]);assert.equal(c.ptime(39,3.2),'12時間12分');
 const paid=c.pcompanyPlan({[date]:{sets:[{u_que_cum:12000}]}},g,p,date,date);assert.equal(paid.w.forecast,0);assert.equal(paid.delivery,38000);assert.equal(paid.d,15);
 const before=JSON.stringify(p);const v={[date]:{sets:[{u_cum:15000,u_cnt_cum:34,d_cnt_cum:50}]}};
 r=c.pcompanyPlan(v,g,p,date,'2026-11-07');assert.equal(r.u,66);assert.equal(r.d,5);assert.equal(r.rows.find(x=>x.date===date).need,0);
 assert.ok(r.requiredAverage>0);p.days['2026-11-07']={mode:'off',value:''};r=c.pcompanyPlan(v,g,p,date,'2026-11-07');assert.equal(r.rows.find(x=>x.date==='2026-11-07').u,0);assert.equal(r.rows.find(x=>x.date==='2026-11-08').u,66);
 r=c.pcompanyPlan({[date]:{sets:[{u_cum:50000,u_cnt_cum:4}]}},g,p,date,date);assert.equal(r.u,96);assert.equal(r.d,0);
 const poor=c.pcompanyPlan({[date]:{sets:[{u_cum:1000,u_cnt_cum:2}]}},g,p,date,'2026-11-07');assert.ok(poor.requiredAverage>c.pcompanyPlan({},g,p,date,date).requiredAverage);
 storage.set('delivery_log_planning_v15',before);const restored=c.pload().data;assert.equal(Number(restored.calc.uph),3.2);assert.equal(Number(restored.models[1].uph),3.5);assert.equal(c.ptime(35,restored.models[1].uph),'10時間0分');assert.equal(JSON.stringify(c.pvalidate(JSON.parse(before))),before);
});
