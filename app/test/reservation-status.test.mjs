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

// --- Aviso accionable de solicitud (#345) --------------------------------
import { pendingRequestNotice } from '../src/lib/reservation-status.ts';

const futuro = new Date('2030-01-10T12:00:00');
const pasado = new Date('2020-01-10T12:00:00');
const ahora = new Date('2026-11-05T12:00:00').getTime();

test('an upcoming request shows the actionable notice', () => {
  assert.equal(pendingRequestNotice({ checkOut: futuro, airbnbStatus: 'request' }, ahora), true);
  assert.equal(pendingRequestNotice({ checkOut: futuro, airbnbStatus: 'pending' }, ahora), true);
  assert.equal(pendingRequestNotice({ checkOut: futuro, airbnbStatus: 'REQUEST' }, ahora), true);
});

test('a confirmed reservation does not show it', () => {
  assert.equal(pendingRequestNotice({ checkOut: futuro, airbnbStatus: 'upcoming' }, ahora), false);
  assert.equal(pendingRequestNotice({ checkOut: futuro, airbnbStatus: 'complete' }, ahora), false);
  assert.equal(pendingRequestNotice({ checkOut: futuro }, ahora), false);
});

test('a request under cancellation or already past does not show it', () => {
  assert.equal(pendingRequestNotice({ checkOut: futuro, airbnbStatus: 'request', airbnbCancellationStatus: 'PENDING' }, ahora), false);
  assert.equal(pendingRequestNotice({ checkOut: pasado, airbnbStatus: 'request' }, ahora), false);
});
