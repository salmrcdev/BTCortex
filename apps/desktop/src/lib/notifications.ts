// Windows desktop notifications. Tauri's notification plugin provides the
// standard Notification API in the window and shows notifications through
// Windows; where it is missing (tests, a plain browser) nothing is shown.

export async function notify(title: string, body: string): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  try {
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    new Notification(title, { body });
  } catch {
    // A notification is a courtesy; the alert is on the page either way.
  }
}
