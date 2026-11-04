// Run against an isolated local server; all storage belongs to fresh test contexts.
const {chromium,devices}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const url=process.env.DELILOG_TEST_URL||'http://127.0.0.1:8000/delivery/log/';
const output=process.env.DELILOG_TEST_OUTPUT||'/tmp/delilog-validation';
const date='2026-11-06';
const keys={db:'delivery_log_vault_v13',goals:'delivery_log_periodic_goals_v13',planning:'delivery_log_planning_v15',memos:'delivery_log_inbox_memos_v13',expenses:'delivery_log_expenses_v1'};
fs.mkdirSync(output,{recursive:true});
async function run(browser,mobile){
 const context=await browser.newContext({...mobile?devices['iPhone 13']:{viewport:{width:1440,height:1000}},timezoneId:'Asia/Tokyo',locale:'ja-JP',acceptDownloads:true});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.clock.install({time:new Date('2026-11-06T03:00:00Z')});
 if(process.env.DELILOG_TEST_ASSETS){await page.route('https://cdnjs.cloudflare.com/**',r=>r.fulfill({path:path.join(process.env.DELILOG_TEST_ASSETS,r.request().url().includes('/react-dom/')?'react-dom.js':r.request().url().includes('/react/')?'react.js':'babel.js'),contentType:'text/javascript'}));await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));}
 await page.goto(url);await page.getByTestId('home-target').waitFor();
 await page.evaluate(({keys,date})=>{
  const entry=n=>({weather:'晴',dailyMemo:'既存の記録',condition:4,sleepHours:7,sets:[{u_cum:n,u_cnt_cum:n/500,open:true}]});
  const planning=pdefault();delete planning.weekly;delete planning.horizons;planning.calc={u:500,d:600,uph:4,company:'u',share:100};
  localStorage.setItem(keys.db,JSON.stringify({'2026-01-01':entry(2000),'2026-10-31':entry(1000),'2026-11-01':entry(100000)}));
  localStorage.setItem(keys.goals,JSON.stringify({'W-2026-W45':{amt:30000,cnt:100},'M-2026-11':{amt:500000,cnt:1000},'Y-2026':{amt:6000000},'D-2026-10-31':{amt:12000,cnt:20}}));
  localStorage.setItem(keys.planning,JSON.stringify(planning));
  localStorage.setItem(keys.memos,JSON.stringify([{id:1,date:'2026-10-31',text:'既存メモ',category:'🛵稼働'}]));
  localStorage.setItem(keys.expenses,JSON.stringify([{id:'expense1',date:'2026-10-31',amount:1200,category:'燃料費',payee:'テスト',memo:'既存経費'}]));
  localStorage.setItem('delivery_log_current_date_v13',date);
 },{keys,date});
 await page.reload();await page.getByTestId('home-target').waitFor();
 assert.equal(await page.getByTestId('home-target').innerText(),'10,000円');
 const initialStorage=await page.evaluate(keys=>Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,JSON.parse(localStorage.getItem(v))])),keys);
 assert.equal(initialStorage.planning.horizons,undefined,'legacy planning is not rewritten on load');
 await page.locator('.sim-open').click();assert.equal(await page.getByRole('tab').count(),3);assert.equal(await page.getByRole('tab',{name:'週 日別の配分'}).getAttribute('aria-selected'),'true');
 assert.equal(await page.getByText('目標管理',{exact:true}).count(),0);assert.equal(await page.getByText('逆算',{exact:true}).count(),0);
 await page.getByLabel(date+'の稼働予定',{exact:true}).selectOption('amt');await page.getByLabel(date+'の指定値',{exact:true}).fill('8000');
 assert.match(await page.getByTestId('allocation-2026-11-07').innerText(),/11,000円/);assert.match(await page.getByTestId('allocation-2026-11-08').innerText(),/11,000円/);
 await page.getByLabel('2026-11-07の稼働予定',{exact:true}).selectOption('off');assert.equal(await page.getByTestId('allocation-2026-11-07').getByTestId('day-target').innerText(),'休み');assert.match(await page.getByTestId('allocation-2026-11-08').innerText(),/22,000円/);
 await page.getByLabel('2026-11-07の稼働予定',{exact:true}).selectOption('auto');
 await page.getByTestId('allocation-'+date).getByRole('button',{name:'ホームで実績を入力 →',exact:true}).click();
 const uber=page.locator('.platform-block').filter({has:page.locator('.platform-title>span').getByText('Uber Eats',{exact:true})}).first();
 await uber.locator('input').nth(0).fill('2000');await uber.locator('input').nth(1).fill('4');
 assert.equal(await page.getByTestId('home-target').innerText(),'8,000円');assert.match(await page.getByTestId('home-remaining').innerText(),/6,000/);assert.equal(await page.getByTestId('home-count').innerText(),'12件');assert.equal(await page.getByTestId('home-time').innerText(),'3時間0分');
 assert.equal(await page.locator('.period-tabs .period-tab').count(),4);assert.equal(await page.getByLabel(date+'の指定値',{exact:true}).count(),0);
 await page.locator('.main-content').evaluate(e=>e.scrollTop=0);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,(mobile?'iphone':'pc')+'-home.png')});
 await page.locator('.sim-open').click();const weekSettings=await page.evaluate(keys=>({days:JSON.parse(localStorage.getItem(keys.planning)).days,week:JSON.parse(localStorage.getItem(keys.goals))['W-2026-W45']}),keys);
 await page.getByRole('tab',{name:'月 月の見通し'}).click();assert.equal(await page.getByTestId('simulation-actual').innerText(),'102,000円');await page.getByTestId('simulation-goal').fill('450000');await page.getByLabel('残りの想定稼働日数（空欄は残り全日）',{exact:true}).fill('20');await page.getByLabel('今後1稼働日あたりの追加売上（円）',{exact:true}).fill('20000');assert.equal(await page.getByTestId('horizon-required').innerText(),'17,400円');assert.equal(await page.getByTestId('horizon-projection').innerText(),'502,000円');
 await page.locator('.main-content').evaluate(e=>e.scrollTop=0);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,(mobile?'iphone':'pc')+'-month.png')});
 await page.getByRole('tab',{name:'年 年の見通し'}).click();assert.equal(await page.getByTestId('simulation-actual').innerText(),'105,000円');await page.getByTestId('simulation-goal').fill('5500000');await page.getByLabel('残りの想定稼働日数（空欄は残り全日）',{exact:true}).fill('40');await page.getByLabel('今後1稼働日あたりの追加売上（円）',{exact:true}).fill('25000');
 assert.deepEqual(await page.evaluate(keys=>({days:JSON.parse(localStorage.getItem(keys.planning)).days,week:JSON.parse(localStorage.getItem(keys.goals))['W-2026-W45']}),keys),weekSettings);
 await page.getByRole('tab',{name:'週 日別の配分'}).click();assert.match(await page.getByTestId('allocation-2026-11-07').innerText(),/11,000円/);
 await page.getByRole('button',{name:'後半（金〜日）のクエストを追加',exact:true}).click();const q=page.locator('.sim-quest');await q.getByLabel('基本の対象回数',{exact:true}).selectOption('10');await q.getByLabel('基本達成報酬（円）',{exact:true}).fill('2000');
 assert.match(await q.innerText(),/対象実績 4件/);await page.getByLabel('クエスト見込みを週の必要売上から差し引く',{exact:true}).check();assert.match(await page.getByTestId('allocation-2026-11-07').innerText(),/10,000円/);
 await page.getByRole('button',{name:'ホームへ →',exact:true}).click();const d=page.locator('.platform-block').filter({has:page.locator('.platform-title>span').getByText('出前館',{exact:true})}).first();await d.locator('input').nth(1).fill('50');await uber.locator('input').nth(2).fill('2000');
 await page.locator('.sim-open').click();assert.match(await q.innerText(),/対象実績 4件/);assert.match(await q.innerText(),/未入力の報酬見込み\s*0円/);assert.equal(await page.getByTestId('simulation-actual').innerText(),'4,000円');
 const overflows=await page.locator('.simulation').evaluate(e=>Array.from(e.querySelectorAll('input,select,button')).filter(x=>x.getBoundingClientRect().width>0&&(x.getBoundingClientRect().right>innerWidth+1||x.getBoundingClientRect().left<0)).map(x=>x.outerHTML.slice(0,160)));assert.deepEqual(overflows,[],'controls fit viewport');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(mobile){const nav=page.locator('.bottom-nav');assert.equal(await nav.getByRole('button').count(),6);assert.equal(await nav.getByRole('button',{name:mobile?'売上シミュレーション':'🧮 売上シミュレーション'}).getAttribute('aria-current'),'page');}
 await page.locator('.main-content').evaluate(e=>e.scrollTop=0);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,(mobile?'iphone':'pc')+'-week.png')});
 await page.getByTestId('allocation-'+date).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,(mobile?'iphone':'pc')+'-allocation.png')});
 const saved=await page.evaluate(keys=>Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,JSON.parse(localStorage.getItem(v))])),keys);await page.reload();await page.getByTestId('home-target').waitFor();
 assert.deepEqual(await page.evaluate(keys=>Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,JSON.parse(localStorage.getItem(v))])),keys),saved);
 assert.deepEqual(saved.memos,initialStorage.memos);assert.deepEqual(saved.expenses,initialStorage.expenses);assert.deepEqual(saved.db['2026-11-01'],initialStorage.db['2026-11-01']);assert.deepEqual(saved.goals['D-2026-10-31'],initialStorage.goals['D-2026-10-31']);assert.equal(saved.goals['W-2026-W45'].cnt,100);
 const settings=page.locator(mobile?'.bottom-nav':'.nav-menu').getByRole('button',{name:mobile?'設定':'⚙️ 設定・同期',exact:true});await settings.click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'💾 iCloudへ完全保存',exact:true}).click();const file=await download;const backup=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert.equal(backup.version,16);assert.deepEqual(backup.planning,saved.planning);assert.deepEqual(backup.vault,saved.db);
 // Restore through the real file picker after changing the goal.
 await page.locator(mobile?'.bottom-nav':'.nav-menu').getByRole('button',{name:mobile?'売上シミュレーション':'🧮 売上シミュレーション',exact:true}).click();await page.getByTestId('simulation-goal').fill('99999');await settings.click();
 await page.locator('#settingsCloudLoad').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForFunction(([key,expected])=>JSON.parse(localStorage.getItem(key))['W-2026-W45'].amt===expected,[keys.goals,30000]);
 const restored=await page.evaluate(keys=>Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,JSON.parse(localStorage.getItem(v))])),keys);assert.deepEqual(restored,saved);
 const oldBackup={vault:backup.vault,periodicGoals:backup.periodicGoals,memos:backup.memos,version:13};
 await page.locator('#settingsCloudLoad').setInputFiles({name:'old-v13.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(oldBackup))});
 await page.waitForTimeout(50);assert.deepEqual(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),keys.planning),saved.planning);assert.deepEqual(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),keys.expenses),saved.expenses);
 await page.evaluate(k=>localStorage.setItem(k,'{\"invalid\":true}'),keys.planning);await page.reload();await page.getByRole('alert').getByText(/計画データを読み込めません/).waitFor();
 assert.equal(await page.evaluate(k=>localStorage.getItem(k),keys.planning),'{\"invalid\":true}');await settings.click();
 await page.locator('#settingsCloudLoad').setInputFiles({name:'recover-v16.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
 await page.waitForFunction(([key,expected])=>JSON.parse(localStorage.getItem(key)).calc?.u===expected,[keys.planning,500]);assert.deepEqual(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),keys.planning),saved.planning);assert.deepEqual(errors,[]);
 console.log(`PASS ${mobile?'iPhone 13 emulation':'PC'}: migration, allocation, actuals/home sync, independent horizons, quest accounting, viewport, reload, JSON backup/restore`);
 await context.close();
}
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{await run(browser,false);await run(browser,true);}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
