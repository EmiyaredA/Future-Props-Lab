import React from "react";
import ReactDOM from "react-dom/client";
import { DocsApp } from "./DocsApp";
import "@shared/ui/theme.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DocsApp />
  </React.StrictMode>,
);
