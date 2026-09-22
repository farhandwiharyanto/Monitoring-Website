import { io } from "socket.io-client";
import { getToken } from "./api.js";

let socket;
export function getSocket() {
  if (!socket) {
    socket = io("/", { auth: { token: getToken() }, transports: ["websocket", "polling"] });
  }
  return socket;
}
export function reconnectWithToken() {
  if (socket) {
    socket.auth = { token: getToken() };
    socket.disconnect().connect();
  }
}
