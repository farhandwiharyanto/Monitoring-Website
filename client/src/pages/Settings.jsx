import { useState } from "react";
import { api } from "../lib/api.js";
import clsx from "clsx";

export default function Settings() {
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [msg, setMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (f.newPassword !== f.confirm) return setMsg({ ok: false, text: "Konfirmasi password tidak sama" });
    try {
      await api("/auth/change-password", { method: "POST", body: f });
      setMsg({ ok: true, text: "Password berhasil diubah" });
      setF({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-semibold text-white">Pengaturan</h1>
        <p className="text-sm text-muted mt-1">Akun admin</p>
      </div>
      <form onSubmit={submit} className="card p-6 space-y-4">
        <h2 className="font-medium text-white">Ganti password</h2>
        <div><label className="label">Password saat ini</label><input className="input" type="password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} required /></div>
        <div><label className="label">Password baru</label><input className="input" type="password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} required minLength={6} /></div>
        <div><label className="label">Konfirmasi</label><input className="input" type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></div>
        {msg && <p className={clsx("text-sm", msg.ok ? "text-up" : "text-down")}>{msg.text}</p>}
        <button className="btn-primary">Simpan</button>
      </form>
    </div>
  );
}
