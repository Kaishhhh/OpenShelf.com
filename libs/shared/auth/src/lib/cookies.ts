import { CookieOptions, Response } from 'express';

export function cookieFlags(): Omit<CookieOptions, 'maxAge'> {
  return {
    httpOnly: true,
    secure: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    path: '/',
  };
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token', cookieFlags());
  res.clearCookie('refresh_token', cookieFlags());
}
