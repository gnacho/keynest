import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAirbnbSyncUnresolved } from '../src/lib/reservation-status.ts';

test('pending and missing are unresolved Airbnb sync states', () => {
  assert.equal(isAirbnbSyncUnresolved('pending'), true);
  assert.equal(isAirbnbSyncUnresolved('missing'), true);
});

test('matched and empty values are resolved Airbnb sync states', () => {
  assert.equal(isAirbnbSyncUnresolved('matched'), false);
  assert.equal(isAirbnbSyncUnresolved(''), false);
  assert.equal(isAirbnbSyncUnresolved(null), false);
  assert.equal(isAirbnbSyncUnresolved(undefined), false);
});
