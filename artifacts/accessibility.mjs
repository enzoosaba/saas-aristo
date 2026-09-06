import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true,channel:'msedge'});
const page = await browser.newPage({viewport:{width:390,height:844}});
const issues=[];
for(const route of ['/','/rotina','/planos','/calendario','/perfil']) {
 await page.goto('http://localhost:3000'+route); await page.waitForLoadState('networkidle');
 const small=await page.locator('.app-shell button, .app-shell a').evaluateAll(els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.width && r.height && getComputedStyle(e).visibility!=='hidden' && !e.classList.contains('skip-link') && (r.width<44 || r.height<44);}).map(e=>({text:e.getAttribute('aria-label')||e.textContent.trim(),w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})));
 if(small.length)issues.push({route,small});
}
await page.goto('http://localhost:3000/rotina');
if(!await page.getByRole('button',{name:'Diminuir Flashcards'}).isDisabled())throw Error('Lower bound not disabled');
await page.goto('http://localhost:3000/planos');
await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Blocked','QuotaExceededError');};});
await page.getByLabel('Prioridades de amanhã',{exact:true}).fill('Preservar este texto');
await page.getByRole('button',{name:'Salvar planejamento'}).click();
await page.locator('.form-feedback[role=alert]').waitFor();
if(await page.getByLabel('Prioridades de amanhã',{exact:true}).inputValue()!=='Preservar este texto')throw Error('Lost draft');
await page.goto('http://localhost:3000/');await page.keyboard.press('Tab');
if(!await page.locator('.skip-link').evaluate(e=>e===document.activeElement))throw Error('Skip link not first');
await page.keyboard.press('Enter');
console.log(JSON.stringify({touchIssues:issues,errorRecovery:'passed',keyboard:'passed',disabled:'passed'}));
await browser.close(); if(issues.length)process.exit(1);
