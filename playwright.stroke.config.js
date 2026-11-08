const {defineConfig}=require('@playwright/test');
const base=require('./playwright.config');
module.exports=defineConfig({...base,workers:1,timeout:90000,outputDir:'test-results/stroke',
 reporter:[['list'],['json',{outputFile:'test-results/stroke-results.json'}]],projects:[
 {name:'stroke-chromium',testMatch:'**/range-stroke.spec.js',testIgnore:'**/experiments/**',use:{browserName:'chromium'}},
 {name:'stroke-firefox',testMatch:'**/range-stroke.spec.js',testIgnore:'**/experiments/**',use:{browserName:'firefox',launchOptions:{}}}
 ]});
