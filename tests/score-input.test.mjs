import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScoreInput } from '../score-axis.js';
test('score shorthand preserves decimal scaling and scientific notation', () => {
  for (const [input, expected] of [['1k',1000],['1w',10000],['1.1m',1100000],['1.23k',1230],['1.001k',1001],['1e2',100],['1E+2',100],['2.5e-1',.25],['.5 W',5000],[' 1.2M ',1200000],['0',0],['1234.5',1234.5]]) assert.equal(parseScoreInput(input),expected,input);
});
test('malformed, overflow and underflow inputs never become a blank or valid zero', () => {
  for (const input of ['', ' ', '1e', '1e309', '1e-999', '0x10', 'Infinity', 'NaN', '1kw', '1+2', 'k', '1,23']) assert.ok(Number.isNaN(parseScoreInput(input)),input);
});
