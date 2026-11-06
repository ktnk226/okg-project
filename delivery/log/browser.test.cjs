// npm install playwright; run a local server first. Tests use fresh isolated storage.
const {chromium,devices}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const url=process.env.DELILOG_TEST_URL||'http://127.0.0.1:8011/delivery/log/';
const output=process.env.DELILOG_TEST_OUTPUT||'/tmp/delilog-carryover-validation';fs.mkdirSync(output,{recursive:true});
const date='2026-11-06',sat='2026-11-07',sun='2026-11-08';
const keys={db:'delivery_log_vault_v13',goals:'delivery_log_periodic_goals_v13',planning:'delivery_log_planning_v15',memos:'delivery_log_inbox_memos_v13',expenses:'delivery_log_expenses_v1'};
async function run(browser,mobile){
 const context=await browser.newContext({...mobile?devices['iPhone 13']:{viewport:{width:1440,height:1000}},locale:'ja-JP',timezoneId:'Asia/Tokyo',acceptDownloads:true});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(15000);
 await page.clock.install({time:new Date('2026-11-06T03:00:00Z')});
 if(process.env.DELILOG_TEST_ASSETS){await page.route('https://cdnjs.cloudflare.com/**',r=>r.fulfill({path:path.join(process.env.DELILOG_TEST_ASSETS,r.request().url().includes('/react-dom/')?'react-dom.js':r.request().url().includes('/react/')?'react.js':'babel.js'),contentType:'text/javascript'}));await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));}
 const storage=()=>page.evaluate(keys=>Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,JSON.parse(localStorage.getItem(v))])),keys);
 const open=()=>page.locator('.sim-open').click();
 const row=d=>page.getByTestId('allocation-'+d);
 const field=(d,key,label)=>page.getByLabel(`${d} ${key} ${label}`,{exact:true});
 const screenshot=async name=>{await page.screenshot({path:path.join(output,(mobile?'iphone-':'pc-')+name+'.png')});};
 await page.goto(url);await page.getByTestId('home-target').waitFor();
 await page.evaluate(({keys,date})=>{
  const p=pdefault();p.calc={u:350,d:500,uph:3.2,company:'u',share:100,strategy:'counts',uCount:120,dCount:10};p.models[1]={name:'通常期',u:350,d:500,uph:3.5};p.quests=[{id:date,start:date,end:'2026-11-08',count:120,base:13000,extra:0,adjust:0,aim:'base',finish:'n',status:'n',links:[]}];
  localStorage.setItem(keys.planning,JSON.stringify(p));localStorage.setItem(keys.goals,JSON.stringify({'W-2026-W45':{amt:90000,front:30000,back:60000,cnt:100},'M-2026-11':{amt:500000},'Y-2026':{amt:6000000}}));
  localStorage.setItem(keys.db,JSON.stringify({'2026-11-05':{sets:[{u_cum:30000}]},'2026-11-01':{dailyMemo:'既存記録',sets:[{u_cum:100000,u_cnt_cum:200}]}}));localStorage.setItem(keys.memos,JSON.stringify([{id:1,date:'2026-11-01',text:'既存メモ',category:'🛵稼働'}]));localStorage.setItem(keys.expenses,JSON.stringify([{id:'e1',date:'2026-11-01',amount:1200,category:'燃料費',payee:'test',memo:'既存経費'}]));localStorage.setItem('delivery_log_current_date_v13',date);
 },{keys,date});
 await page.reload();await page.getByTestId('home-target').waitFor();const original=await storage();
 await open();assert.equal(await page.getByLabel('計画方式',{exact:true}).count(),0);assert.equal(await page.getByLabel('Uber Eatsの計画件数（週合計）',{exact:true}).count(),0);
 for(const d of [date,sat,sun])assert.match(await page.getByTestId(d+'-u-counts').innerText(),/計画 40件/);
 await field(date,'Uber','計画件数（空欄で自動）').fill('45');await field(sat,'Uber','計画件数（空欄で自動）').fill('45');assert.match(await page.getByTestId(sun+'-u-counts').innerText(),/計画 30件/);
 await field(date,'Uber','通常単価（円）').fill('400');await field(date,'Uber','UPH（件/時）').fill('3.5');await field(sat,'Uber','通常単価（円）').fill('300');await field(sat,'Uber','UPH（件/時）').fill('3.2');
 await row(sun).getByRole('button',{name:'この日だけにプリセットを適用',exact:true}).click();assert.equal(await field(date,'Uber','通常単価（円）').inputValue(),'400');assert.equal(await field(sat,'Uber','通常単価（円）').inputValue(),'300');assert.equal(await field(sun,'Uber','UPH（件/時）').inputValue(),'3.5');
 const period=page.getByTestId('daily-period-'+date);assert.match(await period.innerText(),/出前館 16件/);
 for(const d of [date,sat,sun])await field(d,'出前館','通常単価（円）').fill('400');assert.match(await period.innerText(),/出前館 19件/);
 await page.getByRole('group',{name:date+' 不足を補う会社',exact:true}).getByRole('button',{name:/Uber Eats/}).click();assert.match(await period.innerText(),/出前館 0件/);await page.getByRole('group',{name:date+' 不足を補う会社',exact:true}).getByRole('button',{name:/出前館/}).click();
 await page.getByLabel(sat+'の稼働予定',{exact:true}).selectOption('off');assert.match(await page.getByTestId(sun+'-u-counts').innerText(),/計画 75件/);await page.getByLabel(sat+'の稼働予定',{exact:true}).selectOption('auto');assert.equal(await field(sat,'Uber','計画件数（空欄で自動）').inputValue(),'45');assert.match(await page.getByTestId(sun+'-u-counts').innerText(),/計画 30件/);
 await row(date).scrollIntoViewIfNeeded();await screenshot('daily-plan');const beforeActual=await row(date).getByTestId('day-target').innerText();
 await row(date).getByRole('button',{name:'ホームで実績を入力 →',exact:true}).click();
 const uber=page.locator('.platform-block').filter({has:page.locator('.platform-title>span').getByText('Uber Eats',{exact:true})}).first();const demae=page.locator('.platform-block').filter({has:page.locator('.platform-title>span').getByText('出前館',{exact:true})}).first();
 await uber.locator('input').nth(0).fill('2000');await uber.locator('input').nth(1).fill('5');await demae.locator('input').nth(1).fill('50');assert.equal(await page.getByTestId('home-target').innerText(),beforeActual);
 await open();assert.match(await page.getByTestId('quest-remaining-'+date).innerText(),/115件/);assert.match(await page.getByTestId(sun+'-u-counts').innerText(),/計画 30件/);await page.getByRole('button',{name:'ホームへ →',exact:true}).click();
 await page.getByRole('button',{name:'シミュレーションに反映',exact:true}).click();await open();assert.match(await page.getByTestId(sun+'-u-counts').innerText(),/計画 70件/);await page.getByRole('button',{name:'ホームへ →',exact:true}).click();
 await uber.locator('input').nth(0).fill('5000');await uber.locator('input').nth(1).fill('10');await open();assert.match(await page.getByTestId(sun+'-u-counts').innerText(),/計画 70件/);await page.getByRole('button',{name:'ホームへ →',exact:true}).click();await page.getByRole('button',{name:'シミュレーションに反映',exact:true}).click();await page.getByRole('button',{name:'シミュレーションに反映',exact:true}).click();await open();assert.match(await page.getByTestId(sun+'-u-counts').innerText(),/計画 65件/);
 const configured=await storage();assert.deepEqual(configured.db['2026-11-01'],original.db['2026-11-01']);assert.deepEqual(configured.memos,original.memos);assert.deepEqual(configured.expenses,original.expenses);assert.equal(configured.goals['W-2026-W45'].cnt,100);
 // Separate cash example uses empty planning data in this fresh test context.
 await page.evaluate(({keys,date})=>{const p=pdefault();p.calc={u:500,d:500,uph:3.2,company:'u',share:100};localStorage.setItem(keys.planning,JSON.stringify(p));const g=JSON.parse(localStorage.getItem(keys.goals));localStorage.setItem(keys.goals,JSON.stringify(psetPart(psetPart(g,date,'front',0),date,'back',30000)));const v=JSON.parse(localStorage.getItem(keys.db));delete v[date];localStorage.setItem(keys.db,JSON.stringify(v));},{keys,date});
 await page.reload();await page.getByTestId('home-target').waitFor();assert.equal(await page.getByTestId('home-target').innerText(),'10,000円');
 for(const [amount,next] of [['12000','9,000円'],['15000','7,500円'],['8000','11,000円']]){
  await uber.locator('input').nth(0).fill(amount);assert.equal(await page.getByTestId('home-target').innerText(),'10,000円');await page.getByRole('button',{name:'シミュレーションに反映',exact:true}).click();await open();assert.equal(await row(sat).getByTestId('day-target').innerText(),next);assert.equal(await row(sun).getByTestId('day-target').innerText(),next);await page.getByRole('button',{name:'ホームへ →',exact:true}).click();
 }
 assert.match(await page.getByTestId('home-remaining').innerText(),/2,000/);assert.equal(await page.locator('.period-tabs .period-tab').count(),4);await page.locator('.planner-home').scrollIntoViewIfNeeded();await screenshot('home');
 // Carryover and daily delivery-target workflow, using the actual UI for edits/apply.
 await page.evaluate(({keys,date})=>{
  const p=pdefault();p.calc={u:320,d:500,uph:3.2,company:'u',share:100};p.quests=[{id:date,start:date,end:'2026-11-08',count:100,base:10000,extra:0,adjust:0,aim:'base',finish:'n',status:'n',links:[]}];
  localStorage.setItem(keys.planning,JSON.stringify(p));const g=JSON.parse(localStorage.getItem(keys.goals));localStorage.setItem(keys.goals,JSON.stringify(psetPart(psetPart(g,date,'front',30000),date,'back',50000)));
  const v=JSON.parse(localStorage.getItem(keys.db));v['2026-11-05']={sets:[{u_cum:25000,u_cnt_cum:20}]};for(const d of [date,'2026-11-07','2026-11-08'])delete v[d];localStorage.setItem(keys.db,JSON.stringify(v));
 },{keys,date});
 await page.reload();await page.getByTestId('home-target').waitFor();await open();
 assert.equal(await page.getByTestId('back-configured-goal').innerText(),'50,000円');assert.equal(await page.getByTestId('front-carryover').innerText(),'5,000円');assert.equal(await page.getByTestId('back-effective-goal').innerText(),'55,000円');assert.equal(await page.getByTestId('simulation-goal').innerText(),'80,000円');
 await page.getByTestId('daily-period-2026-11-02').getByText('過去の保存済み実績',{exact:true}).click();await page.getByTestId('daily-period-2026-11-02').locator('details p').filter({hasText:'2026-11-05'}).getByRole('button').click();
 if(!await uber.count())await page.locator('.set-header').first().click();await uber.locator('input').nth(0).fill('28000');await open();assert.equal(await page.getByTestId('front-carryover').innerText(),'2,000円');assert.equal(await page.getByTestId('back-effective-goal').innerText(),'52,000円');
 await page.getByTestId('daily-period-2026-11-02').getByText('過去の保存済み実績',{exact:true}).click();await page.getByTestId('daily-period-2026-11-02').locator('details p').filter({hasText:'2026-11-05'}).getByRole('button').click();await uber.locator('input').nth(0).fill('30000');await open();assert.equal(await page.getByTestId('front-carryover').innerText(),'0円');
 await page.getByLabel(date+'の目標金額',{exact:true}).fill('10000');for(const d of [sat,sun])assert.equal(await row(d).getByTestId('day-target').innerText(),'15,000円');
 for(const d of [sat,sun])await page.getByLabel(d+'の目標金額',{exact:true}).fill('20000');assert.match(await page.getByTestId('daily-target-excess-'+date).innerText(),/日別目標の超過額 10,000円/);
 await page.getByLabel(sat+'の稼働予定',{exact:true}).selectOption('off');assert.equal(await row(sat).getByTestId('day-target').innerText(),'休み');await page.getByLabel(sat+'の稼働予定',{exact:true}).selectOption('auto');assert.equal(await page.getByLabel(sat+'の目標金額',{exact:true}).inputValue(),'20000');
 await row(date).getByRole('button',{name:'ホームで実績を入力 →',exact:true}).click();await uber.locator('input').nth(0).fill('6400');await uber.locator('input').nth(1).fill('20');await demae.locator('input').nth(1).fill('100');assert.equal(await page.getByTestId('home-target').innerText(),'10,000円');assert.match(await page.getByTestId('home-remaining').innerText(),/3,600/);
 await page.getByRole('button',{name:'シミュレーションに反映',exact:true}).click();await open();for(const d of [sat,sun])assert.match(await row(d).getByTestId('day-quest').innerText(),/クエスト必須 40件/);
 // Advance the business date without replaying timer ticks or changing saved data.
 await page.clock.setFixedTime(new Date('2026-11-07T03:00:00Z'));await page.reload();await page.getByTestId('home-target').waitFor();await open();await row(sat).getByRole('button',{name:'ホームで実績を入力 →',exact:true}).click();
 await uber.locator('input').nth(0).fill('11200');await uber.locator('input').nth(1).fill('35');await demae.locator('input').nth(1).fill('100');assert.equal(await page.getByTestId('home-target').innerText(),'20,000円');
 await page.getByRole('button',{name:'シミュレーションに反映',exact:true}).click();await page.getByRole('button',{name:'シミュレーションに反映',exact:true}).click();await open();
 assert.match(await row(sun).getByTestId('day-quest').innerText(),/クエスト必須 45件/);assert.match(await row(sun).getByTestId('day-supplement').innerText(),/不足額 5,600円 → 出前館を追加 12件/);assert.equal(await row(sun).getByTestId('day-projection').innerText(),'20,400円');assert.equal(await row(sun).getByTestId('day-target').innerText(),'20,000円');
 await field(sun,'出前館','通常単価（円）').fill('400');assert.match(await row(sun).getByTestId('day-supplement').innerText(),/出前館を追加 14件/);await field(sun,'出前館','通常単価（円）').fill('500');
 await row(sun).scrollIntoViewIfNeeded();await screenshot('carryover-daily-plan');await page.getByRole('button',{name:'ホームへ →',exact:true}).click();
 await uber.locator('input').nth(2).fill('10000');assert.match(await page.getByTestId('home-remaining').innerText(),/8,800/);assert.equal(await page.getByTestId('home-target').innerText(),'20,000円');await page.getByRole('button',{name:'シミュレーションに反映',exact:true}).click();
 const saved=await storage();await page.reload();await page.getByTestId('home-target').waitFor();assert.deepEqual(await storage(),saved);
 await open();const overflow=await page.locator('.daily-editor').evaluate(e=>Array.from(e.querySelectorAll('input,select,button')).filter(x=>x.getBoundingClientRect().width>0&&(x.getBoundingClientRect().right>innerWidth+1||x.getBoundingClientRect().left<0)).map(x=>x.outerHTML.slice(0,100)));assert.deepEqual(overflow,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const settings=()=>page.locator(mobile?'.bottom-nav':'.nav-menu').getByRole('button',{name:mobile?'設定':'⚙️ 設定・同期',exact:true}).click();await settings();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'💾 iCloudへ完全保存',exact:true}).click();const backup=JSON.parse(fs.readFileSync(await (await download).path(),'utf8'));assert.equal(backup.version,16);assert.deepEqual(backup.planning,saved.planning);assert.deepEqual(backup.vault,saved.db);
 // Recover an invalid new field from a complete backup; raw data must survive reload.
 await page.evaluate(k=>localStorage.setItem(k,'{"invalid":true}'),keys.planning);await page.reload();await page.getByRole('alert').getByText(/計画データを読み込めません/).waitFor();await settings();await page.locator('#settingsCloudLoad').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForFunction(k=>JSON.parse(localStorage.getItem(k)).calc?.uph===3.2,keys.planning);assert.deepEqual(await storage(),saved);assert.deepEqual(errors,[]);
 console.log(`PASS ${mobile?'iPhone 13 emulation':'PC'}: daily quotas, 45/45/30, isolated fares/UPH/preset, fill company, live vs applied actuals, repeated snapshots, cash examples, carryover corrections, fixed daily targets, 100 -> 80 -> 45 Uber, 12 extra Demaecan, reward isolation, legacy data, reload and JSON recovery`);
 await context.close();
}
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{await run(browser,false);await run(browser,true);}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
