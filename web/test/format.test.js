import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtBytes, fmtUptime } from '../src/api.js';

test('formate les tailles en unités françaises', () => {
  assert.equal(fmtBytes(null), '—');
  assert.equal(fmtBytes(1024), '1.0 Ko');
  assert.equal(fmtBytes(1024 ** 3), '1.0 Go');
});

test('formate l uptime', () => {
  assert.equal(fmtUptime(65), '1min');
  assert.equal(fmtUptime(3660), '1h 1min');
  assert.equal(fmtUptime(90000), '1j 1h');
});
