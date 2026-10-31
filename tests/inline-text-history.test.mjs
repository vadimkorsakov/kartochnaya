import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInlineHistory, recordInlineHistory, moveInlineHistory } from '../src/model/inline-text-history.mjs';

test('format previews settle once, undo restores the full layer, new typing truncates redo', () => {
 const layer={text:'Я😀',fontSize:12,textRunsBaseFontSize:24,autoFontSize:true};
 const history=createInlineHistory(layer),caret={start:1,end:3,direction:'forward'};
 const formatted={...layer,fontSize:10,textRuns:[{start:1,end:3,style:{fontSize:48}}]};
 recordInlineHistory(history,formatted,caret);
 recordInlineHistory(history,formatted,caret);
 assert.equal(history.states.length,2);
 assert.deepEqual(moveInlineHistory(history,-1).element,layer);
 assert.deepEqual(moveInlineHistory(history,1),{element:formatted,caret});
 formatted.textRuns[0].style.fontSize=100;
 assert.equal(history.states[1].element.textRuns[0].style.fontSize,48);
 moveInlineHistory(history,-1);
 recordInlineHistory(history,{...layer,text:'Я'},caret);
 assert.equal(moveInlineHistory(history,1),null);
 assert.deepEqual(history.states[0].element,layer);
});
