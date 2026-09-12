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

import {
  canonicalFileUrl,
  deleteFile,
  getFileById,
  getUploadAuth,
  imagekit,
} from './client.js';

/**
 * Shaped like the SDK's real rejections, which matter in two ways that an
 * Error-based fake would hide: they are plain objects rather than Errors, and
 * a fileId ImageKit will not parse comes back as 400, not 404.
 *
 *   malformed id     -> 400 "Your request contains invalid fileId parameter."
 *   well-formed, absent -> 404 "The requested file does not exist."
 */
function ikError(statusCode: number, message = `ImageKit ${statusCode}`) {
  return { message, help: 'contact support', $ResponseMetadata: { statusCode, headers: {} } };
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
  it('returns exactly publicKey, token, expire and signature', () => {
    fake.getAuthenticationParameters.mockReturnValue({
      token: 'tok',
      expire: 1234,
      signature: 'sig',
    });

    const auth = getUploadAuth();

    expect(Object.keys(auth).sort()).toEqual([
      'expire',
      'publicKey',
      'signature',
      'token',
    ]);
    expect(auth).toEqual({
      publicKey: 'public_abc',
      token: 'tok',
      expire: 1234,
      signature: 'sig',
    });
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

  it('returns null for a well-formed id naming nothing (404)', async () => {
    fake.getFileDetails.mockRejectedValue(
      ikError(404, 'The requested file does not exist.')
    );
    await expect(getFileById('000000000000000000000000')).resolves.toBeNull();
  });

  // The case that produced a 500 in the field: ImageKit rejects an id it
  // cannot parse with 400, not 404.
  it('returns null for a malformed id (400)', async () => {
    fake.getFileDetails.mockRejectedValue(
      ikError(400, 'Your request contains invalid fileId parameter.')
    );
    await expect(getFileById('forgedfileid00')).resolves.toBeNull();
  });

  it('rethrows a genuine failure as a real Error', async () => {
    fake.getFileDetails.mockRejectedValue(ikError(500, 'Internal error'));
    const err = await getFileById('f1').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('500');
    expect(err.message).toContain('Internal error');
  });
});

describe('deleteFile', () => {
  it('deletes the file', async () => {
    fake.deleteFile.mockResolvedValue(undefined);
    await deleteFile('f1');
    expect(fake.deleteFile).toHaveBeenCalledWith('f1');
  });

  it('treats an already-deleted file as success', async () => {
    fake.deleteFile.mockRejectedValue(
      ikError(404, 'The requested file does not exist.')
    );
    await expect(deleteFile('gone')).resolves.toBeUndefined();
  });

  // A row holding an id ImageKit will not parse could never be cleared if this
  // threw, since the row is only removed after a successful remote delete.
  it('treats a malformed id as success rather than stranding the row', async () => {
    fake.deleteFile.mockRejectedValue(
      ikError(400, 'Your request contains invalid fileId parameter.')
    );
    await expect(deleteFile('bogus')).resolves.toBeUndefined();
  });

  it('rethrows a genuine failure, so the caller keeps its row', async () => {
    fake.deleteFile.mockRejectedValue(ikError(500, 'Internal error'));
    const err = await deleteFile('f1').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('500');
  });
});

describe('canonicalFileUrl', () => {
  const BASE = 'https://ik.imagekit.io/openshelf/folder/mug_AbC123.png';

  it('leaves an upload-response url unchanged', () => {
    expect(canonicalFileUrl(BASE)).toBe(BASE);
  });

  // The mismatch that rejected legitimate uploads: getFileDetails returns the
  // same file with a cache-buster appended.
  it('strips the ?updatedAt cache-buster getFileDetails appends', () => {
    expect(canonicalFileUrl(`${BASE}?updatedAt=1788184520647`)).toBe(BASE);
  });

  it('makes the upload and details forms of one file compare equal', () => {
    expect(canonicalFileUrl(`${BASE}?updatedAt=1788184520647`)).toBe(
      canonicalFileUrl(BASE)
    );
  });

  it('strips a transformation query too', () => {
    expect(canonicalFileUrl(`${BASE}?tr=e-bgremove`)).toBe(BASE);
  });

  // Normalising must not make different files look the same.
  it('still distinguishes a different host', () => {
    expect(canonicalFileUrl(BASE)).not.toBe(
      canonicalFileUrl('https://evil.example.com/folder/mug_AbC123.png')
    );
  });

  it('still distinguishes a different path', () => {
    expect(canonicalFileUrl(BASE)).not.toBe(
      canonicalFileUrl('https://ik.imagekit.io/openshelf/folder/other.png')
    );
  });

  it('still distinguishes a different imagekit account', () => {
    expect(canonicalFileUrl(BASE)).not.toBe(
      canonicalFileUrl('https://ik.imagekit.io/someoneelse/folder/mug_AbC123.png')
    );
  });

  it('returns null for something that is not a url', () => {
    expect(canonicalFileUrl('not-a-url')).toBeNull();
    expect(canonicalFileUrl('')).toBeNull();
  });
});
