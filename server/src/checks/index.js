import { checkHttp } from "./http.js";
import { checkTcp } from "./tcp.js";
import { checkPing } from "./ping.js";
import { checkDns } from "./dns.js";

export async function runCheck(monitor) {
  switch (monitor.type) {
    case "http": return checkHttp(monitor);
    case "tcp": return checkTcp(monitor);
    case "ping": return checkPing(monitor);
    case "dns": return checkDns(monitor);
    default: return { ok: false, ms: 0, message: `Tipe monitor tidak dikenal: ${monitor.type}` };
  }
}
