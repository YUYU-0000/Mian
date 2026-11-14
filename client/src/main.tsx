import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
