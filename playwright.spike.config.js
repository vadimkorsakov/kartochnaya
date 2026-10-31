const {defineConfig}=require('@playwright/test');
const path=require('node:path');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(__dirname,'.cache/ms-playwright');
module.exports=defineConfig({
 testDir:'./tests/spikes',testMatch:'**/*.spike.js',workers:1,retries:0,forbidOnly:true,
 outputDir:'test-results/spike',reporter:[['list'],['json',{outputFile:'test-results/spike-results.json'}]],
 use:{baseURL:'http://127.0.0.1:4175',viewport:{width:1280,height:900},trace:'retain-on-failure'},
 webServer:{command:'node tests/spikes/server.mjs',url:'http://127.0.0.1:4175/tests/spikes/fixture.html',reuseExistingServer:false},
 projects:[
  {name:'chromium-spike',use:{browserName:'chromium',launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}}},
  {name:'firefox-spike',use:{browserName:'firefox'}},
 ],
});
