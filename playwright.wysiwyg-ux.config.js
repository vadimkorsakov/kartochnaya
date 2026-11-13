const {defineConfig}=require('@playwright/test');
const base=require('./playwright.config');
module.exports=defineConfig({...base,use:{...base.use,trace:'on'},workers:1,outputDir:'test-results/wysiwyg-ux',reporter:[['list'],['json',{outputFile:'test-results/wysiwyg-ux-results.json'}]],projects:[
 {name:'ux-chromium',testMatch:['**/wysiwyg-selection.spec.js','**/wysiwyg-performance.spec.js'],use:{browserName:'chromium'}},
 {name:'ux-firefox',testMatch:['**/wysiwyg-selection.spec.js','**/wysiwyg-performance.spec.js'],use:{browserName:'firefox',launchOptions:{}}}
]});
