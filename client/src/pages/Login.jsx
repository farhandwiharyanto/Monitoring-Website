import { useState } from "react";
import { Activity } from "lucide-react";
import { api, setToken } from "../lib/api.js";
import { reconnectWithToken } from "../lib/socket.js";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { token, user } = await api("/auth/login", { method: "POST", body: { username, password }, auth: false });
      setToken(token);
      reconnectWithToken();
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-4 bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.08),transparent_60%)]">
      <form onSubmit={submit} className="card w-full max-w-sm p-8 space-y-5">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-xl bg-accent/15 grid place-items-center"><Activity className="text-accent" /></span>
          <div>
            <h1 className="text-lg font-semibold text-white">Pulsewatch</h1>
            <p className="text-xs text-muted">Masuk ke dashboard admin</p>
          </div>
        </div>
        <div>
          <label className="label">Username</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="text-sm text-down">{error}</p>}
        <button className="btn-primary w-full justify-center" disabled={busy}>{busy ? "Memproses…" : "Masuk"}</button>
      </form>
    </div>
  );
}
