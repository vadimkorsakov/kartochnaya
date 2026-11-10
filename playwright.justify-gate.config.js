const {defineConfig}=require('@playwright/test');
const base=require('./playwright.config');
module.exports=defineConfig({...base,webServer:undefined,testIgnore:[],workers:1,outputDir:'test-results/justify-gate',reporter:[['list'],['json',{outputFile:'test-results/justify-gate-results.json'}]],projects:[
 {name:'gate-chromium',testMatch:'**/justify-caret-gate.spec.js',use:{browserName:'chromium'}},
 {name:'gate-firefox',testMatch:'**/justify-caret-gate.spec.js',use:{browserName:'firefox',launchOptions:{}}}
]});
