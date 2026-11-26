/** Only browser-operated push services may receive scheduled notifications. */
export function approvedPushEndpoint(value) {
  if (typeof value !== "string" || value.length > 4096 || /[\s\\]/.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.pathname === "/"
  ) {
    return null;
  }
  const host = url.hostname;
  const allowed =
    host === "fcm.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    host.endsWith(".push.apple.com") ||
    host.endsWith(".notify.windows.com");
  return allowed ? url.href : null;
}
