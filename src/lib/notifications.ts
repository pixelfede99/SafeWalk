// Notificaciones locales del navegador (no FCM por simplicidad para el capstone).
// Para usar FCM real har&#237;a falta backend (Cloud Functions) que escuche cambios en
// Firestore y env&#237;e push v&#237;a Admin SDK. Ac&#225; usamos la Web Notifications API que
// igual permite alertar al usuario cuando la PWA est&#225; en background.

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined") return "default";
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  return await Notification.requestPermission();
}

export function showLocalNotification(title: string, options?: NotificationOptions): void {
  if (typeof window === "undefined") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  // Si tenemos service worker activo, lo usamos para que persista en background;
  // si no, fallback a Notification directa.
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(title, {
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        ...options
      });
    });
  } else {
    new Notification(title, { icon: "/icons/icon-192.png", ...options });
  }
}
