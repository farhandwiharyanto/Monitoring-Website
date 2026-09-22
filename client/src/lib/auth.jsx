import { createContext, useContext } from "react";

// user: { id, username, role } | null
export const AuthCtx = createContext({ user: null, isAdmin: false });
export const useAuth = () => useContext(AuthCtx);
