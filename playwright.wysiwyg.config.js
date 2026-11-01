const {defineConfig}=require('@playwright/test');
const base=require('./playwright.config');
module.exports=defineConfig({...base,workers:1,outputDir:'test-results/wysiwyg-firefox',reporter:[['list']],projects:[{name:'firefox-wysiwyg',testMatch:'**/inline-wysiwyg.spec.js',grep:/opt-in input|UTF-16 emoji|unsupported formatting|unconfirmed DOM|range color|backward range|plain compatible|plain first range color|plain first font|plain typing formatting|Arial legacy-top|Arial ordinary|old unmarked|plain native metrics/,use:{browserName:'firefox',launchOptions:{}}}]});
