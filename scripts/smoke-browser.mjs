// Local Chrome-only smoke. No remote browser or provider network requests.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
const origin='http://localhost:8787';
const output=path.resolve(process.argv[2]??'../shots');
await mkdir(output,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking']});
const checks=[],errors=[];
try {
 const page=await browser.newPage();await page.setRequestInterception(true);
 page.on('request',r=>{if(new URL(r.url()).origin===origin || ['data:','about:'].includes(new URL(r.url()).protocol))void r.continue();else {errors.push(`External request blocked: ${new URL(r.url()).origin}`);void r.abort()}});
 page.on('pageerror',e=>errors.push(String(e)));
 await page.setViewport({width:1280,height:900,deviceScaleFactor:1});await page.goto(origin,{waitUntil:'networkidle0'});await page.waitForSelector('.card');
 assert.equal(await page.$$eval('.card',cards=>cards.length),11);checks.push('11 demo cards render');
 await page.screenshot({path:path.join(output,'demo-desktop-1280x900.png')});
 await page.click('.filters button:nth-child(2)');assert.equal(await page.$$eval('.card',cards=>cards.length),6);checks.push('attention filter shows six attention states');
 await page.click('.filters button:first-child');
 await page.click('[aria-label="Switch to English"]');assert.equal(await page.$eval('h1',el=>el.textContent),'Every allowance, in view.');await page.reload({waitUntil:'networkidle0'});assert.equal(await page.$eval('html',el=>el.lang),'en');checks.push('English toggle persists');
 await page.click('[aria-label="Switch to light"]');await page.reload({waitUntil:'networkidle0'});assert.equal(await page.$eval('html',el=>el.dataset.theme),'light');checks.push('light theme persists');
 await page.click('.intro-actions .primary');await page.waitForSelector('dialog[open]');assert.equal(await page.$eval('input[type=password]',el=>el.autocomplete),'new-password');await page.type('input[type=password]','SYNTHETIC_BROWSER_ONLY');
 await page.click('dialog .full');await page.waitForSelector('dialog .alert');assert.equal(await page.$eval('input[type=password]',el=>el.value),'');assert.match(await page.$eval('dialog .alert',el=>el.textContent),/Demo mode/);checks.push('demo key test rejected and input cleared');
 await page.keyboard.press('Escape');assert.equal(await page.$('dialog'),null);checks.push('Escape closes dialog');
 await page.click('.card:first-child .card-actions button');await page.waitForSelector('dialog.drawer[open]');assert.equal(await page.$$eval('fieldset',els=>els.length),3);checks.push('manual drawer and extension paste input render');await page.keyboard.press('Escape');
 await page.click('[aria-label="切换中文"]');await page.click('[aria-label="切换深色"]');
 await page.setViewport({width:390,height:844,deviceScaleFactor:1});await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.card');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.equal(await page.$eval('.grid',el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);checks.push('390px single column without horizontal overflow');
 await page.screenshot({path:path.join(output,'demo-mobile-390x844.png')});
 assert.deepEqual(errors,[]);checks.push('no page errors or external page requests');
 await writeFile(path.join(output,'browser-smoke.json'),JSON.stringify({checks,errors},null,2)+'\n');console.log(checks.join('\n'));
}finally {await browser.close()}
