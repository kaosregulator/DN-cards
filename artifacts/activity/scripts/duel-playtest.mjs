// Headless duel playtest: loads the demo board with both fields populated,
// advances to the Battle Phase, declares an attack, and asserts LP changed
// with no console errors. Run against a `vite preview` server:
//   OUT_DIR=/tmp node scripts/duel-playtest.mjs
import { chromium } from 'playwright-core';
const EXE=process.env.CHROME_PATH||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const S=process.env.OUT_DIR||'.';
const browser=await chromium.launch({executablePath:EXE,args:['--no-sandbox','--use-gl=swiftshader']});
const page=await browser.newPage({viewport:{width:960,height:760}});
const errors=[];
page.on('console',m=>{ if(m.type()==='error') errors.push(m.text()); });
page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
const BASE=process.env.BASE_URL||'http://localhost:5199';
await page.goto(BASE+'/?demo=duel&demoField',{waitUntil:'load'});
await page.waitForTimeout(3500);
// Inspect the duel scene state.
const info=await page.evaluate(()=>{
  const g=window.__duelGame; if(!g) return {err:'no __duelGame'};
  const s=g.scene.getScene('Duel'); if(!s||!s.state) return {err:'no duel state'};
  return { phase:s.state.phase, turn:s.state.turn,
    pMons:s.state.player.monsters.map(m=>m?m.position:null),
    oMons:s.state.opponent.monsters.map(m=>m?m.position:null) };
});
console.log('STATE', JSON.stringify(info));
await page.screenshot({path:S+'/pt_1_field.png'});
// Advance MP1 -> Battle Phase, then attack foe zone 0 with our zone 0.
await page.evaluate(async()=>{
  const s=window.__duelGame.scene.getScene('Duel');
  await s.doAction({k:'phase'});           // MP1 -> BP
});
await page.waitForTimeout(600);
const ph=await page.evaluate(()=>window.__duelGame.scene.getScene('Duel').state.phase);
console.log('PHASE_AFTER', ph);
// Fire the attack and grab a mid-lunge frame.
page.evaluate(()=>{ const s=window.__duelGame.scene.getScene('Duel'); s.doAction({k:'attack',fromZone:0,target:0}); });
await page.waitForTimeout(180);
await page.screenshot({path:S+'/pt_2_attack.png'});
await page.waitForTimeout(1200);
await page.screenshot({path:S+'/pt_3_after.png'});
const after=await page.evaluate(()=>{ const s=window.__duelGame.scene.getScene('Duel'); return {pLp:s.state.player.lp,oLp:s.state.opponent.lp,phase:s.state.phase}; });
console.log('AFTER', JSON.stringify(after));
console.log('ERRORS', errors.length, JSON.stringify(errors.slice(0,8)));
await browser.close();
if(errors.length){ console.error('FAIL: console errors'); process.exit(1); }
if(after.oLp>=8000 && after.pLp>=8000){ console.error('FAIL: battle changed no LP'); process.exit(1); }
console.log('PLAYTEST OK');
