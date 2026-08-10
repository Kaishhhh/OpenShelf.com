import { prisma } from './prisma.js';

describe('prisma', () => {
  it('should work', () => {
    expect(prisma()).toEqual('prisma');
  });
});
