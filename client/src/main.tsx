import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { reloadOnPreloadError } from "./lazyImport";
import { registerShellWorker } from "./serviceWorker";
import AuthGate from "./AuthGate";
import { installAppViewport } from "./appViewport";
import { installInputFocus } from "./inputFocus";
import { installKeyboardViewport } from "./keyboardViewport";
import { installKeyboardLift } from "./keyboard";
import "./theme.css";
import "./mobile-fixes.css";
import "./ticket-drawer.css";

import "./design-surface.css";
import "./pages/connections.css";
import "./pages/settings.css";
import "./components/scroll-text.css";
import "./components/reply-markdown.css";
import "./components/file-ticket.css";
import "./components/file-preview.css";

window.addEventListener("vite:preloadError", () => reloadOnPreloadError());
installAppViewport();
installInputFocus();
installKeyboardViewport();
installKeyboardLift();
registerShellWorker();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthGate><App /></AuthGate>
    </BrowserRouter>
  </React.StrictMode>,
);
