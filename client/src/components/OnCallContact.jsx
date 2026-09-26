import { useEffect, useState } from "react";
import { Siren, Check } from "lucide-react";
import { api } from "../lib/api.js";
import { useI18n } from "../lib/i18n.jsx";

// Kontak pribadi untuk dipanggil saat sedang bertugas. Bisa disetel sendiri
// oleh siapa pun yang login; daftar pilihannya tidak memuat config notifikasi.
export default function OnCallContact() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { api("/oncall/my-contact").then(setData).catch(() => {}); }, []);
  if (!data) return null;

  const change = async (value) => {
    setError("");
    try {
      const res = await api("/oncall/my-contact", { method: "PUT", body: { notification_id: value || null } });
      setData({ ...data, notification_id: res.notification_id });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) { setError(err.message); }
  };

  return (
    <section className="card p-6 space-y-3">
      <h2 className="font-medium text-fg flex items-center gap-2"><Siren size={16} className="text-accent" /> {t("users.oncallContact")}</h2>
      <p className="text-sm text-muted">{t("users.oncallContactHint")}</p>
      {data.options.length === 0 ? (
        <p className="text-sm text-muted">{t("settings.noContactOptions")}</p>
      ) : (
        <div className="flex items-center gap-2">
          <select className="input max-w-xs" value={data.notification_id ?? ""} onChange={(e) => change(e.target.value)}>
            <option value="">{t("users.noOncallContact")}</option>
            {data.options.map((n) => <option key={n.id} value={n.id}>{n.name} ({n.type})</option>)}
          </select>
          {saved && <Check size={16} className="text-up" />}
        </div>
      )}
      {error && <p className="text-sm text-down">{error}</p>}
    </section>
  );
}
