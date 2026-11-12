const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({});
for(const f of ['simulation-core.js','daily-planning.js','simulation-outlook.js','daily-goals.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),c);
const mon='2026-11-02',fri='2026-11-06';
const plan=()=>({...c.pdefault(),calc:{u:400,d:500,uph:3.2,company:'u',share:100}});
const view=(p,g={},v={},today=mon,date=mon)=>c.dailyGoalOutlook(v,g,p,date,today);
const row=(p,d,g={})=>view(p,g,{},mon,d).plan.rows.find(r=>r.date===d);
const edit=(p,d,k,f,v,g={})=>c.dailyEdit(p,row(p,d,g),k,f,v);
const counts=(p,d,u,n)=>edit(edit(p,d,'u','count',u),d,'d','count',n);
const totals=o=>[...o.parts.map(p=>p.goal),o.week.goal];
test('no week goal: front/back count plans aggregate immediately; price and count edits update only their part',()=>{
 let p=counts(plan(),mon,'20','10');assert.deepEqual(totals(view(p)),[13000,0,13000]);assert.equal(row(p,mon).target,13000);
 p=counts(p,fri,'10','4');assert.deepEqual(totals(view(p)),[13000,6000,19000]);
 p=edit(p,mon,'u','count','25');assert.deepEqual(totals(view(p)),[15000,6000,21000]);
 p=edit(p,fri,'d','price','600');assert.deepEqual(totals(view(p)),[15000,6400,21400]);
 assert.equal(c.dailyGoalSummary({}, {},p,mon).target,15000);
});
test('money-driven targets use the exact amount rather than rounded-up count revenue',()=>{
 let p=edit(plan(),mon,'target',null,'1001');assert.equal(row(p,mon).revenue,1500);assert.equal(row(p,mon).target,1001);
 p=edit(p,fri,'target',null,'2001');assert.deepEqual(totals(view(p)),[1001,2001,3002]);
 p=edit(p,mon,'target',null,'');assert.deepEqual(totals(view(p)),[0,2001,2001]);
});
test('old scalar and split week goals never seed automatic day goals and remain byte-for-byte intact',()=>{
 for(const g of [{[c.pgoalKey(mon,'week')]:999999},c.psetPart(c.psetPart({},mon,'front',30000),mon,'back',50000)]){
  const before=JSON.stringify(g);assert.deepEqual(totals(view(plan(),g)),[0,0,0]);
  const p=counts(plan(),fri,'10','4');assert.deepEqual(totals(view(p,g)),[0,6000,6000]);assert.equal(JSON.stringify(g),before);
 }
});
test('deleting either part updates aggregates; a deleted draft cannot reveal an older confirmation or legacy daily goal',()=>{
 let p=counts(counts(plan(),mon,'20','10'),fri,'10','4');p=c.dailyGoalConfirm({}, {},p,mon,mon);
 p=edit(p,mon,'u','count','25');const g={['D-'+mon]:{amt:123456}};
 p=c.dailyGoalDelete(p,mon);assert.deepEqual(totals(view(p,g)),[0,6000,6000]);assert.equal(p.confirmed[mon],undefined);assert.equal(p.drafts[mon],undefined);
 p=c.dailyGoalDelete(p,fri);assert.deepEqual(totals(view(p,g)),[0,0,0]);assert.equal(JSON.stringify(c.pvalidate(JSON.parse(JSON.stringify(p)))),JSON.stringify(p));
});
test('confirmation, edits after confirmation and release do not lock aggregate goals to old amounts',()=>{
 let p=counts(plan(),mon,'20','10');p=c.dailyGoalConfirm({}, {},p,mon,mon);assert.deepEqual(totals(view(p)),[13000,0,13000]);
 p=edit(p,mon,'u','price','450');assert.deepEqual(totals(view(p)),[14000,0,14000]);
 p=c.dailyGoalConfirm({}, {},p,mon,mon);assert.deepEqual(totals(view(p)),[14000,0,14000]);
 p=c.dailyRelease(p,mon);assert.deepEqual(totals(view(p)),[0,0,0]);
});
test('clearing either count preserves other input, retyping and explicit zero work in the aggregate view',()=>{
 for(const key of ['u','d']){
  const other=key==='u'?'d':'u';let p=counts(plan(),mon,'20','10');
  p=edit(p,mon,key,'count','');assert.equal(p.drafts[mon][other].count,other==='u'?'20':'10');
  p=edit(p,mon,key,'count','10');assert.equal(p.drafts[mon][other].count,other==='u'?'20':'10');
  p=edit(p,mon,key,'count','0');assert.equal(row(p,mon)[key],0);assert.equal(row(p,mon).target,row(p,mon).revenue);
 }
});
test('holidays exclude their plan, reopening restores it, other dates remain unchanged',()=>{
 let p=counts(counts(plan(),mon,'20','10'),fri,'10','4');p.days[mon]={mode:'off',value:''};assert.deepEqual(totals(view(p)),[0,6000,6000]);
 delete p.days[mon];assert.deepEqual(totals(view(p)),[13000,6000,19000]);
});
test('past day plans stay in the week; live sales, rewards and date rollover do not rewrite monetary goals',()=>{
 let p=counts(counts(plan(),mon,'20','10'),fri,'10','4');p=c.dailyGoalConfirm({}, {},p,mon,mon);
 const before=JSON.stringify(p),v={[mon]:{sets:[{u_cum:1000,u_cnt_cum:2,u_que_cum:9000}]}};
 for(const today of [mon,fri,'2026-11-08','2026-11-09'])assert.deepEqual(totals(view(p,{},v,today)),[13000,6000,19000]);
 assert.equal(JSON.stringify(p),before);
});
test('quest allocation adds to the sales goal while the delivery goal stays separate',()=>{
 let p=counts(plan(),mon,'20','10');p.quests=[{id:'q',start:mon,end:'2026-11-05',count:40,base:9000,extra:1000,adjust:0,aim:'base',finish:'n',status:'n',links:[]}];
 const o=view(p);assert.deepEqual(totals(o),[22000,0,22000]);assert.equal(o.parts[0].deliveryGoal,13000);assert.equal(o.parts[0].forecastRewards,9000);assert.equal(o.plan.rows[0].u,20);
});
test('legacy daily counts and money are read without migrating records; month/year and adjacent weeks stay independent',()=>{
 const p=plan();p.daily={[mon]:{u:{count:20,price:450},d:{count:10,price:500}}};
 const g={['D-'+fri]:{amt:9001},[c.pgoalKey(mon,'month')]:{amt:400000},[c.pgoalKey(mon,'year')]:{amt:5000000}};
 const before=JSON.stringify({p,g});assert.deepEqual(totals(view(p,g)),[14000,9001,23001]);
 assert.deepEqual(totals(view(p,g,{},mon,'2026-11-09')),[0,0,0]);assert.equal(JSON.stringify({p,g}),before);
});
test('week grouping spans month/year boundaries and round-trips drafts, confirmed and legacy fields',()=>{
 let p=counts(counts(plan(),'2026-12-28','20','10'),'2027-01-01','10','4');
 p=c.dailyGoalConfirm({}, {},p,'2026-12-28','2026-12-28');
 p=c.pvalidate(JSON.parse(JSON.stringify(p)));assert.deepEqual(totals(view(p,{}, {},'2027-01-01','2027-01-01')),[13000,6000,19000]);
});
test('legacy daily count plans retain their count basis after confirmation and later price edits',()=>{
 let p=plan();p.daily={[mon]:{u:{count:20,price:400},d:{count:10,price:500}}};
 p=c.dailyGoalConfirm({}, {},p,mon,mon);assert.equal(p.confirmed[mon].basis,'counts');
 p=edit(p,mon,'u','price','450');assert.equal(row(p,mon).target,14000);
});
test('actual progress reduces remaining money/counts without changing the target or counting rewards as deliveries',()=>{
 const p=counts(plan(),mon,'20','10'),v={[mon]:{sets:[{u_cum:15000,u_que_cum:9000}]}};
 let s=c.dailyGoalSummary(v,{},p,mon);assert.equal(s.target,13000);assert.equal(s.remain,0);assert.equal(s.need,0);
 v[mon].sets[0].u_cum=8000;s=c.dailyGoalSummary(v,{},p,mon);assert.equal(s.remain,5000);assert.ok(s.need>0);assert.equal(s.target,13000);
});
test('finalizing sales changes the landing only, with shortfalls and overages isolated to their half',()=>{
 const thu='2026-11-05',sun='2026-11-08';
 let p=counts(counts(counts(plan(),mon,'25','0'),thu,'0','24'),sun,'0','16');
 const v={[mon]:{sets:[{u_cum:8000}]}},before=JSON.stringify(p);
 assert.equal(view(p,{},v).parts[0].landing,22000);
 v[mon].actualConfirmed=true;
 let o=view(p,{},v);
 assert.deepEqual(totals(o),[22000,8000,30000]);
 assert.equal(o.parts[0].landing,20000);assert.equal(o.parts[1].landing,8000);assert.equal(o.week.landing,28000);
 assert.equal(view(p,{},v,thu).week.landing,28000);
 v[mon].sets[0].u_cum=12000;assert.equal(view(p,{},v).week.landing,32000);
 assert.equal(JSON.stringify(p),before);
 p=edit(p,sun,'d','count','10');o=view(p,{},v,sun);
 assert.equal(o.parts[1].landing,5000);assert.equal(o.parts[1].goal,5000);
});
test('landing uses actual rewards plus outstanding quest rewards once and excludes expired estimates',()=>{
 const p=counts(plan(),mon,'25','0');
 p.quests=[{id:'q',start:mon,end:'2026-11-05',count:40,base:6000,extra:0,adjust:0,aim:'base',finish:'n',status:'n',links:[]}];
 const v={[mon]:{actualConfirmed:true,sets:[{u_cum:8000,u_que_cum:2000}]}};
 assert.equal(view(p,{},v).parts[0].landing,14000);
 assert.equal(view(p,{},v,fri).parts[0].landing,10000);
 p.quests[0].status='base';
 assert.equal(view(p,{},v,fri).parts[0].landing,14000);
});
