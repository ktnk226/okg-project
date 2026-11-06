const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Actual entries are reflected automatically; the former explicit apply step is a no-op.
const apply=(v,p)=>p;
const storage=new Map(),c=vm.createContext({localStorage:{getItem:k=>storage.get(k)||null}});for(const f of ['simulation-core.js','daily-planning.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),c);
const fri='2026-11-06',sat='2026-11-07',sun='2026-11-08';
const plan=()=>({...c.pdefault(),calc:{u:400,d:500,uph:3.2,company:'u',share:100}});
const goals=(back=45000,front=0)=>c.psetPart(c.psetPart({},fri,'front',front),fri,'back',back);
const entry=(money,u=0,d=0,reward=0)=>({sets:[{u_cum:money,u_cnt_cum:u,d_cnt_cum:d,u_que_cum:reward}]});
const quest=p=>(p.quests=[{id:'q',start:fri,end:sun,count:100,base:10000,extra:0,adjust:0,aim:'base',finish:'n',status:'n',links:[]}],p);
const result=(p,g=goals(),v={},today=fri)=>c.dailyPlan(v,g,p,fri,today).parts[1];
const row=(p,date,g=goals(),v={},today=fri)=>result(p,g,v,today).rows.find(r=>r.date===date);
const targets=r=>Array.from(r.rows,x=>x.target);
function counts(p,date,u,d,g=goals(),v={},today=fri){p=c.dailyEdit(p,row(p,date,g,v,today),'u','count',u);return c.dailyEdit(p,row(p,date,g,v,today),'d','count',d);}
const confirm=(p,date=fri,g=goals(),v={},today=fri)=>c.dailyConfirm(v,g,p,date,today);
test('45×400=18,000 draft with no automatic fill or feedback; only confirmation changes future and the work screen',()=>{
 let p=counts(plan(),fri,45,0);let r=result(p);assert.deepEqual(targets(r),[18000,15000,15000]);assert.equal(r.rows[0].minutes,844);assert.equal(r.draftPlanned,48000);assert.equal(c.dailySummary({},goals(),p,fri).target,15000);
 const before=JSON.stringify(p);for(let i=0;i<20;i++)assert.deepEqual(targets(result(p)),[18000,15000,15000]);assert.equal(JSON.stringify(p),before);
 p=confirm(p);r=result(p);assert.deepEqual(targets(r),[18000,13500,13500]);assert.equal(c.dailySummary({},goals(),p,fri).target,18000);assert.equal(p.confirmed[fri].u.count,45);
});
test('reconfirmation replaces 18,000 with 20,000, reserves 12,500 each, and never adds records',()=>{
 let p=confirm(counts(plan(),fri,45,0));p=counts(p,fri,50,0);assert.deepEqual(targets(result(p)),[20000,13500,13500]);p=confirm(p);assert.deepEqual(targets(result(p)),[20000,12500,12500]);
 assert.equal(JSON.stringify(confirm(p)),JSON.stringify(p));const v={};c.dailyConfirm(v,goals(),p,fri,fri);assert.deepEqual(v,{});
});
test('confirmed quest counts 45 then 35 reserve final 20, independently from Demaecan',()=>{
 const g=goals(55000);let p=quest(plan());p=confirm(counts(p,fri,45,0,g),fri,g);assert.deepEqual(Array.from(result(p,g).rows,x=>x.quest),[45,28,27]);
 p=confirm(counts(p,sat,35,0,g),sat,g);const r=result(p,g);assert.deepEqual(Array.from(r.rows,x=>x.quest),[45,35,20]);assert.deepEqual(targets(r),[18000,14000,13000]);assert.equal(r.rows[0].u,45);assert.equal(r.rows[1].u,35);
});
test('other confirmed dates remain exact; only unconfirmed future days share residuals',()=>{
 let p=confirm(counts(plan(),sun,20,0),sun);assert.deepEqual(targets(result(p)),[15000,15000,8000]);p=confirm(counts(p,fri,45,0));assert.deepEqual(targets(result(p)),[18000,19000,8000]);assert.equal(result(p).rows[2].u,20);
 p=confirm(counts(p,fri,50,0));assert.deepEqual(targets(result(p)),[20000,17000,8000]);
});
test('confirming Saturday affects later days and leaves earlier automatic Friday at 15,000',()=>{
 const p=confirm(counts(plan(),sat,50,0),sat);assert.deepEqual(targets(result(p)),[15000,20000,10000]);
});
test('entered actual immediately replaces same-day commitment in later days; repeats and day rollover use each actual once',()=>{
 const g=goals(55000);let p=quest(plan());p=confirm(counts(p,fri,45,0,g),fri,g);p=confirm(counts(p,sat,35,0,g),sat,g);
 let v={[fri]:entry(12000,20,100)};let r=result(p,g,v);assert.deepEqual(targets(r),[18000,16500,16500]);assert.equal(r.rows[2].quest,40);assert.equal(c.dailySummary(v,g,p,fri).remain,6000);
 assert.equal(JSON.stringify(result(p,g,v)),JSON.stringify(r));v={[fri]:entry(15000,20,100)};assert.equal(result(p,g,v).rows[2].target,15000);
 v={[fri]:entry(17000,20,100)};r=result(p,g,v,sat);assert.equal(r.rows[1].target,14000);assert.equal(r.rows[2].target,14000);assert.equal(r.rows[2].quest,40);
});
test('edited prices and UPH affect draft target/time immediately but confirmed conditions and Home remain until reconfirmed',()=>{
 let p=confirm(counts(plan(),fri,45,0));p=c.dailyEdit(p,row(p,fri),'u','price',500);p=c.dailyEdit(p,row(p,fri),'u','uph',3.5);assert.equal(row(p,fri).target,22500);assert.equal(row(p,fri).minutes,772);assert.equal(c.dailySummary({},goals(),p,fri).target,18000);
 assert.equal(row(p,sat).conditions.u.price,400);p=confirm(p);assert.equal(c.dailySummary({},goals(),p,fri).target,22500);p.calc.u=600;p.calc.uph=5;assert.equal(row(p,fri).conditions.u.price,500);assert.equal(row(p,fri).conditions.u.uph,3.5);
});
test('money-driven inverse calculation still fills ceil counts and preserves the entered money target',()=>{
 const g=goals(55000);let p=quest(plan());p=c.dailyEdit(p,row(p,fri,g),'target',null,20000);let r=row(p,fri,g);assert.equal(r.target,20000);assert.equal(r.quest,34);assert.equal(r.d,13);assert.equal(r.revenue,20100);
 p=confirm(p,fri,g);assert.deepEqual(targets(result(p,g)),[20000,12500,12500]);assert.equal(row(p,fri,g).u,34);assert.equal(row(p,fri,g).d,13);
});
test('over-budget commitments keep other commitments and nonnegative future needs; impossible quest is explicit',()=>{
 const g=goals(55000);let p=quest(plan());p=confirm(counts(p,fri,150,0,g),fri,g);const r=result(p,g);assert.deepEqual(targets(r),[60000,0,0]);assert.equal(r.targetExcess,15000);assert.equal(r.rows[0].u,150);
 p=quest(plan());for(const d of [fri,sat,sun])p=confirm(counts(p,d,0,0,g),d,g);assert.equal(result(p,g).unallocatedUber,100);assert.equal(result(p,g).shortfall,45000);assert.deepEqual(Array.from(result(p,g).rows,x=>x.u),[0,0,0]);
});
test('holidays exclude confirmed dates without deleting them; release and final-day apply remain bounded',()=>{
 const g=goals(55000);let p=quest(plan());p=confirm(counts(p,fri,45,0,g),fri,g);p=confirm(counts(p,sat,35,0,g),sat,g);const stored=JSON.stringify(p.confirmed[sat]);p.days[sat]={mode:'off',value:''};assert.equal(row(p,sat,g).u,0);assert.equal(row(p,sun,g).quest,55);assert.equal(JSON.stringify(p.confirmed[sat]),stored);
 delete p.days[sat];assert.equal(row(p,sun,g).quest,20);p=c.dailyRelease(p,sat);assert.equal(result(p,g).rows[1].confirmed,null);
 const v={[fri]:entry(8000,20),[sat]:entry(14000,35)};p=confirm(counts(p,sun,45,12,g,v,sun),sun,g,v,sun);const target=row(p,sun,g,v,sun).target;v[sun]=entry(1000,5);p=apply(v,p,sun);assert.equal(c.dailySummary(v,g,p,sun).target,target);assert.equal(result(p,g,v,sun).nextUnallocatedUber,40);
});
test('carryover and reward entry stay derived once with commitments and applied actuals',()=>{
 const g=goals(50000,30000);let p=quest(plan()),v={'2026-11-05':entry(25000)};p=confirm(counts(p,fri,45,0,g,v),fri,g,v);assert.equal(result(p,g,v).carried,5000);assert.deepEqual(targets(result(p,g,v)),[18000,13500,13500]);
 v={...v,[fri]:entry(12000,20,0,10000)};p=apply(v,p,fri);let r=result(p,g,v);assert.equal(r.pendingRewards,0);assert.equal(r.reflected.delivery,33000);assert.equal(c.dailySummary(v,g,p,fri).remain,6000);
 v['2026-11-05']=entry(28000);r=result(p,g,v);assert.equal(r.carried,2000);assert.equal(r.reflected.delivery,30000);assert.equal(r.rows[0].target,18000);
});
test('confirmed and pending conditions round-trip with old fields; malformed additions protect raw storage',()=>{
 let p=confirm(counts(plan(),fri,45,0));p=c.dailyEdit(p,row(p,sat),'u','count',35);p.models[1].uph=3.5;const raw=JSON.stringify(p);storage.set('delivery_log_planning_v15',raw);assert.equal(JSON.stringify(c.pload().data),raw);assert.equal(c.pload().error,'');
 const bad=JSON.parse(raw);bad.confirmed[fri].u.count=3.5;const corrupt=JSON.stringify(bad);storage.set('delivery_log_planning_v15',corrupt);assert.match(c.pload().error,/保護/);assert.equal(storage.get('delivery_log_planning_v15'),corrupt);
 const legacy=plan();storage.set('delivery_log_planning_v15',JSON.stringify(legacy));assert.equal(JSON.stringify(c.pload().data),JSON.stringify(legacy));
});
test('actual reflection and rollover reallocate before a later commitment without changing today target',()=>{
 let p=confirm(counts(plan(),sun,20,0),sun);assert.deepEqual(targets(result(p)),[15000,15000,8000]);
 const v={[fri]:entry(12000,20)};assert.deepEqual(targets(result(p,goals(),v)),[15000,16500,16500]);assert.equal(c.dailySummary(v,goals(),p,fri).target,15000);
 p=confirm(counts(p,sun,25,0,goals(),v),sun,goals(),v);assert.deepEqual(targets(result(p,goals(),v)),[15000,16500,10000]);
 assert.deepEqual(targets(result(p,goals(),{[fri]:entry(13000,20)})),[15000,16000,16000]);
 const next={[fri]:entry(15000,20)};assert.deepEqual(targets(result(p,goals(),next,sat)),[0,15000,15000]);
});
test('zero or empty typed UPH remains unresolved; positive-count plans cannot be confirmed with zero fare',()=>{
 let p=counts(plan(),fri,45,0);p=c.dailyEdit(p,row(p,fri),'u','uph','0');assert.equal(row(p,fri).minutes,null);assert.equal(row(p,fri).remainingMinutes,null);
 p=c.dailyEdit(p,row(p,fri),'u','uph','');assert.equal(row(p,fri).minutes,null);p=c.dailyEdit(p,row(p,fri),'u','price','0');assert.equal(row(p,fri).target,0);assert.throws(()=>confirm(p),/通常単価/);
});
