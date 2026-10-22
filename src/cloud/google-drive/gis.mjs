export const GIS_URL = 'https://accounts.google.com/gsi/client';
let loading;
// Called only by an explicit preparation action, never during editor startup.
export function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2?.initTokenClient) return Promise.resolve(google.accounts.oauth2);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => finish(false), 15000);
    function finish(ok) {
      clearTimeout(timer); script.onload = script.onerror = null;
      if (ok && globalThis.google?.accounts?.oauth2?.initTokenClient) resolve(google.accounts.oauth2);
      else { script.remove(); reject(new Error('gis_unavailable')); }
    }
    script.src = GIS_URL; script.async = true; script.referrerPolicy = 'no-referrer';
    script.onload = () => finish(true); script.onerror = () => finish(false);
    document.head.append(script);
  }).finally(() => { loading = null; });
  return loading;
}
