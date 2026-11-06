const {defineConfig}=require('@playwright/test');
const base=require('./playwright.config');
module.exports=defineConfig({...base,workers:2,timeout:90000,outputDir:'test-results/multiline',reporter:[['list'],['json',{outputFile:'test-results/multiline-results.json'}]],projects:[
 {name:'multiline-chromium',testMatch:'**/multiline-wysiwyg.spec.js',use:{browserName:'chromium',launchOptions:{...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})}}},
 {name:'multiline-firefox',testMatch:'**/multiline-wysiwyg.spec.js',use:{browserName:'firefox',launchOptions:{}}}
]});
