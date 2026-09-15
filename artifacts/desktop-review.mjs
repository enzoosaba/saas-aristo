import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
const base='http://localhost:3105';const browser=await chromium.launch({headless:true,channel:'msedge'});const ctx=await browser.newContext({reducedMotion:'reduce'});const page=await ctx.newPage();
try {
await ctx.request.post(base+'/api/auth',{headers:{Origin:base},data:{action:'register',name:'Revisão Desktop',email:`desktop-${Date.now()}@example.test`,password:'Teste-Seguro-2026!'}});
const s=await (await ctx.request.get(base+'/api/study')).json();const date=new Date(s.today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+1);
await ctx.request.post(base+'/api/study',{headers:{Origin:base},data:{action:'save-plan',date:date.toISOString().slice(0,10),prioridades:'Revisar funções e resolver exercícios de geometria.',horarios:'Das 14h às 16h',observacoes:'',version:0}});
for(const theme of ['dark','light'])for(const width of [1024,1440,1920]) {
 await page.setViewportSize({width,height:960});await page.goto(base);await page.locator('.app-shell').waitFor();await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 await page.getByText('Revisar funções e resolver exercícios de geometria.',{exact:true}).waitFor();
 for(const view of ['Hoje','Desempenho','Metas']) {
 await page.locator('.home-view-switch').getByRole('button',{name:view,exact:true}).click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${theme} ${width} ${view}`);
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
 if(width===1440)await page.screenshot({path:`test-results/responsive/desktop-final-${theme}-${view}.png`,fullPage:true});
 }
}
console.log('18 desktop/theme/view checks passed; next-day plan visible; no axe violations or page overflow.');
}finally{await browser.close();}
