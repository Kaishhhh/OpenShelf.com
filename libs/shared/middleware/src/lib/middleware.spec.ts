import { middleware } from './middleware.js';

describe('middleware', () => {
  it('should work', () => {
    expect(middleware()).toEqual('middleware');
  });
});
