import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { LangProvider } from "./i18n.jsx";
import { FeedbackHost } from "./feedback.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LangProvider>
      <App />
      <FeedbackHost />
    </LangProvider>
  </React.StrictMode>
);
