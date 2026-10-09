import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createButtonSource} from '../app/src/button-source.js';

test('brief keyboard presses remain published for the controller polling window', async () => {
  let pressed;
  const source = createButtonSource(value => { pressed = value; }, () => 40);
  source.down('KeyX', 'A'); source.up('KeyX');
  assert(pressed.has('A'), 'keyup must not erase a tap before the guest can poll it');
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(pressed.size, 0);
});

test('physical keys own aliases independently and reset cancels pending releases', async () => {
  let pressed;
  const source = createButtonSource(value => { pressed = value; }, () => 40);
  source.down('KeyX', 'A'); source.down('KeyU', 'A'); source.up('KeyX');
  await new Promise(resolve => setTimeout(resolve, 70));
  assert(pressed.has('A'), 'releasing one alias must preserve the other');
  source.up('KeyU'); source.down('KeyX', 'A'); source.up('KeyX');
  source.reset(); assert.equal(pressed.size, 0);
  source.down('KeyZ', 'B');
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.deepEqual([...pressed], ['B']);
  source.reset();
});
