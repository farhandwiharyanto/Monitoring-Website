import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api.js";
import { getSocket } from "./socket.js";

const Ctx = createContext(null);

export function MonitorsProvider({ children }) {
  const [monitors, setMonitors] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  const refresh = useCallback(async () => {
    const [m, s] = await Promise.all([api("/monitors"), api("/monitors/stats")]);
    setMonitors(m);
    setStats(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
    const socket = getSocket();
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onBeat = ({ monitor }) => {
      setMonitors((list) => list.map((m) => (m.id === monitor.id ? { ...m, ...monitor } : m)));
    };
    const onStatus = () => api("/monitors/stats").then(setStats).catch(() => {});
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("heartbeat", onBeat);
    socket.on("monitor:status", onStatus);
    setConnected(socket.connected);
    // Stats ringan, refresh tiap 30 detik untuk avg/uptime
    const t = setInterval(onStatus, 30000);
    return () => {
      socket.off("connect", onConnect); socket.off("disconnect", onDisconnect);
      socket.off("heartbeat", onBeat); socket.off("monitor:status", onStatus);
      clearInterval(t);
    };
  }, [refresh]);

  return <Ctx.Provider value={{ monitors, stats, loading, connected, refresh }}>{children}</Ctx.Provider>;
}

export const useMonitors = () => useContext(Ctx);
