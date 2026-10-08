import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { App } from "./App.jsx";

// No <StrictMode>: in development it mounts everything twice, which would start two maps and two timeline timers.
createRoot(document.getElementById("root")).render(<App />);
