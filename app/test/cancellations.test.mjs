import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISMISSED_KEY,
  cancellationGuest,
  dismissCancellation,
  readDismissed,
  visibleCancellations,
} from '../src/lib/cancellations.ts';

/** localStorage minimo en memoria (el modulo no necesita DOM). */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    raw: data,
  };
}

const notice = (id, cancelledAt, extra = {}) => ({
  id,
  propertyId: 'p1',
  propertyName: 'El 47',
  summary: 'Reserved',
  guestName: '',
  checkin: '2027-01-04',
  checkout: '2027-01-10',
  amount: 100,
  cancelledAt,
  ...extra,
});

test('un aviso descartado no vuelve a mostrarse', () => {
  const storage = fakeStorage();
  assert.equal(visibleCancellations([notice(7, 1000)], readDismissed(storage)).length, 1);

  dismissCancellation(storage, 7);
  assert.deepEqual(readDismissed(storage), [7]);
  assert.equal(visibleCancellations([notice(7, 1000)], readDismissed(storage)).length, 0);
});

test('descartar dos veces el mismo aviso no duplica el identificador', () => {
  const storage = fakeStorage();
  dismissCancellation(storage, 3);
  dismissCancellation(storage, 3);
  assert.deepEqual(readDismissed(storage), [3]);
});

test('la misma cancelacion por SSE y por la consulta inicial se pinta una sola vez', () => {
  const lista = [notice(5, 1000), notice(5, 1000), notice(6, 2000)];
  const visibles = visibleCancellations(lista, []);
  assert.deepEqual(visibles.map((n) => n.id), [6, 5]);
});

test('ordena de la cancelacion mas reciente a la mas antigua', () => {
  const visibles = visibleCancellations([notice(1, 100), notice(2, 300), notice(3, 200)], []);
  assert.deepEqual(visibles.map((n) => n.id), [2, 3, 1]);
});

test('un almacenamiento corrupto se trata como lista vacia', () => {
  assert.deepEqual(readDismissed(fakeStorage({ [DISMISSED_KEY]: 'no-es-json' })), []);
  assert.deepEqual(readDismissed(fakeStorage({ [DISMISSED_KEY]: '{"a":1}' })), []);
  assert.deepEqual(readDismissed(fakeStorage({ [DISMISSED_KEY]: '[1,"x",null,2]' })), [1, 2]);
});

test('quien cancela cae al resumen cuando no hay nombre de huesped', () => {
  assert.equal(cancellationGuest(notice(1, 1, { guestName: 'Lisa Buchter' })), 'Lisa Buchter');
  assert.equal(cancellationGuest(notice(1, 1, { guestName: '  ' })), 'Reserved');
});
