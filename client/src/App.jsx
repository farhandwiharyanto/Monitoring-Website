import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { getToken, setToken, api } from "./lib/api.js";
import { AuthCtx } from "./lib/auth.jsx";
import { MonitorsProvider } from "./lib/monitors.jsx";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Monitors from "./pages/Monitors.jsx";
import MonitorDetail from "./pages/MonitorDetail.jsx";
import MonitorForm from "./pages/MonitorForm.jsx";
import Notifications from "./pages/Notifications.jsx";
import StatusPages from "./pages/StatusPages.jsx";
import PublicStatus from "./pages/PublicStatus.jsx";
import Settings from "./pages/Settings.jsx";
import Users from "./pages/Users.jsx";
import Maintenance from "./pages/Maintenance.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(!!getToken());
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

  const logout = () => { setToken(null); setUser(null); };

  if (location.pathname.startsWith("/status/")) {
    return (
      <Routes>
        <Route path="/status/:slug" element={<PublicStatus />} />
      </Routes>
    );
  }
  if (checking) return <div className="min-h-screen grid place-items-center text-muted">Memuat…</div>;
  if (!user) return <Login onLogin={setUser} />;

  const isAdmin = user.role === "admin";
  // Halaman khusus admin: viewer diarahkan kembali ke dashboard
  const AdminOnly = ({ children }) => (isAdmin ? children : <Navigate to="/" replace />);

  return (
    <AuthCtx.Provider value={{ user, isAdmin }}>
      <MonitorsProvider>
        <Layout onLogout={logout}>
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
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </MonitorsProvider>
    </AuthCtx.Provider>
  );
}
