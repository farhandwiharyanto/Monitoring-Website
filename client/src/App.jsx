import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { getToken, setToken, api } from "./lib/api.js";
import { AuthCtx } from "./lib/auth.jsx";
import { useI18n } from "./lib/i18n.jsx";
import { setFormatLang } from "./lib/format.js";
import { MonitorsProvider } from "./lib/monitors.jsx";
import Layout from "./components/Layout.jsx";

// Tiap halaman dimuat saat dibuka, bukan sekaligus di awal.
//
// Yang paling diuntungkan justru bukan admin, melainkan status page publik:
// halaman itu dibuka orang luar, sering dari ponsel, justru saat sedang ada
// gangguan — dan sebelumnya ia menarik seluruh aplikasi admin beserta pustaka
// grafiknya hanya untuk menampilkan beberapa baris status.
const Login = lazy(() => import("./pages/Login.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Monitors = lazy(() => import("./pages/Monitors.jsx"));
const MonitorDetail = lazy(() => import("./pages/MonitorDetail.jsx"));
const MonitorForm = lazy(() => import("./pages/MonitorForm.jsx"));
const Notifications = lazy(() => import("./pages/Notifications.jsx"));
const StatusPages = lazy(() => import("./pages/StatusPages.jsx"));
const PublicStatus = lazy(() => import("./pages/PublicStatus.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const Users = lazy(() => import("./pages/Users.jsx"));
const Maintenance = lazy(() => import("./pages/Maintenance.jsx"));
const Audit = lazy(() => import("./pages/Audit.jsx"));
const Reports = lazy(() => import("./pages/Reports.jsx"));
const Databases = lazy(() => import("./pages/Databases.jsx"));
const OnCall = lazy(() => import("./pages/OnCall.jsx"));

export default function App() {
  const { lang, t } = useI18n();
  // Fungsi format dipakai tanpa hook, jadi bahasanya disetel di sini
  setFormatLang(lang);

  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(!!getToken());
  // Status page yang dilayani lewat custom domain (null = bukan custom domain)
  const [domainSlug, setDomainSlug] = useState(undefined);
  const location = useLocation();

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener("pulsewatch:logout", onLogout);
    return () => window.removeEventListener("pulsewatch:logout", onLogout);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api("/auth/me").then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setChecking(false));
  }, []);

  // Domain khusus menampilkan status page-nya langsung di root
  useEffect(() => {
    api("/public/status/resolve", { auth: false })
      .then((r) => setDomainSlug(r.slug || null))
      .catch(() => setDomainSlug(null));
  }, []);

  const logout = () => { setToken(null); setUser(null); };

  // Layar tunggu dipakai ulang untuk pemeriksaan sesi maupun pemuatan halaman,
  // supaya perpindahannya tidak terlihat berbeda bagi pengguna.
  const memuat = <div className="min-h-screen grid place-items-center text-muted">{t("common.loading")}</div>;

  if (location.pathname.startsWith("/status/")) {
    return (
      <Suspense fallback={memuat}>
        <Routes>
          <Route path="/status/:slug" element={<PublicStatus />} />
        </Routes>
      </Suspense>
    );
  }
  if (domainSlug === undefined) return memuat;
  if (domainSlug) return <Suspense fallback={memuat}><PublicStatus slug={domainSlug} /></Suspense>;

  if (checking) return memuat;
  if (!user) return <Suspense fallback={memuat}><Login onLogin={setUser} /></Suspense>;

  const isAdmin = user.role === "admin";
  // Halaman khusus admin: viewer diarahkan kembali ke dashboard
  const AdminOnly = ({ children }) => (isAdmin ? children : <Navigate to="/" replace />);

  return (
    <AuthCtx.Provider value={{ user, isAdmin }}>
      <MonitorsProvider>
        <Layout onLogout={logout}>
          <Suspense fallback={<div className="py-20 grid place-items-center text-muted">{t("common.loading")}</div>}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/monitors" element={<Monitors />} />
            <Route path="/monitors/new" element={<AdminOnly><MonitorForm /></AdminOnly>} />
            <Route path="/monitors/:id" element={<MonitorDetail />} />
            <Route path="/monitors/:id/edit" element={<AdminOnly><MonitorForm /></AdminOnly>} />
            <Route path="/maintenance" element={<Maintenance />} />
            <Route path="/notifications" element={<AdminOnly><Notifications /></AdminOnly>} />
            <Route path="/status-pages" element={<StatusPages />} />
            <Route path="/users" element={<AdminOnly><Users /></AdminOnly>} />
            <Route path="/audit" element={<AdminOnly><Audit /></AdminOnly>} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/databases" element={<Databases />} />
            <Route path="/databases/:id" element={<Databases />} />
            <Route path="/oncall" element={<OnCall />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </Layout>
      </MonitorsProvider>
    </AuthCtx.Provider>
  );
}
