const {chromium,devices}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const url=process.env.DELILOG_TEST_URL||'http://127.0.0.1:8060/delivery/log/';
const fri='2026-11-06';

async function verify(page,mobile){
  await page.clock.install({time:new Date('2026-11-06T03:00:00Z')});
  if(process.env.DELILOG_TEST_ASSETS){
    await page.route('https://cdnjs.cloudflare.com/**',r=>r.fulfill({path:path.join(process.env.DELILOG_TEST_ASSETS,r.request().url().includes('/react-dom/')?'react-dom.js':r.request().url().includes('/react/')?'react.js':'babel.js'),contentType:'text/javascript'}));
    await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  }
  await page.goto(url);await page.getByTestId('home-target').waitFor();
  await page.evaluate(fri=>{
    const p=pdefault();p.calc={u:400,d:500,uph:3.2,company:'u',share:100};
    localStorage.setItem('delivery_log_planning_v15',JSON.stringify(p));
    localStorage.setItem('delivery_log_periodic_goals_v13',JSON.stringify(psetPart(psetPart({},fri,'front',0),fri,'back',39000)));
    localStorage.setItem('delivery_log_current_date_v13',fri);
  },fri);
  await page.reload();await page.locator('.sim-open').click();
  const input=key=>page.getByRole('spinbutton',{name:fri+' '+(key==='u'?'Uber':'出前館')+' 計画件数（空欄で自動）',exact:true});
  for(const cleared of ['d','u']){
    const kept=cleared==='u'?'d':'u';
    for(const keep of ['20','0']){
      await input(kept).fill(keep);await input(cleared).fill('10');
      await input(cleared).fill('');
      assert.equal(await input(cleared).inputValue(),'');assert.equal(await input(kept).inputValue(),keep);
      // Persist the intermediate empty state, then type the replacement digit by digit.
      await page.reload();await page.locator('.sim-open').click();
      assert.equal(await input(cleared).inputValue(),'');assert.equal(await input(kept).inputValue(),keep);
      await input(cleared).pressSequentially('1');assert.equal(await input(kept).inputValue(),keep);
      await input(cleared).pressSequentially('0');assert.equal(await input(cleared).inputValue(),'10');assert.equal(await input(kept).inputValue(),keep);
      await input(cleared).fill('0');assert.equal(await input(cleared).inputValue(),'0');assert.equal(await input(kept).inputValue(),keep);
    }
  }
  // Export/restore a mixed manual/automatic draft using the actual settings UI.
  await input('u').fill('20');await input('d').fill('10');await input('d').fill('');
  await page.getByRole('button',{name:'稼働へ →',exact:true}).click();
  await page.locator(mobile?'.bottom-nav':'.nav-menu').getByRole('button',{name:mobile?'設定':'⚙️ 設定・同期',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'💾 iCloudへ完全保存',exact:true}).click();
  const backup=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.equal(backup.version,16);assert.equal(backup.planning.drafts[fri].u.count,'20');assert.equal(backup.planning.drafts[fri].d.count,'');
  const restored=page.waitForEvent('dialog',d=>d.message().includes('バックアップから復元しました'));
  await page.locator('#settingsCloudLoad').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await restored;
  await page.reload();await page.locator('.sim-open').click();assert.equal(await input('u').inputValue(),'20');assert.equal(await input('d').inputValue(),'');

  // Cumulative counts across all four platforms must become per-set differences.
  await page.evaluate(fri=>{
    const set=(start,end,u,d,r,m)=>({...EMPTY_SET(),start,end,u_cnt_cum:u,d_cnt_cum:d,r_cnt_cum:r,m_cnt_cum:m,u_cum:800,open:true});
    const sets=[set('10:00','10:40',1,1,0,0),set('11:00','11:30',2,1,1,1),set('12:00','12:00',2,1,1,1),set('13:00','',2,1,1,1),set('14:00','14:40',2,1,1,1),set('23:40','00:20',3,2,1,1)];
    localStorage.setItem('delivery_log_vault_v13',JSON.stringify({[fri]:{sets}}));
  },fri);
  await page.reload();await page.getByTestId('set-uph').first().waitFor();
  assert.deepEqual(await page.getByTestId('set-uph').allTextContents(),['UPH 3.0件/h','UPH 6.0件/h','UPH —','UPH —','UPH 0.0件/h','UPH 3.0件/h']);
  const first=page.locator('.set-card').first(),header=first.locator('.set-header');
  assert.match(await header.innerText(),/時給 1,200円/);
  assert.equal(await first.getByTestId('set-uph').evaluate(el=>el.getBoundingClientRect().top===el.previousElementSibling.getBoundingClientRect().top),true);
  await first.locator('input[type=time]').nth(1).fill('11:20');assert.equal(await first.getByTestId('set-uph').innerText(),'UPH 1.5件/h');
  await header.click();assert.equal(await first.getByTestId('set-uph').innerText(),'UPH 1.5件/h');await header.click();
  await first.locator('input[type=time]').nth(1).fill('10:40');
  await page.getByRole('button',{name:'＋ 次のセットを追加',exact:true}).click();assert.equal(await page.getByTestId('set-uph').last().innerText(),'UPH —');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const dir=process.env.DELILOG_SCREENSHOTS||'/tmp/delilog-input-uph';fs.mkdirSync(dir,{recursive:true});
  await header.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,(mobile?'iphone':'pc')+'-uph.png')});
  await page.reload();await page.getByTestId('set-uph').first().waitFor();assert.equal(await page.getByTestId('set-uph').first().innerText(),'UPH 3.0件/h');
}

(async()=>{
  const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
  try{for(const mobile of [false,true]){
    const context=await browser.newContext({...mobile?devices['iPhone 13']:{viewport:{width:1440,height:1000}},timezoneId:'Asia/Tokyo',acceptDownloads:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept().catch(()=>{}));
    try{await verify(page,mobile);assert.deepEqual(errors,[]);console.log('PASS '+(mobile?'iPhone emulation':'PC')+': clear/retype both counts, zero, reload, v16 backup/restore; per-set UPH, cumulative differences, zero/unknown duration, zero deliveries, midnight, live edits and layout');}
    finally{await context.close();}
  }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
