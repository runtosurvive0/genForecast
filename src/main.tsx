import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthGate } from "./features/auth/AuthGate";
import { installAuthenticatedFetch } from "./lib/auth-client";
import "./index.css";
import "./refinement.css";
installAuthenticatedFetch();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate><App /></AuthGate>
  </StrictMode>,
);
