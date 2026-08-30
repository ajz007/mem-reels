import "./styles.css";
import { renderApp } from "./ui/app";

void renderApp(document.querySelector<HTMLDivElement>("#app")!);

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/service-worker.js");
}
