const {defineConfig}=require('@playwright/test');
const base=require('./playwright.config');
module.exports=defineConfig({...base,workers:2,outputDir:'test-results/alignment',reporter:[['list'],['json',{outputFile:'test-results/alignment-results.json'}]],projects:[
 {name:'alignment-chromium',testMatch:['**/text-alignment-wysiwyg.spec.js','**/justify-wysiwyg.spec.js'],use:{browserName:'chromium'}},
 {name:'alignment-firefox',testMatch:['**/text-alignment-wysiwyg.spec.js','**/justify-wysiwyg.spec.js'],use:{browserName:'firefox',launchOptions:{}}}
]});
