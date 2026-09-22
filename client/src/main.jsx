import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { I18nProvider } from "./lib/i18n.jsx";
import { ThemeProvider } from "./lib/theme.jsx";
import { api } from "./lib/api.js";
import "./index.css";

// Default bahasa & tema instance diambil dari server, tapi pilihan user di
// browser ini tetap menang (lihat I18nProvider / ThemeProvider).
function Root() {
  const [defaults, setDefaults] = useState({ language: "id", theme: "dark" });

  useEffect(() => {
    api("/settings/public", { auth: false })
      .then((s) => setDefaults({ language: s.language || "id", theme: s.theme || "dark" }))
      .catch(() => {});
  }, []);

  return (
    <I18nProvider fallback={defaults.language}>
      <ThemeProvider fallback={defaults.theme}>
        <App />
      </ThemeProvider>
    </I18nProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>
);
