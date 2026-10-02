import React from "react";
import ReactDOM from "react-dom/client";
import { ChatWindow } from "./ChatWindow";

const projectId = new URLSearchParams(location.search).get("id") ?? "";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ChatWindow projectId={projectId} />
  </React.StrictMode>,
);
