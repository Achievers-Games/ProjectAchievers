import { sendJson } from '$lib/http';

const WORKER = '/push-sw.js';

const toBytes = (key: string) => {
  const base64 = key.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
};

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const save = (subscription: PushSubscription) => sendJson('/api/push', subscription);

export async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration(WORKER);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** À n'appeler que sur un geste du joueur : le navigateur affiche alors sa demande. */
export async function enablePush(publicKey: string) {
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const registration = await navigator.serviceWorker.register(WORKER);
  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: toBytes(publicKey),
  });
  return Boolean((await save(subscription))?.ok);
}

export async function disablePush() {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await sendJson('/api/push', { endpoint: subscription.endpoint }, 'DELETE');
  await subscription.unsubscribe();
}

/** Après une reconnexion, l'abonnement du navigateur se rattache à la nouvelle session. */
export async function restorePush() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const subscription = await currentSubscription();
  if (subscription) await save(subscription);
}
