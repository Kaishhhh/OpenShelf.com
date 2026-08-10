import { redis } from './redis.js';

describe('redis', () => {
  it('should work', () => {
    expect(redis()).toEqual('redis');
  });
});
