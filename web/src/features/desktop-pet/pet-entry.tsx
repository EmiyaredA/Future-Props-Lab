import React from "react";
import ReactDOM from "react-dom/client";
import { PetRuntime } from "./PetRuntime";
import "./runtime.css";

const projectId = new URLSearchParams(location.search).get("id") ?? "";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PetRuntime projectId={projectId} />
  </React.StrictMode>,
);
