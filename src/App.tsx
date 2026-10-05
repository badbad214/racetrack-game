import React, { useState } from "react";
import "./App.css";
import { GamePlay } from "./components/GamePlay";
import { TrackEditor } from "./components/TrackEditor";

type AppMode = "edit" | "play";

function App() {
  const [size, setSize] = useState(600);
  const [mode, setMode] = useState<AppMode>("play");
  const [resetCounter, setResetCounter] = useState(0);

  function handleSizeChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    setSize(Number(event.target.value));
    setResetCounter((value) => value + 1);
  }

  return (
    <main className="app-shell">
      <section className="top-bar">
        <div>
          <p className="eyebrow">Vector Formula</p>
          <h1>Pen and Paper Racer</h1>
        </div>

        <div className="mode-switch" aria-label="Mode">
          <button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>
            Design Track
          </button>
          <button className={mode === "play" ? "active" : ""} onClick={() => setMode("play")}>
            Race
          </button>
        </div>
      </section>

      <section className="tile-app-toolbar">
        {mode === "edit" && (
          <label>
            Board size
            <select value={size} onChange={handleSizeChange}>
              <option value={400}>Small 400 x 400</option>
              <option value={600}>Medium 600 x 600</option>
              <option value={900}>Large 900 x 900</option>
              <option value={1200}>Huge 1200 x 1200</option>
            </select>
          </label>
        )}
      </section>

      <section className="tile-stage">
        {mode === "edit" && <TrackEditor size={size} resetSignal={resetCounter} />}
        {mode === "play" && <GamePlay size={size} />}
      </section>
    </main>
  );
}

export default App;
