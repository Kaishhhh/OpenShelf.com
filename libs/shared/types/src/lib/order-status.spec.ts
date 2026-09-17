import {
  ORDER_STATUSES,
  canTransition,
  isTerminal,
  legalSourcesFor,
  nextStatuses,
  type OrderStatus,
} from './order-status.js';

const LEGAL: [OrderStatus, OrderStatus][] = [
  ['PAID', 'SHIPPED'],
  ['PAID', 'CANCELLED'],
  ['SHIPPED', 'DELIVERED'],
];

describe('order status machine', () => {
  it.each(LEGAL)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  // Every pair not in LEGAL, including staying put and every backwards move.
  const illegal = ORDER_STATUSES.flatMap((from) =>
    ORDER_STATUSES.map((to) => [from, to] as [OrderStatus, OrderStatus])
  ).filter(([from, to]) => !LEGAL.some(([f, t]) => f === from && t === to));

  it.each(illegal)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('cannot move a delivered order back to shipped', () => {
    expect(canTransition('DELIVERED', 'SHIPPED')).toBe(false);
  });

  it('treats DELIVERED and CANCELLED as terminal', () => {
    expect(isTerminal('DELIVERED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('PAID')).toBe(false);
    expect(nextStatuses('CANCELLED')).toEqual([]);
  });

  it('cannot skip shipping', () => {
    expect(canTransition('PAID', 'DELIVERED')).toBe(false);
    expect(legalSourcesFor('DELIVERED')).toEqual(['SHIPPED']);
  });

  it('lists the legal sources for each target', () => {
    expect(legalSourcesFor('SHIPPED')).toEqual(['PAID']);
    expect(legalSourcesFor('CANCELLED')).toEqual(['PAID']);
    expect(legalSourcesFor('PAID')).toEqual([]);
  });
});
