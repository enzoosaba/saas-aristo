import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,channel:'msedge'});
const results=[];
for(const reducedMotion of ['reduce','no-preference']) {
 const p=await browser.newPage({viewport:{width:1440,height:900},reducedMotion});
 await p.addInitScript(()=>{window.motionCount=0;const original=Element.prototype.animate;Element.prototype.animate=function(...args){window.motionCount++;return original.apply(this,args);};});
 await p.goto('http://localhost:3000');await p.waitForLoadState('networkidle');await p.evaluate(()=>scrollTo(0,900));await p.waitForTimeout(450);
 const calls=await p.evaluate(()=>window.motionCount);
 if(reducedMotion==='reduce' && calls!==0)throw Error('Reduced motion ignored');
 if(reducedMotion==='no-preference' && calls===0)throw Error('Reveal animations absent');
 results.push({reducedMotion,animationCalls:calls});await p.close();
}
console.log(JSON.stringify(results));await browser.close();
