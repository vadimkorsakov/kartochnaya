const {defineConfig}=require('@playwright/test');
const base=require('./playwright.config');

// A small Firefox suite for both shipped editor bundles; default test:all
// continues to run the same interaction specs in Chromium.
module.exports=defineConfig({
 ...base,
 workers:1,
 outputDir:'test-results/selection',
 reporter:[['list'],['json',{outputFile:'test-results/selection-results.json'}]],
 webServer:[base.webServer,{
  command:'node scripts/netlify-test-server.mjs',
  url:'http://127.0.0.1:4174',reuseExistingServer:false,
 }],
 projects:[
  {name:'firefox-selection',testMatch:'**/selected-text-interaction.spec.js',use:{browserName:'firefox',launchOptions:{}}},
  {name:'firefox-netlify-selection',testMatch:'**/selected-text-interaction.spec.js',use:{browserName:'firefox',baseURL:'http://127.0.0.1:4174',launchOptions:{}}},
 ],
});
