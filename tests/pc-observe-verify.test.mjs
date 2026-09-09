import test from 'node:test';
import assert from 'node:assert/strict';
import { isPcTaskTraceVerified } from '../lib/tool-core.mjs';
const step=(tool,result={ok:true,state:'completed'})=>({tool,result});
test('planner cannot claim completion without tool evidence',()=>{
 assert.equal(isPcTaskTraceVerified([]),false);
 assert.equal(isPcTaskTraceVerified([step('pc_browser_open')]),false);
 assert.equal(isPcTaskTraceVerified([step('pc_browser_open',{ok:true,state:'queued'})]),false);
 assert.equal(isPcTaskTraceVerified([step('pc_browser_open',{ok:true,state:'completed',result:{ok:false,verified:false}})]),false);
});
test('observe-action-verify trace and natively verified actions',()=>{
 assert.equal(isPcTaskTraceVerified([step('pc_window_list'),step('pc_window_focus'),step('pc_ui_tree')]),true);
 assert.equal(isPcTaskTraceVerified([step('pc_browser_open',{ok:true,state:'completed',result:{ok:true,verified:true}})]),true);
 assert.equal(isPcTaskTraceVerified([step('pc_ui_tree'),step('pc_ui_click_text',{ok:false,state:'failed'}),step('pc_ui_tree')]),false);
});
