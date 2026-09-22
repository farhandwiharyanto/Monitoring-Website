import { NavLink, Link } from "react-router-dom";
import { Activity, LayoutDashboard, Bell, Globe, Settings, LogOut, Plus, Wifi, WifiOff, List, Wrench, Users, ShieldCheck, Eye } from "lucide-react";
import clsx from "clsx";
import { useMonitors } from "../lib/monitors.jsx";
import { useAuth } from "../lib/auth.jsx";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/monitors", label: "Monitors", icon: List },
  { to: "/maintenance", label: "Maintenance", icon: Wrench },
  { to: "/notifications", label: "Notifikasi", icon: Bell, admin: true },
  { to: "/status-pages", label: "Status Pages", icon: Globe },
  { to: "/users", label: "Users", icon: Users, admin: true },
  { to: "/settings", label: "Pengaturan", icon: Settings },
];

export default function Layout({ children, onLogout }) {
  const { connected, stats } = useMonitors();
  const { user, isAdmin } = useAuth();
  const items = nav.filter((n) => !n.admin || isAdmin);
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-border bg-panel/60 backdrop-blur hidden md:flex flex-col">
        <Link to="/" className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
          <span className="h-8 w-8 rounded-lg bg-accent/15 grid place-items-center">
            <Activity size={18} className="text-accent" />
          </span>
          <span className="font-semibold tracking-tight text-white">Pulsewatch</span>
        </Link>
        <nav className="p-3 space-y-1 flex-1">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive ? "bg-accent/10 text-accent" : "text-slate-400 hover:text-white hover:bg-panel2"
                )
              }
            >
              <Icon size={17} /> {label}
            </NavLink>
          ))}
          {isAdmin && (
            <Link to="/monitors/new" className="btn-primary w-full justify-center mt-4">
              <Plus size={16} /> Monitor baru
            </Link>
          )}
        </nav>
        <div className="p-4 border-t border-border text-xs text-muted space-y-2">
          <div className="flex items-center gap-2 text-slate-300">
            {isAdmin ? <ShieldCheck size={14} className="text-accent" /> : <Eye size={14} className="text-muted" />}
            <span className="truncate">{user.username}</span>
            <span className={clsx("ml-auto text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 border", isAdmin ? "text-accent border-accent/40" : "text-muted border-border")}>{user.role}</span>
          </div>
          <div className="flex items-center gap-2">
            {connected ? <Wifi size={14} className="text-up" /> : <WifiOff size={14} className="text-down" />}
            {connected ? "Realtime terhubung" : "Terputus"}
          </div>
          {stats && (
            <div className="flex items-center gap-3">
              <span className="text-up">● {stats.up} up</span>
              <span className="text-down">● {stats.down} down</span>
              {stats.maintenance > 0 && <span className="text-maint">● {stats.maintenance} maint</span>}
            </div>
          )}
          <button onClick={onLogout} className="flex items-center gap-2 hover:text-white">
            <LogOut size={14} /> Keluar
          </button>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="md:hidden h-14 flex items-center justify-between px-4 border-b border-border bg-panel/60">
          <Link to="/" className="flex items-center gap-2 font-semibold text-white"><Activity size={18} className="text-accent" /> Pulsewatch</Link>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/monitors" className="text-slate-400"><List size={18} /></Link>
            <Link to="/maintenance" className="text-slate-400"><Wrench size={18} /></Link>
            <Link to="/status-pages" className="text-slate-400"><Globe size={18} /></Link>
            {isAdmin && <Link to="/monitors/new" className="text-accent"><Plus size={20} /></Link>}
            <button onClick={onLogout} className="text-slate-400"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="p-4 md:p-8 max-w-7xl mx-auto">{children}</main>
      </div>
    </div>
  );
}
