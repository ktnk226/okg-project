const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({});for(const f of ['simulation-core.js','daily-planning.js','simulation-outlook.js','daily-goals.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),c);
const mon='2026-11-02',tue='2026-11-03',wed='2026-11-04',thu='2026-11-05',fri='2026-11-06',sun='2026-11-08';
const plain=x=>JSON.parse(JSON.stringify(x));
const quest=(start=mon,end=thu,base=9000,id='front')=>({id,start,end,count:90,base,extra:1000,adjust:0,aim:'base',finish:'n',status:'n',links:[]});
const initial=()=>({...c.pdefault(),calc:{u:400,d:400,uph:3,company:'u',share:100},quests:[quest()]});
const plan=(p,v={},today=mon,date=mon,g={})=>c.dailyGoalPlan(v,g,p,date,today);
const row=(p,date,v={},today=mon)=>plan(p,v,today,date).rows.find(r=>r.date===date);
const edit=(p,date,key,field,value)=>c.dailyEdit(p,row(p,date),key,field,value);
const counts=(p,date,u='20',d='10')=>edit(edit(p,date,'u','count',u),date,'d','count',d);
const three=()=>[mon,tue,thu].reduce((p,date)=>counts(p,date),initial());
const shares=(p,v={},today=mon)=>Array.from(plan(p,v,today).rows,r=>r.questAllocation);
const sum=xs=>xs.reduce((n,x)=>n+x,0);
test('9,000 over Mon/Tue/Thu yields 3,000 each; Demaecan 10 -> 15 updates 15,000 -> 17,000 without altering Uber',()=>{
 let p=three();p.days[wed]={mode:'off',value:''};assert.deepEqual(shares(p),[3000,3000,0,3000,0,0,0]);
 let r=row(p,mon);assert.deepEqual([r.uberDelivery,r.demaecanDelivery,r.questAllocation,r.salesTarget],[8000,4000,3000,15000]);
 p=edit(p,mon,'d','count','15');r=row(p,mon);assert.equal(r.u,20);assert.equal(r.target,14000);assert.equal(r.salesTarget,17000);
 const o=c.dailyGoalOutlook({}, {},p,mon,mon);assert.deepEqual([o.parts[0].goal,o.parts[1].goal,o.week.goal],[47000,0,47000]);
});
test('manual company counts can be below the quota; entering Demaecan first never fills Uber silently',()=>{
 let p=edit(initial(),mon,'d','count','10');assert.equal(row(p,mon).u,0);assert.equal(row(p,mon).d,10);
 p=edit(p,mon,'u','count','20');assert.equal(row(p,mon).u,20);assert.equal(row(p,mon).d,10);
});
test('one-yen remainder goes in date order and front/back allocations sum exactly to each original reward',()=>{
 let p=three();p.quests=[quest(mon,thu,9001),quest(fri,sun,7001,'back')];p=counts(counts(p,fri),sun);
 assert.deepEqual(shares(p),[3001,3000,0,3000,3501,0,3500]);
 const o=c.dailyGoalOutlook({}, {},p,mon,mon);
 assert.deepEqual([o.parts[0].questAllocation,o.parts[1].questAllocation,o.week.questAllocation],[9001,7001,16002]);
 assert.equal(o.parts[0].goal+o.parts[1].goal,o.week.goal);assert.equal(sum(o.plan.rows.map(r=>r.salesTarget)),o.week.goal);
});
test('off, absent, price-only and cleared amount plans are excluded; explicit zero counts are still an entered workday',()=>{
 let p=initial();p=edit(p,mon,'u','price','450');p=edit(p,tue,'target',null,'');p.days[wed]={mode:'off',value:''};
 let a=c.dailyQuestAllocations({}, {},p,mon).quests[0];assert.equal(a.unallocated,9000);assert.deepEqual(plain(a.dates),[]);
 assert.equal(row(p,mon).hasPlan,false);assert.equal(row(p,tue).hasPlan,false);
 p=counts(p,thu,'0','0');a=c.dailyQuestAllocations({}, {},p,mon).quests[0];assert.deepEqual(plain(a.dates),[thu]);assert.equal(row(p,thu).questAllocation,9000);
});
test('deletion excludes the date and cannot revive an old daily goal or distribute onto legacy zero placeholders',()=>{
 let p=three();p=c.dailyGoalDelete(p,mon);p.days[wed]={mode:'amt',value:0};
 const g={['D-'+mon]:{amt:10000}};const a=c.dailyQuestAllocations({},g,p,mon).quests[0];assert.deepEqual(plain(a.dates),[tue,thu]);
 assert.equal(a.allocations[0].amount,4500);assert.equal(row(p,mon).hasPlan,false);
});
test('turning a workday off redistributes its share; past entered days remain allocation days after rollover',()=>{
 let p=three();p.days[tue]={mode:'off',value:''};assert.deepEqual(shares(p),[4500,0,0,4500,0,0,0]);
 delete p.days[tue];assert.deepEqual(shares(p,{},fri),[3000,3000,0,3000,0,0,0]);assert.equal(row(p,mon,{},fri).questShares[0].expired,true);
});
test('selected extra stage, confirmed stage, miss and excluded quests follow existing reward rules',()=>{
 const p=three();p.quests[0].aim='extra';assert.equal(sum(shares(p)),10000);
 p.quests[0].status='base';assert.equal(sum(shares(p)),9000);assert.equal(row(p,mon).questForecastAllocation,0);
 p.quests[0].status='extra';assert.equal(sum(shares(p)),10000);
 p.quests[0].status='miss';assert.equal(sum(shares(p)),0);
 p.quests[0].status='n';p.quests[0].aim='n';assert.equal(sum(shares(p)),0);
});
test('recorded full reward is never added to the achievement comparison twice and never changes plan targets',()=>{
 const p=three(),v={[mon]:{sets:[{u_cum:8000,d_cum:4000,u_que_cum:9000}]}};const before=JSON.stringify({p,v});
 let r=row(p,mon,v);assert.equal(r.actual,12000);assert.equal(r.actualTotal,21000);assert.equal(r.actualAtAchievement,15000);assert.equal(r.salesTarget,15000);
 const a=c.dailyQuestAllocations(v,{},p,mon).quests[0];assert.equal(a.recorded,9000);assert.equal(a.pending,0);assert.equal(sum(a.allocations.map(x=>x.pending)),0);
 assert.equal(c.dailyGoalOutlook(v,{},p,mon,mon).week.actual,21000);assert.equal(JSON.stringify({p,v}),before);
});
test('partial rewards conserve original = recorded credit + unrecorded allocations, including remainders',()=>{
 const p=three();p.quests[0].base=9001;const v={[thu]:{sets:[{u_que_cum:1001}]}};
 const a=c.dailyQuestAllocations(v,{},p,mon).quests[0];assert.equal(sum(a.allocations.map(x=>x.amount)),9001);
 assert.equal(sum(a.allocations.map(x=>x.recorded)),1001);assert.equal(sum(a.allocations.map(x=>x.pending)),8000);
 for(const x of a.allocations)assert.equal(x.recorded+x.pending,x.amount);
 assert.equal(sum(shares(p,v)),9001);
});
test('outside-period links claim each recorded yen once across the front and back quests',()=>{
 let p=three();p.quests=[quest(),quest(fri,sun,9000,'back')];p=counts(p,fri);
 const outside='2026-11-01',v={[outside]:{sets:[{u_que_cum:9000}]}};
 p.quests[0].links=[{date:outside,amount:4000}];p.quests[1].links=[{date:outside,amount:5000}];
 assert.equal(c.plinkCheck(p,v),'');const a=c.dailyQuestAllocations(v,{},p,mon).quests;
 assert.equal(sum(a.map(x=>x.recorded)),9000);assert.equal(sum(a.flatMap(x=>x.allocations).map(x=>x.pending)),9000);
 assert.equal(sum(a.flatMap(x=>x.allocations).map(x=>x.amount)),18000);
});
test('no allocation days reports the full unallocated reward separately from the already-recorded portion',()=>{
 const p=initial(),v={[mon]:{sets:[{u_que_cum:1000}]}};
 const a=c.dailyQuestAllocations(v,{},p,mon).quests[0];assert.equal(a.unallocated,9000);assert.equal(a.unallocatedPending,8000);assert.equal(c.dailyGoalOutlook(v,{},p,mon,mon).week.goal,0);
});
test('direct delivery amounts remain exact, and confirmation stores delivery-only targets without compounding rewards',()=>{
 let p=three();p=edit(p,mon,'target',null,'1001');let r=row(p,mon);assert.equal(r.salesTarget,4001);
 p=c.dailyGoalConfirm({}, {},p,mon,mon);assert.equal(p.confirmed[mon].target,1001);assert.equal(row(p,mon).salesTarget,4001);
 p=c.dailyGoalConfirm({}, {},p,mon,mon);assert.equal(row(p,mon).salesTarget,4001);
 p.quests[0].base=12000;assert.equal(row(p,mon).salesTarget,5001);assert.equal(p.confirmed[mon].target,1001);
});
test('quest windows crossing a week boundary allocate globally rather than duplicating the full reward in each week',()=>{
 let p=initial();p.quests=[quest('2026-11-07','2026-11-10')];p=counts(counts(p,'2026-11-07'),'2026-11-09');
 const first=plan(p),next=plan(p,{},mon,'2026-11-09');assert.equal(sum(first.rows.map(r=>r.questAllocation)),4500);assert.equal(sum(next.rows.map(r=>r.questAllocation)),4500);
});
test('v16-compatible planning data round-trips and allocation reads never write shares into records or snapshots',()=>{
 let p=three();p=c.dailyGoalConfirm({}, {},p,mon,mon);const v={[mon]:{sets:[{u_cum:8000,u_que_cum:2000}]}},before=JSON.stringify({p,v});
 const restored=c.pvalidate(JSON.parse(JSON.stringify(p)));assert.deepEqual(shares(restored,v),shares(p,v));
 assert.equal(JSON.stringify({p,v}),before);assert.equal(p.confirmed[mon].questAllocation,undefined);assert.equal(p.confirmed[mon].target,12000);
});
test('integer allocation conserves every yen for small budgets, partial records and zero-to-four allocation days',()=>{
 for(let amount=0;amount<20;amount++)for(let n=0;n<=4;n++){
  let p=initial();p.quests[0].base=amount;for(const date of [mon,tue,wed,thu].slice(0,n))p=counts(p,date);
  const recorded=Math.floor(amount/2),a=c.dailyQuestAllocations({[mon]:{sets:[{u_que_cum:recorded}]}},{},p,mon).quests[0];
  assert.equal(sum(a.allocations.map(x=>x.amount))+a.unallocated,amount);
  assert.equal(sum(a.allocations.map(x=>x.pending))+a.unallocatedPending,amount-recorded);
  for(const x of a.allocations)assert.ok(Number.isInteger(x.amount)&&x.amount>=0&&x.pending>=0&&x.recorded>=0);
 }
});
