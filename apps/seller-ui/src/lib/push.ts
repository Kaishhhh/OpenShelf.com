'use client';

import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { registerPushToken, removePushToken } from './api';

/**
 * Firebase web config. Every value here is public by design — it identifies the project to
 * the browser SDK and grants nothing on its own — which is why it can be NEXT_PUBLIC_ and
 * passed to the service worker in its URL.
 */
const config: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

/** The token this browser last registered, so logout can unregister it. */
const TOKEN_KEY = 'openshelf:fcm-token';

export type PushState = 'unsupported' | 'unconfigured' | 'default' | 'granted' | 'denied';

function configured(): boolean {
  return Boolean(
    VAPID_KEY && config.apiKey && config.projectId && config.messagingSenderId && config.appId
  );
}

export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  if (!(await isSupported().catch(() => false))) {
    return 'unsupported';
  }
  if (!configured()) {
    return 'unconfigured';
  }
  // Permission alone is not "on": push only works once this browser's token is registered
  // with the account. Permission granted without a registered token (a failed or
  // not-yet-run registration) reads as 'default', so the button is offered again — and
  // clicking it registers without prompting, since permission is already granted.
  if (Notification.permission === 'granted' && !storedToken()) {
    return 'default';
  }
  return Notification.permission;
}

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function serviceWorkerUrl(): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(config)) {
    if (value) params.set(key, String(value));
  }
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

/**
 * Gets this browser's FCM token and registers it with the logged-in account.
 *
 * Called on an explicit click (to ask permission), and silently on load when permission
 * was already granted — tokens rotate, and a browser that switched accounts must move its
 * token to the account now logged in (the server takes it from the previous one).
 */
async function syncToken(): Promise<void> {
  // At the site root, so it controls the whole origin — required for FCM's scope.
  const registration = await navigator.serviceWorker.register(serviceWorkerUrl(), { scope: '/' });
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const token = await getToken(getMessaging(app), {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) {
    return;
  }
  await registerPushToken(token);
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Without storage, logout cannot unregister this token; FCM pruning still will.
  }
}

/** Asks for permission, then registers. Resolves with the resulting state. */
export async function enablePush(): Promise<PushState> {
  const state = await pushState();
  if (state === 'unsupported' || state === 'unconfigured' || state === 'denied') {
    return state;
  }
  const permission = state === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') {
    return permission;
  }
  await syncToken();
  return 'granted';
}

/** Re-registers without prompting, only if permission is already granted. Never throws. */
export async function resyncPushIfGranted(): Promise<void> {
  try {
    const state = await pushState();
    // 'default' here can mean granted-but-unregistered (see pushState), so check the
    // permission itself: never prompt from a background resync.
    if (state !== 'unsupported' && state !== 'unconfigured' && Notification.permission === 'granted') {
      await syncToken();
    }
  } catch (err) {
    console.warn('[push] could not refresh the push token', err);
  }
}

/** Unregisters this browser from the current account, before logging out. Never throws. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      await removePushToken(token);
    }
  } catch {
    // Best effort: the session is ending either way.
  }
}
