const {defineConfig}=require('@playwright/test');
const base=require('./playwright.spike.config');
module.exports=defineConfig({...base,testDir:'./tests/experiments',testMatch:'**/range-stroke.spec.js',
 outputDir:'test-results/stroke-experiment',reporter:[['list'],['json',{outputFile:'test-results/stroke-experiment.json'}]]});
