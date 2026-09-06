import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import lighthouse from 'lighthouse';
import {mkdirSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base=process.env.TEST_BASE_URL||'http://localhost:3100';
const profile=mkdtempSync(join(tmpdir(),'coelho-quality-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,...(process.platform==='win32'?{channel:'msedge'}:{}),args:['--remote-debugging-port=9225'],viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();const violations=[];
try{
 await page.goto(base);await page.getByRole('heading',{name:'Bom ter você aqui.'}).waitFor();
 let result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();violations.push(...result.violations.map(v=>({route:'auth',id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})));
 await context.request.post(base+'/api/auth',{headers:{Origin:base},data:{action:'register',name:'Auditoria Visual',email:`quality-${Date.now()}@example.test`,password:'Teste-Seguro-2026!'}});
 for(const theme of ['dark','light']){for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.goto(base);await page.locator('.app-shell').waitFor();await page.evaluate(t=>{localStorage.setItem('coelho-theme',t);document.documentElement.dataset.theme=t;},theme);for(const route of ['/','/rotina','/planos','/calendario','/perfil']){await page.goto(base+route);await page.locator('.app-shell').waitFor();result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();violations.push(...result.violations.map(v=>({route,theme,width,id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})));}}}
 mkdirSync('test-results',{recursive:true});writeFileSync('test-results/axe.json',JSON.stringify(violations,null,2));
 const report=await lighthouse(base,{port:9225,output:'json',logLevel:'error',onlyCategories:['performance','accessibility','best-practices','seo'],disableStorageReset:true});
 writeFileSync('test-results/lighthouse.json',report.report);
 console.log(JSON.stringify({axeViolations:violations,lighthouse:Object.fromEntries(Object.entries(report.lhr.categories).map(([k,v])=>[k,Math.round(v.score*100)]))},null,2));
if(violations.length)process.exitCode=1;
}finally{await context.close();}
