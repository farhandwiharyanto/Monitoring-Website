const TOKEN_KEY = "pulsewatch_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && getToken()) headers.Authorization = `Bearer ${getToken()}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && auth) {
    setToken(null);
    window.dispatchEvent(new Event("pulsewatch:logout"));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request gagal (${res.status})`);
  return data;
}

// Unduh berkas dari endpoint ber-auth: fetch dulu (agar header Authorization
// terkirim), baru dijadikan blob dan disimpan lewat <a download>.
export async function download(path) {
  const res = await fetch(`/api${path}`, { headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request gagal (${res.status})`);
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match ? match[1] : "pulsewatch-export";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Beri jeda agar unduhan sempat dimulai sebelum URL dilepas
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
