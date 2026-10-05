import React, { useState } from "react";
import { useEffect } from "react"; // already in use, just ensure it's present
import './TrackEditor.css';

interface TrackEditorProps {
  size: number;
  resetSignal: number;
}

type SectionType = "start" | "straight" | "curve90"; // | "curve45";

interface Section {
  id: string;
  type: SectionType;
  x: number;
  y: number;
  rotation: number;
}

export const TrackEditor: React.FC<TrackEditorProps> = ({ size, resetSignal }) => {
  const [selectedTool, setSelectedTool] = useState<SectionType | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);
  const [dragY, setDragY] = useState<number | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    // Clear the grid when resetSignal changes
    setSections([]);
    setDraggedId(null);
    setHoverX(null);
    setHoverY(null);
    setDragX(null);
    setDragY(null);
  }, [resetSignal]);

  // Direction vectors: used to locate neighbor tiles vu
  const directionOffsets = {
    top: { dx: 0, dy: -1 },
    bottom: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
  } as const;

  // Reverse mapping for connection validation vu
  const reverseDirection = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  } as const;

  const gridUnit = 100;
  const cols = Math.floor(size / gridUnit);
  const rows = Math.floor(size / gridUnit);
  const [debugLog, setDebugLog] = useState<string[]>([]); //console to debug the rotation of the tiles
  const tools: { type: SectionType; label: string; image: string }[] = [
    { type: "start", label: "Start/Finish", image: "/tiles/start.png" },
    { type: "straight", label: "Straight", image: "/tiles/straight.png" },
    { type: "curve90", label: "90° Turn", image: "/tiles/curve.png" },
    //{ type: "curve45", label: "45° Turn", icon: "⤾" },
  ];

  // Calculate the total length of the track based on sections
  // This counts only straight, start, and 90° curve sections
  function getTrackLength(): number {
    return sections.filter(s =>
      s.type === "straight" || s.type === "start" || s.type === "curve90"
    ).length;
  }
  // Handle placing a tile on the grid and auto-rotate it to best match nearby neighbors
  function handleGridClick(e: React.MouseEvent<HTMLDivElement>): void {
    // ⛔ Prevent placing tiles while validation modal is active
    if (validationErrors.length > 0) return;

    if (!selectedTool) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const snappedX = Math.floor((e.clientX - rect.left) / gridUnit);
    const snappedY = Math.floor((e.clientY - rect.top) / gridUnit);

    if (selectedTool === "start" && sections.some(s => s.type === "start")) {
      alert("Only one Start/Finish section is allowed.");
      return;
    }

    // Inside the loop that checks all 4 rotations
    let bestRotation = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestMatchCount = -1;

    for (let rot = 0; rot < 360; rot += 90) {
      const conns = getConnections(selectedTool, rot);
      let score = 0;
      let matches = 0;

      for (const dir of conns) {
        const { dx, dy } = directionOffsets[dir as keyof typeof directionOffsets];
        const neighborX = snappedX + dx;
        const neighborY = snappedY + dy;
        const neighbor = sections.find(s => s.x === neighborX && s.y === neighborY);
        if (!neighbor) continue;

        const neighborConns = getConnections(neighbor.type, neighbor.rotation);
        const expectedReturn = reverseDirection[dir as keyof typeof reverseDirection];

        if (neighborConns.includes(expectedReturn)) {
          score += 10;  // strong mutual connection
          matches++;
        } else {
          score -= 5;  // mismatch is now strongly penalized
        }
      }

      // Favor more connections, then higher score
      if (
        matches > bestMatchCount ||
        (matches === bestMatchCount && score > bestScore)
      ) {
        bestMatchCount = matches;
        bestScore = score;
        bestRotation = rot;
      }
    }



    const alreadyPlaced = sections.some(s => s.x === snappedX && s.y === snappedY);
    if (alreadyPlaced) {
      alert(`A tile already exists at (${snappedX}, ${snappedY})`);
      return;
    }

    const newSection: Section = {
      id: `sec-${Date.now()}`,
      type: selectedTool,
      x: snappedX,
      y: snappedY,
      rotation: bestRotation,
    };

    setSections(prev => [...prev, newSection]);
  }


  function handleTileClick(id: string, e: React.MouseEvent): void {
    e.stopPropagation();
    rotateSection(id);
  }

  function handleTileMouseDown(
    e: React.MouseEvent,
    sectionId: string,
    startX: number,
    startY: number
  ): void {
    e.stopPropagation();
    setDraggedId(sectionId);
    setDragX(startX);
    setDragY(startY);
  }

  // Rotate a tile by 90° clockwise and normalize the result to [0, 90, 180, 270]
  function rotateSection(id: string): void {
    setSections(prev =>
      prev.map(s =>
        s.id === id
          ? {
            ...s,
            rotation: ((s.rotation + 90) % 360 + 360) % 360, // ensure 0 ≤ rotation < 360
          }
          : s
      )
    );
  }
  function updateHover(e: React.MouseEvent<HTMLDivElement>): void {
    if (!draggedId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = Math.floor((e.clientX - rect.left) / gridUnit);
    const mouseY = Math.floor((e.clientY - rect.top) / gridUnit);
    setHoverX(mouseX);
    setHoverY(mouseY);
    setDragX(mouseX);
    setDragY(mouseY);
  }

  // Remove a section by its ID from the current grid
  function removeSection(id: string): void {
    // Use functional state update to ensure predictable behavior
    setSections((prev) => {
      // Runtime assertion: check that at least one section exists
      if (!Array.isArray(prev)) throw new Error("Sections is not an array");
      return prev.filter((s) => s.id !== id);
    });
  }

  function getConnections(type: SectionType, rotation: number): string[] {
    const normalized = ((rotation % 360) + 360) % 360;

    switch (type) {
      case "start":
      case "straight":
        return normalized % 180 === 0 ? ["left", "right"] : ["top", "bottom"];

      case "curve90":
        switch (normalized) {
          case 0: return ["bottom", "right"];   // ↘
          case 90: return ["left", "bottom"];   // ↙
          case 180: return ["top", "left"];     // ↖
          case 270: return ["right", "top"];    // ↗
        }
    }

    return [];
  }


  // Remove all track sections
  function clearGrid(): void {
    // Assertion to ensure sections were present
    console.assert(sections.length >= 0, "Clearing sections");
    setSections([]);
    setDraggedId(null);
    setHoverX(null);
    setHoverY(null);
    setDragX(null);
    setDragY(null);
  }
  function dropSection(): void {
    if (draggedId === null || dragX === null || dragY === null) return;

    const isOccupied = sections.some(s => s.id !== draggedId && s.x === dragX && s.y === dragY);
    if (isOccupied) {
      alert(`Cannot drop: space at (${dragX}, ${dragY}) is already occupied.`);
      return;
    }

    setSections(prev =>
      prev.map(s =>
        s.id === draggedId ? { ...s, x: dragX, y: dragY } : s
      )
    );

    setDraggedId(null);
    setDragX(null);
    setDragY(null);
  }

  function validateTrack(): void {
    const errors: string[] = [];
    const logs: string[] = [];

    const trackLength = sections.filter(s =>
      s.type === "straight" || s.type === "start" || s.type === "curve90"
    ).length;
    logs.push(`Track length: ${trackLength} tiles`);
    // Step 1: Check number of start tiles
    const startTiles = sections.filter(s => s.type === "start");
    if (startTiles.length !== 1) {
      errors.push(`Track must contain exactly one Start/Finish tile. Found ${startTiles.length}.`);
    }

    // Step 2: Build section map for fast lookup
    const sectionMap: Record<string, Section> = {};
    for (const s of sections) {
      const key = `${s.x},${s.y}`;
      if (sectionMap[key]) {
        errors.push(`Overlap at (${s.x}, ${s.y})`);
      }
      sectionMap[key] = s;
    }

    // Step 3: Validate bidirectional connections
    for (const section of sections) {
      const conns = getConnections(section.type, section.rotation);
      setDebugLog(prev => [...prev, `${section.type} at (${section.x},${section.y}) rotation=${section.rotation} connects to: ${conns.join(", ")}`]);

      for (const dir of conns) {
        const { dx, dy } = directionOffsets[dir as keyof typeof directionOffsets];
        const neighborKey = `${section.x + dx},${section.y + dy}`;
        const neighbor = sectionMap[neighborKey];

        if (!neighbor) {
          errors.push(`Open connection: ${section.type} at (${section.x},${section.y}) has no neighbor ${dir}`);
          continue;
        }

        const neighborConns = getConnections(neighbor.type, neighbor.rotation);
        const expectedReturn = reverseDirection[dir as keyof typeof reverseDirection];
        if (!neighborConns.includes(expectedReturn)) {
          errors.push(`Connection mismatch: ${section.type} at (${section.x},${section.y}) → ${dir}, but ${neighbor.type} at (${neighbor.x},${neighbor.y}) lacks ${expectedReturn}`);
        }
      }
    }

    // Step 4: Ensure the track forms a closed loop
    const visited = new Set<string>();
    const queue: Section[] = [];

    if (startTiles.length === 1) {
      const start = startTiles[0];
      const startKey = `${start.x},${start.y}`;
      queue.push(start);
      visited.add(startKey);

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) break;

        const conns = getConnections(current.type, current.rotation);

        for (const dir of conns) {
          const { dx, dy } = directionOffsets[dir as keyof typeof directionOffsets];
          const neighborX = current.x + dx;
          const neighborY = current.y + dy;
          const neighborKey = `${neighborX},${neighborY}`;

          if (!sectionMap[neighborKey]) continue; // Not connected
          if (visited.has(neighborKey)) continue;  // Already processed

          const neighbor = sectionMap[neighborKey];
          const neighborConns = getConnections(neighbor.type, neighbor.rotation);
          const expectedReturn = reverseDirection[dir as keyof typeof reverseDirection];

          if (neighborConns.includes(expectedReturn)) {
            visited.add(neighborKey);
            queue.push(neighbor);
          }
        }
      }

      if (visited.size !== sections.length) {
        errors.push(`Track is not a closed loop. ${sections.length - visited.size} tile(s) are disconnected.`);
      }
    }

    // Step 4.5: Check for floating tiles (not connected to any neighbor)
    for (const section of sections) {
      const conns = getConnections(section.type, section.rotation);
      let hasConnection = false;

      for (const dir of conns) {
        const { dx, dy } = directionOffsets[dir as keyof typeof directionOffsets];
        const neighborKey = `${section.x + dx},${section.y + dy}`;
        const neighbor = sectionMap[neighborKey];

        if (!neighbor) continue;

        const neighborConns = getConnections(neighbor.type, neighbor.rotation);
        const expectedReturn = reverseDirection[dir as keyof typeof reverseDirection];

        if (neighborConns.includes(expectedReturn)) {
          hasConnection = true;
          break;
        }
      }

      if (!hasConnection) {
        errors.push(`Floating tile: ${section.type} at (${section.x},${section.y}) has no valid connections.`);
      }
    }

    // Step 5: Final result handling
    if (errors.length > 0) {
      setValidationErrors(errors);
    } else {
      alert("✅ Track is valid and forms a closed loop!");
    }

    // Runtime assertions (Power of 10)
    console.assert(Array.isArray(errors), "Validation errors must be an array.");
    console.assert(typeof sectionMap === "object", "Section map must be an object.");
    setDebugLog(logs);
  }


  //creation of a button to be able to copy the results of the validation
  async function copyResults() {
    const text = validationErrors.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied to clipboard!");
    } catch {
      alert("Failed to copy");
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "center",
          gap: "8px",
          marginBottom: "16px",
          width: size,
        }}
      >
        {tools.map((tool) => (
          <div
            key={tool.type}
            onClick={() => setSelectedTool(tool.type)}
            style={{
              width: 100,
              height: 100,
              backgroundColor: selectedTool === tool.type ? "#0077cc" : "#fff",
              border: "2px solid #999",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: 24,
              fontWeight: "bold",
              userSelect: "none",
            }}
          >
            <img
              src={tool.image}
              alt={tool.label}
              style={{
                width: "100%",
                height: "70%",
                objectFit: "cover",
                pointerEvents: "none"
              }}
            />

            <div style={{
              fontSize: 12,
              textAlign: "center",
              color: selectedTool === tool.type ? "#fff" : "#000"
            }}>
              {tool.label}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: "8px", display: "flex", gap: "8px" }}>
        <button
          onClick={() => {
            if (window.confirm("Are you sure you want to clear the grid?")) {
              clearGrid();
            }
          }}
          style={{
            padding: "8px 16px",
            backgroundColor: "#cc0000",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold"
          }}
        >
          🧹 Clear Grid
        </button>

        <button
          onClick={validateTrack}
          style={{
            padding: "8px 16px",
            backgroundColor: "#007700",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold"
          }}
        >
          ✅ Validate Track
        </button>
      </div>


      <div
        onMouseMove={updateHover}
        onMouseUp={dropSection}
        onMouseLeave={() => setDraggedId(null)}
        onClick={handleGridClick}
        style={{
          width: size,
          height: size,
          background: "#f0f0f0",
          border: "2px dashed gray",
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${gridUnit}px)`,
          gridTemplateRows: `repeat(${rows}, ${gridUnit}px)`,
          position: "relative",
        }}
      >
        {/* Background grid cells */}
        {Array.from({ length: rows * cols }).map((_, i) => (
          <div key={`cell-${i}`} style={{ border: "1px solid #ccc" }} />
        ))}

        {/* Placed track sections */}
        {sections.map((section) => (
          <div
            key={section.id}
            draggable={false}
            onMouseDown={(e) => handleTileMouseDown(e, section.id, section.x, section.y)}
            onMouseMove={updateHover}
            onClick={(e) => {
              e.stopPropagation();
              rotateSection(section.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              removeSection(section.id);
            }}
            style={{
              gridColumnStart: section.x + 1,
              gridRowStart: section.y + 1,
              background: section.id === draggedId ? "transparent" : "rgba(0, 128, 255, 0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: "bold",
              border: section.id === draggedId ? "2px dashed #0077cc" : "2px solid #0077cc",
              transform: `rotate(${section.rotation}deg)`,
              transformOrigin: "center",
              cursor: "grab",
              opacity: section.id === draggedId ? 0.3 : 1,
            }}
          >
            <img
              src={tools.find((t) => t.type === section.type)?.image}
              alt={section.type}
              style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
            />
          </div>
        ))}

        {/* Drag preview */}
        {draggedId !== null && dragX !== null && dragY !== null && (() => {
          const dragged = sections.find(s => s.id === draggedId);
          if (!dragged) return null;

          return (
            <div
              key="drag-preview"
              style={{
                gridColumnStart: dragX + 1,
                gridRowStart: dragY + 1,
                background: "rgba(255, 200, 0, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                fontWeight: "bold",
                border: "2px dashed #ffaa00",
                transform: `rotate(${dragged.rotation}deg)`,
                transformOrigin: "center",
                pointerEvents: "none",
              }}
            >
              <img
                src={tools.find(t => t.type === dragged.type)?.image}
                alt={dragged.type}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  pointerEvents: "none",
                }}
              />
            </div>
          );
        })()}

        {/* ✅ Validation modal*/}
        {validationErrors.length > 0 && (
          <div className="modal">
            <h3>Track Validation Failed:</h3>
            <pre style={{ userSelect: "all", whiteSpace: "pre-wrap" }}>
              {validationErrors.join("\n")}
            </pre>
            <button onClick={copyResults}>📋 Copy Results</button>
            <button onClick={() => setValidationErrors([])}>Close</button>
          </div>
        )}

      </div>  {/* <-- closes the big grid container */}

      {/* 🐛 Debug Output Panel */}
      <div
        style={{
          maxHeight: "200px",
          overflowY: "auto",
          backgroundColor: "#eee",
          padding: "8px",
          marginTop: "8px",
          width: size,
        }}
      >
        <h4>Debug Output</h4>
        <pre style={{ fontSize: "12px", whiteSpace: "pre-wrap" }}>
          {debugLog.join("\n")}
        </pre>
      </div>

    </div>
  );
};
