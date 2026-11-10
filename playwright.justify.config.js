const {defineConfig}=require('@playwright/test');
const base=require('./playwright.config');
module.exports=defineConfig({...base,workers:2,outputDir:'test-results/justify',reporter:[['list'],['json',{outputFile:'test-results/justify-results.json'}]],projects:[
 {name:'justify-chromium',testMatch:['**/justify-painter.spec.js','**/justify-layout.spec.js'],use:{browserName:'chromium'}},
 {name:'justify-firefox',testMatch:['**/justify-painter.spec.js','**/justify-layout.spec.js'],use:{browserName:'firefox',launchOptions:{}}}
]});
