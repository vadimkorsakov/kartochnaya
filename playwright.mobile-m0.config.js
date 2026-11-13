// Explicit research suite; never part of the production bundle or default tests.
const {defineConfig}=require('@playwright/test');
const base=require('./playwright.config');
module.exports=defineConfig({...base,testDir:'./tests/mobile-wysiwyg-m0',testMatch:'**/*.experiment.js',workers:1,
 outputDir:'work/mobile-m0/artifacts',reporter:[['list'],['json',{outputFile:'work/mobile-m0/results.json'}]],
 projects:[{name:'chromium-m0',use:{browserName:'chromium'}}],
 use:{...base.use,hasTouch:true,isMobile:true,serviceWorkers:'block'}});
