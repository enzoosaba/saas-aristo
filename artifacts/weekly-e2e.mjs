import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const base=process.env.TEST_BASE_URL||'http://localhost:3101';
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
const ctx=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});const page=await ctx.newPage();
const post=data=>ctx.request.post(base+'/api/study',{headers:{Origin:base},data});
const state=async()=> (await ctx.request.get(base+'/api/study')).json();
try {
 await ctx.request.post(base+'/api/auth',{headers:{Origin:base},data:{action:'register',name:'Aluno Semanal',email:`week-${Date.now()}@example.test`,password:'Teste-Seguro-2026!'}});
 await page.goto(base+'/planos');await page.getByRole('button',{name:'Nova sessão',exact:true}).click();
 await page.getByLabel('Nome da sessão',{exact:true}).fill('Revisão de funções');await page.getByLabel('Início da sessão').fill('09:00');await page.getByLabel('Duração em minutos').fill('60');await page.getByRole('button',{name:'Salvar sessão',exact:true}).click();
 await page.getByText('Sessão salva no planejamento semanal.',{exact:true}).waitFor();let s=await state();let session=s.sessions[0];assert.equal(session.title,'Revisão de funções');await page.reload();await page.getByRole('button',{name:/Editar sessão Revisão de funções/}).waitFor();
 assert.equal((await post({action:'save-session',session:{...session,id:crypto.randomUUID(),version:0,start:'09:30'}})).status(),409);
 assert.equal((await post({action:'save-session',session:{...session,version:0}})).status(),409);
 assert.equal((await post({action:'save-session',session:{...session,start:'23:30',duration:60}})).status(),400);
 const other=await browser.newContext();await other.request.post(base+'/api/auth',{headers:{Origin:base},data:{action:'register',name:'Outro Aluno',email:`other-week-${Date.now()}@example.test`,password:'Teste-Seguro-2026!'}});assert.equal((await other.request.post(base+'/api/study',{headers:{Origin:base},data:{action:'delete-session',id:session.id,version:session.version}})).status(),404);await other.close();
 await page.getByRole('button',{name:/Editar sessão Revisão de funções/}).click();await page.getByLabel('Duração em minutos').fill('90');await page.getByRole('button',{name:'Salvar sessão',exact:true}).click();await page.getByText('Sessão salva no planejamento semanal.',{exact:true}).waitFor();session=(await state()).sessions[0];assert.equal(session.duration,90);
 const target=page.locator('.week-day').filter({has:page.locator('header')}).last();const date=await target.getAttribute('aria-label');const dropDate=date.slice(-10);if(dropDate!==session.date){await page.getByRole('button',{name:/Editar sessão Revisão de funções/}).dragTo(target);await page.getByText('Sessão movida para o dia escolhido.').waitFor();assert.equal((await state()).sessions[0].date,dropDate);}
 mkdirSync('test-results/weekly',{recursive:true});
 for(const theme of ['dark','light'])for(const width of [360,390,768,1024,1440]){await page.setViewportSize({width,height:960});await page.reload();await page.locator('.weekly-planner').waitFor();await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow ${theme} ${width}`);if(width<768){await page.locator('.week-day-picker button').last().click();}const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[],`${theme} ${width}`);await page.screenshot({path:`test-results/weekly/${theme}-${width}.png`,fullPage:true});}
 await page.getByRole('button',{name:/Editar sessão Revisão de funções/}).click();await page.getByRole('button',{name:'Excluir sessão',exact:true}).click();await page.getByRole('button',{name:'Confirmar exclusão',exact:true}).click();await page.getByText('Sessão removida.',{exact:true}).waitFor();assert.equal((await state()).sessions.length,0);
 console.log('Weekly planner: creation, reload, edit, drag, overlap, invalid time, ownership, delete and 10 responsive/accessibility checks passed.');
}finally{await browser.close();}
