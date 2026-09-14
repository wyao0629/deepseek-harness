import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForCommandCatalog} from '../lib/command-catalog.js';
const host=()=>({commandCatalogs:new Map(),commandListeners:new Map()});
test('cold command waits for the authoritative catalog and releases its listener',async()=>{
  const h=host(), c=new AbortController();
  let finished=false;
  const pending=waitForCommandCatalog(h,'s',c.signal).then(()=>{finished=true});
  assert.equal(finished,false);
  h.commandCatalogs.set('s',[]);
  for(const listener of h.commandListeners.get('s')) listener([]);
  await pending;
  assert.equal(finished,true);
  assert.equal(h.commandListeners.get('s').size,0);
});
test('disposing a preset cancels a pending catalog wait and removes its listener',async()=>{
  const h=host(), c=new AbortController();
  const pending=waitForCommandCatalog(h,'s',c.signal);
  const rejected=assert.rejects(pending,/stop/);
  c.abort(new Error('stop'));
  await rejected;
  assert.equal(h.commandListeners.get('s').size,0);
});
