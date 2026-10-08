import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterGames } from '../web/src/library.js';
test('library search, region and recent sorting compose', () => {
  const games = [{name:'Zelda.iso',region:'USA',added:1},{name:'Mario.iso',region:'Japan',added:3},{name:'Mario Sunshine.iso',region:'USA',added:2}];
  assert.deepEqual(filterGames(games,'mario','USA','title').map(g=>g.name),['Mario Sunshine.iso']);
  assert.deepEqual(filterGames(games,'','all','recent').map(g=>g.added),[3,2,1]);
  assert.equal(games[0].name,'Zelda.iso');
});
