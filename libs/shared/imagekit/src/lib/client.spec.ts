const PRIVATE_KEY = 'private_do_not_leak';

interface FakeClient {
  getAuthenticationParameters: jest.Mock;
  getFileDetails: jest.Mock;
  deleteFile: jest.Mock;
}

// One stable client object whose methods are re-stubbed per test. The module
// memoises the client it builds, so swapping the object itself would leave the
// memoised one in place after the first test.
const fake: FakeClient = {
  getAuthenticationParameters: jest.fn(),
  getFileDetails: jest.fn(),
  deleteFile: jest.fn(),
};

const constructed: unknown[] = [];

jest.mock('imagekit', () =>
  jest.fn().mockImplementation((opts: unknown) => {
    constructed.push(opts);
    return fake;
  })
);

import { deleteFile, getFileById, getUploadAuth, imagekit } from './client.js';

/** Shaped like the SDK's own rejections, which carry $ResponseMetadata. */
function ikError(statusCode: number): Error {
  return Object.assign(new Error(`ImageKit ${statusCode}`), {
    $ResponseMetadata: { statusCode, headers: {} },
  });
}

beforeAll(() => {
  process.env.IMAGEKIT_PUBLIC_KEY = 'public_abc';
  process.env.IMAGEKIT_PRIVATE_KEY = PRIVATE_KEY;
  process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/openshelf';
});

beforeEach(() => {
  fake.getAuthenticationParameters.mockReset();
  fake.getFileDetails.mockReset();
  fake.deleteFile.mockReset();
});

describe('imagekit()', () => {
  it('configures the client from the environment', () => {
    imagekit();
    expect(constructed[0]).toEqual({
      publicKey: 'public_abc',
      privateKey: PRIVATE_KEY,
      urlEndpoint: 'https://ik.imagekit.io/openshelf',
    });
  });

  it('builds the client once and reuses it', () => {
    const before = constructed.length;
    imagekit();
    imagekit();
    expect(constructed.length).toBe(before);
  });
});

describe('getUploadAuth', () => {
  it('returns exactly token, expire and signature', () => {
    fake.getAuthenticationParameters.mockReturnValue({
      token: 'tok',
      expire: 1234,
      signature: 'sig',
    });

    const auth = getUploadAuth();

    expect(Object.keys(auth).sort()).toEqual(['expire', 'signature', 'token']);
    expect(auth).toEqual({ token: 'tok', expire: 1234, signature: 'sig' });
  });

  it('drops any extra field the SDK might add, so nothing widens silently', () => {
    fake.getAuthenticationParameters.mockReturnValue({
      token: 'tok',
      expire: 1234,
      signature: 'sig',
      privateKey: PRIVATE_KEY,
    });

    expect(JSON.stringify(getUploadAuth())).not.toContain(PRIVATE_KEY);
  });
});

describe('getFileById', () => {
  it('returns the file when it exists', async () => {
    fake.getFileDetails.mockResolvedValue({ fileId: 'f1', type: 'file' });
    await expect(getFileById('f1')).resolves.toMatchObject({ fileId: 'f1' });
  });

  it('returns null for a fileId this account cannot see', async () => {
    fake.getFileDetails.mockRejectedValue(ikError(404));
    await expect(getFileById('nope')).resolves.toBeNull();
  });

  it('rethrows anything that is not a 404', async () => {
    fake.getFileDetails.mockRejectedValue(ikError(500));
    await expect(getFileById('f1')).rejects.toThrow('ImageKit 500');
  });
});

describe('deleteFile', () => {
  it('deletes the file', async () => {
    fake.deleteFile.mockResolvedValue(undefined);
    await deleteFile('f1');
    expect(fake.deleteFile).toHaveBeenCalledWith('f1');
  });

  it('treats an already-deleted file as success', async () => {
    fake.deleteFile.mockRejectedValue(ikError(404));
    await expect(deleteFile('gone')).resolves.toBeUndefined();
  });

  it('rethrows anything that is not a 404, so the caller keeps its row', async () => {
    fake.deleteFile.mockRejectedValue(ikError(500));
    await expect(deleteFile('f1')).rejects.toThrow('ImageKit 500');
  });
});
