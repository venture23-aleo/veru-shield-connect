// Node globals some of the Privacy SDK's dependencies assume (ohttp-ts, and
// the mock prover's screening signer): a browser has no `Buffer`. Shim it
// before anything else loads — Safari reports this as "Can't find variable".
import { Buffer } from "buffer";
if (typeof (globalThis as { Buffer?: unknown }).Buffer === "undefined") {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
