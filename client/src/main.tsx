import React from "react";
import ReactDOM from "react-dom/client";
import { TerminalProvider } from "@/contexts/terminal-context";
import { AppProvider } from "@/contexts/app-context";
import { TerminalPage } from "@/components/terminal/terminal-page";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TerminalProvider>
      <AppProvider>
        <TerminalPage />
      </AppProvider>
    </TerminalProvider>
  </React.StrictMode>
);
