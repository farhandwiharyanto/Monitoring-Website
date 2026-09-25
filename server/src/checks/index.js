import { checkHttp } from "./http.js";
import { checkTcp } from "./tcp.js";
import { checkPing } from "./ping.js";
import { checkDns } from "./dns.js";
import { checkDatabase } from "./database.js";
import { checkGrpc } from "./grpc.js";
import { checkKafka } from "./kafka.js";

// Tipe database memakai runner yang sama; yang membedakannya hanya driver
export const DATABASE_TYPES = ["postgres", "mysql", "redis"];
export const MONITOR_TYPES = ["http", "tcp", "ping", "dns", "push", ...DATABASE_TYPES, "grpc", "kafka"];

export async function runCheck(monitor) {
  switch (monitor.type) {
    case "http": return checkHttp(monitor);
    case "tcp": return checkTcp(monitor);
    case "ping": return checkPing(monitor);
    case "dns": return checkDns(monitor);
    case "postgres":
    case "mysql":
    case "redis":
      return checkDatabase(monitor);
    case "grpc": return checkGrpc(monitor);
    case "kafka": return checkKafka(monitor);
    // Monitor push tidak aktif dicek: target yang mengirim heartbeat sendiri.
    case "push": return { ok: true, ms: null, message: "Monitor push menunggu heartbeat dari target" };
    default: return { ok: false, ms: 0, message: `Tipe monitor tidak dikenal: ${monitor.type}` };
  }
}
