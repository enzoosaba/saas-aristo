import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:3000');await page.waitForLoadState('networkidle');
for(const theme of ['dark','light']) {
 if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('.theme-toggle').click();
 await page.reload();await page.waitForLoadState('networkidle');
 if(await page.locator('html').getAttribute('data-theme')!==theme)throw Error('Theme persistence');
 for(const width of [320,390,768,1100,1440]) {
  await page.setViewportSize({width,height:1000});
  for(const route of ['/','/rotina','/planos','/calendario','/perfil']) {
   await page.goto('http://localhost:3000'+route);await page.waitForLoadState('networkidle');
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error(`Overflow ${theme} ${width} ${route}`);
   if(await page.locator('html').getAttribute('data-theme')!==theme)throw Error('Theme changed on navigation');
   if([390,1440].includes(width)) await page.screenshot({path:`artifacts/${theme}-${width}-${route==='/'?'home':route.slice(1)}.png`,fullPage:true});
  }
 }
}
await page.locator('.theme-toggle').click();await page.reload();await page.waitForLoadState('networkidle');
const styles=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,font:getComputedStyle(document.body).fontFamily,background:getComputedStyle(document.body).backgroundColor}));
await page.getByRole('button',{name:'Recolher menu lateral'}).click();await page.getByRole('button',{name:'Expandir menu lateral'}).click();
await page.locator('.theme-toggle').focus();await page.keyboard.press('Enter');if(await page.locator('html').getAttribute('data-theme')!=='light')throw Error('Keyboard theme toggle');
await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('blocked');};});await page.locator('.theme-toggle').click();if(await page.locator('html').getAttribute('data-theme')!=='dark')throw Error('Blocked storage prevents theme');
console.log(JSON.stringify({themes:2,widths:5,routes:5,overflow:false,persistence:'passed',keyboard:'passed',blockedStorage:'passed',styles,errors}));
await browser.close();if(errors.length)process.exit(1);
