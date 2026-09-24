import { NavLink, Link } from "react-router-dom";
import { Activity, LayoutDashboard, Bell, Globe, Settings, LogOut, Plus, Wifi, WifiOff, List, Wrench, Users, ShieldCheck, Eye, ScrollText } from "lucide-react";
import clsx from "clsx";
import { useMonitors } from "../lib/monitors.jsx";
import { useAuth } from "../lib/auth.jsx";
import { useI18n } from "../lib/i18n.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

const nav = [
  { to: "/", key: "nav.dashboard", icon: LayoutDashboard, end: true },
  { to: "/monitors", key: "nav.monitors", icon: List },
  { to: "/maintenance", key: "nav.maintenance", icon: Wrench },
  { to: "/notifications", key: "nav.notifications", icon: Bell, admin: true },
  { to: "/status-pages", key: "nav.statusPages", icon: Globe },
  { to: "/users", key: "nav.users", icon: Users, admin: true },
  { to: "/audit", key: "nav.audit", icon: ScrollText, admin: true },
  { to: "/settings", key: "nav.settings", icon: Settings },
];

export default function Layout({ children, onLogout }) {
  const { connected, stats } = useMonitors();
  const { user, isAdmin } = useAuth();
  const { t } = useI18n();
  const items = nav.filter((n) => !n.admin || isAdmin);
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-border bg-panel/60 backdrop-blur hidden md:flex flex-col">
        <Link to="/" className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
          <span className="h-8 w-8 rounded-lg bg-accent/15 grid place-items-center">
            <Activity size={18} className="text-accent" />
          </span>
          <span className="font-semibold tracking-tight text-fg">Pulsewatch</span>
        </Link>
        <nav className="p-3 space-y-1 flex-1">
          {items.map(({ to, key, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive ? "bg-accent/10 text-accent" : "text-fg3 hover:text-fg hover:bg-panel2"
                )
              }
            >
              <Icon size={17} /> {t(key)}
            </NavLink>
          ))}
          {isAdmin && (
            <Link to="/monitors/new" className="btn-primary w-full justify-center mt-4">
              <Plus size={16} /> {t("nav.newMonitor")}
            </Link>
          )}
        </nav>
        <div className="p-4 border-t border-border text-xs text-muted space-y-2">
          <div className="flex items-center gap-2 text-fg2">
            {isAdmin ? <ShieldCheck size={14} className="text-accent" /> : <Eye size={14} className="text-muted" />}
            <span className="truncate">{user.username}</span>
            <span className={clsx("ml-auto text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 border", isAdmin ? "text-accent border-accent/40" : "text-muted border-border")}>{user.role}</span>
          </div>
          <div className="flex items-center gap-2">
            {connected ? <Wifi size={14} className="text-up" /> : <WifiOff size={14} className="text-down" />}
            {connected ? t("nav.connected") : t("nav.disconnected")}
          </div>
          {stats && (
            <div className="flex items-center gap-3">
              <span className="text-up">● {stats.up} up</span>
              <span className="text-down">● {stats.down} down</span>
              {stats.maintenance > 0 && <span className="text-maint">● {stats.maintenance} maint</span>}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pt-1">
            <ThemeToggle />
            <button onClick={onLogout} className="inline-flex items-center gap-2 hover:text-fg">
              <LogOut size={14} /> {t("nav.logout")}
            </button>
          </div>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="md:hidden h-14 flex items-center justify-between px-4 border-b border-border bg-panel/60">
          <Link to="/" className="flex items-center gap-2 font-semibold text-fg"><Activity size={18} className="text-accent" /> Pulsewatch</Link>
          <div className="flex items-center gap-3 text-sm text-fg3">
            <Link to="/monitors" className="text-fg3"><List size={18} /></Link>
            <Link to="/maintenance" className="text-fg3"><Wrench size={18} /></Link>
            <Link to="/status-pages" className="text-fg3"><Globe size={18} /></Link>
            <Link to="/settings" className="text-fg3"><Settings size={18} /></Link>
            {isAdmin && <Link to="/monitors/new" className="text-accent"><Plus size={20} /></Link>}
            <button onClick={onLogout} className="text-fg3"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="p-4 md:p-8 max-w-7xl mx-auto">{children}</main>
      </div>
    </div>
  );
}
