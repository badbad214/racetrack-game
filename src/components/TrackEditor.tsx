import React, { useState } from "react";
import { useEffect } from "react"; // already in use, just ensure it's present
import './TrackEditor.css';
import { GlobalGridOverlay } from "./GlobalGridOverlay";
import { isSupabaseConfigured, publishCloudTrack } from "../services/supabaseTracks";

interface TrackEditorProps {
  size: number;
  resetSignal: number;
}

type SectionType = "start" | "straight" | "curve90"; // | "curve45";

interface Section {
  id: string;
  type: SectionType | "grass" | `Tree_${number}`;
  x: number;
  y: number;
  rotation: number;
}

export const TrackEditor: React.FC<TrackEditorProps> = ({ size, resetSignal }) => {
  const [selectedTool, setSelectedTool] = useState<SectionType | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);
  const [dragY, setDragY] = useState<number | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasValidated, setHasValidated] = useState(false); //prevent the creation of the grid before validation
  const [isTrackValid, setIsTrackValid] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  //
  useEffect(() => {
    // Clear the grid when resetSignal changes
    setSections([]);
    setDraggedId(null);
    setDragX(null);
    setDragY(null);
    setIsTrackValid(false);
    setHasValidated(false);
  }, [resetSignal]);

  useEffect(() => {
    if (selectedTool === "start" && sections.some(s => s.type === "start")) {
      setSelectedTool(null);
    }
  }, [sections, selectedTool]);

  const imageMap: Record<string, string> = {
    start: "/tiles/Start.png",
    straight: "/tiles/Straight.png",
    curve90: "/tiles/Curve.png",
    grass: "/tiles/Grass.png",
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`Tree_${i + 1}`, `/tiles/Tree_${i + 1}.png`])
    ),
  };

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

  const gridUnit = 90;
  const cols = Math.floor(size / gridUnit);
  const rows = Math.floor(size / gridUnit);
  const boardWidth = cols * gridUnit;
  const boardHeight = rows * gridUnit;
  const [debugLog, setDebugLog] = useState<string[]>([]); //console to debug the rotation of the tiles
  const tools: { type: SectionType; label: string; image: string }[] = [
    { type: "start", label: "Start/Finish", image: "/tiles/Start.png" },
    { type: "straight", label: "Straight", image: "/tiles/Straight.png" },
    { type: "curve90", label: "90° Turn", image: "/tiles/Curve.png" },
    //{ type: "curve45", label: "45° Turn", icon: "⤾" },
  ];

  function isTrackSection(section: Section): section is Section & { type: SectionType } {
    return section.type === "start" || section.type === "straight" || section.type === "curve90";
  }

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
        const neighbor = sections.filter(isTrackSection).find(s => s.x === neighborX && s.y === neighborY);
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



    const alreadyPlaced = sections.some(s => isTrackSection(s) && s.x === snappedX && s.y === snappedY);
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

    setSections(prev => [
      ...prev.filter(s => isTrackSection(s) || s.x !== snappedX || s.y !== snappedY),
      newSection,
    ]);
    setIsTrackValid(false);
    if (selectedTool === "start") {
      setSelectedTool(null);
    }
  }

  // Save the current track to a JSON file with a unique name  
  // Save the current track to a JSON file only if it's valid
  function saveTrack(): void {
    if (!isTrackValid) {
      alert("❌ Cannot save. Track is invalid. Please validate it first.");
      return;
    }

    const gridName = `${size}_${size}`;
    const trackLength = getTrackLength(); // cleaner way to get length

    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);

    // Generate a precise Unix timestamp in milliseconds
    const milliseconds = now.getTime(); // precise Unix timestamp
    const filename = `${gridName}_${trackLength}_TRACK_${dd}${mm}${yy}_${milliseconds}.json`;

    const blob = new Blob([JSON.stringify(sections, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
  }

  async function publishTrack(): Promise<void> {
    if (!isTrackValid) {
      alert("❌ Cannot publish. Track is invalid. Please validate it first.");
      return;
    }

    if (!isSupabaseConfigured()) {
      alert("Supabase is not configured. Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.");
      return;
    }

    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);
    const name = `${size}_${size}_${getTrackLength()}_TRACK_${dd}${mm}${yy}_${now.getTime()}`;

    try {
      setIsPublishing(true);
      const record = await publishCloudTrack({
        name,
        boardSize: size,
        sections,
        isPublic: true,
      });
      alert(`☁️ Track published: ${record.name}`);
    } catch (error: any) {
      alert(`❌ Publish failed: ${error?.message ?? "Unknown error"}`);
    } finally {
      setIsPublishing(false);
    }
  }


  function handleTileClick(id: string, e: React.MouseEvent): void {
    e.stopPropagation();
    rotateSection(id);
  }

  // Rotate a tile by 90° clockwise and normalize the result to [0, 90, 180, 270]
  function rotateSection(id: string): void {
    setIsTrackValid(false);
    setSections(prev =>
      prev.map(s =>
        s.id === id && isTrackSection(s)
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
    setDragX(mouseX);
    setDragY(mouseY);
  }

  // Remove a section by its ID from the current grid
  function removeSection(id: string): void {
    setIsTrackValid(false);
    // Use functional state update to ensure predictable behavior
    setSections((prev) => {
      // Runtime assertion: check that at least one section exists
      if (!Array.isArray(prev)) throw new Error("Sections is not an array");
      return prev.filter((s) => s.id !== id);
    });
  }
  function decorateWithTrees(sections: Section[], gridSize: number): Section[] {
    const occupied = new Set(sections.map(s => `${s.x},${s.y}`));
    const decorated: Section[] = [...sections];

    const treeTiles = Array.from({ length: 10 }, (_, i) => `Tree_${i + 1}`);
    const rand = () => Math.floor(Math.random() * 100);

    for (let x = 0; x < gridSize; x++) {
      for (let y = 0; y < gridSize; y++) {
        const key = `${x},${y}`;
        if (occupied.has(key)) continue;

        // ~20% chance to place a tree
        if (rand() < 40) {
          const tree = treeTiles[Math.floor(Math.random() * treeTiles.length)];
          decorated.push({
            id: `tree-${x}-${y}`,
            type: tree as any, // safely cast if not part of SectionType enum
            x,
            y,
            rotation: 0,
          });
        } else {
          // Add Grass background
          decorated.push({
            id: `grass-${x}-${y}`,
            type: "grass" as any,
            x,
            y,
            rotation: 0,
          });
        }
      }
    }

    return decorated;
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
    setIsTrackValid(false);
    setHasValidated(false);
    setDraggedId(null);
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
    setIsTrackValid(false);

    setDraggedId(null);
    setDragX(null);
    setDragY(null);
  }
  // Get the bounding box of all sections to determine the grid size
  function getBoundingBox(sections: Section[]): { minX: number, minY: number, maxX: number, maxY: number } | null {
    if (sections.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of sections) {
      minX = Math.min(minX, s.x);
      minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x);
      maxY = Math.max(maxY, s.y);
    }

    return { minX, minY, maxX, maxY };
  }

  function validateTrack(silent: boolean = false): string[] {
    setHasValidated(true); // ✅ NEW LINE
    const errors: string[] = [];
    const trackSections = sections.filter(isTrackSection);
    if (trackSections.length === 0) {
      errors.push("Track is empty. Please place tiles before validating.");
    }
    const logs: string[] = [];

    const trackLength = trackSections.length;
    logs.push(`Track length: ${trackLength} tiles`);
    // Step 1: Check number of start tiles
    const startTiles = trackSections.filter(s => s.type === "start");
    if (startTiles.length !== 1) {
      errors.push(`Track must contain exactly one Start/Finish tile. Found ${startTiles.length}.`);
    }

    // Step 2: Build section map for fast lookup
    const sectionMap: Record<string, Section & { type: SectionType }> = {};
    for (const s of trackSections) {
      const key = `${s.x},${s.y}`;
      if (sectionMap[key]) {
        errors.push(`Overlap at (${s.x}, ${s.y})`);
      }
      sectionMap[key] = s;
    }

    // Step 3: Validate bidirectional connections
    for (const section of trackSections) {
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
    const queue: (Section & { type: SectionType })[] = [];

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

      if (visited.size !== trackSections.length) {
        errors.push(`Track is not a closed loop. ${trackSections.length - visited.size} tile(s) are disconnected.`);
      }
    }

    // Step 4.5: Check for floating tiles (not connected to any neighbor)
    for (const section of trackSections) {
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


    // Runtime assertions (Power of 10)
    console.assert(Array.isArray(errors), "Validation errors must be an array.");
    console.assert(typeof sectionMap === "object", "Section map must be an object.");
    logs.push(`Track length: ${trackLength} tiles`);

    const tileCounts = {
      start: 0,
      straight: 0,
      curve90: 0,
    };

    for (const s of sections) {
      if (s.type in tileCounts) {
        tileCounts[s.type as keyof typeof tileCounts]++;
      }
    }

    logs.push(
      `Tile usage: start=${tileCounts.start}, straight=${tileCounts.straight}, curve90=${tileCounts.curve90}`
    );

    if (!silent) {
      setHasValidated(true);
      if (errors.length > 0) {
        setIsTrackValid(false);
        setValidationErrors(errors);
      } else {
        setIsTrackValid(true); // ✅ first
        const decorated = decorateWithTrees(trackSections, cols);
        setSections(decorated);

        alert("✅ Track is valid and now beautifully forested!");
      }
      setDebugLog(logs);
    }

    return errors;
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

  // ✅ Compute grid overlay (only shown after successful validation)
  let gridOverlay = null;

  if (isTrackValid) {
    const bbox = getBoundingBox(sections);
    if (bbox) {
      gridOverlay = (
        <GlobalGridOverlay
          spacing={15}
          tileSize={gridUnit}
          x={bbox.minX}
          y={bbox.minY}
          cols={bbox.maxX - bbox.minX + 1}
          rows={bbox.maxY - bbox.minY + 1}
          sections={sections.filter(s => s.type === "start" || s.type === "straight" || s.type === "curve90") as any}
        />
      );
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
          width: boardWidth,
        }}
      >
        {tools.map((tool) => {
          const isStartUnavailable = tool.type === "start" && sections.some(s => s.type === "start");
          return (
          <div
            key={tool.type}
            onClick={() => {
              if (isStartUnavailable) return;
              setSelectedTool(tool.type);
            }}
            style={{
              width: 100,
              minHeight: 124,
              backgroundColor: "transparent",
              border: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 6,
              cursor: isStartUnavailable ? "not-allowed" : "pointer",
              fontWeight: "bold",
              userSelect: "none",
              opacity: isStartUnavailable ? 0.45 : 1,
            }}
            title={isStartUnavailable ? "Only one Start/Finish tile is allowed" : tool.label}
          >
            <div
              style={{
                width: 92,
                height: 92,
                backgroundColor: selectedTool === tool.type ? "#d7ecff" : "#fff",
                border: selectedTool === tool.type ? "3px solid #0077cc" : "2px solid #999",
                borderRadius: 6,
                padding: 3,
              }}
            >
              <img
                src={tool.image}
                alt={tool.label}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  pointerEvents: "none"
                }}
              />
            </div>

            <div style={{
              fontSize: 12,
              textAlign: "center",
              lineHeight: 1.15,
              color: selectedTool === tool.type ? "#004f8a" : "#000"
            }}>
              {tool.label}
            </div>
          </div>
          );
        })}
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

        <button onClick={() => validateTrack(false)}
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

        <button
          onClick={saveTrack}
          style={{
            padding: "8px 16px",
            backgroundColor: "#003399",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold"
          }}
        >
          💾 Save Track
        </button>

        <button
          onClick={() => publishTrack()}
          disabled={isPublishing}
          style={{
            padding: "8px 16px",
            backgroundColor: isPublishing ? "#777" : "#0b7a5a",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: isPublishing ? "not-allowed" : "pointer",
            fontWeight: "bold"
          }}
        >
          {isPublishing ? "⏳ Publishing..." : "☁️ Publish Track"}
        </button>
      </div>



      <div
        onMouseMove={updateHover}
        onMouseUp={dropSection}
        onMouseLeave={() => setDraggedId(null)}
        onClick={handleGridClick}
        style={{
          width: boardWidth,
          height: boardHeight,
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
            onClick={(e) => handleTileClick(section.id, e)} // 👈 restore click-to-rotate
            onContextMenu={(e) => {
              e.preventDefault(); // 👈 optional: right-click to delete
              removeSection(section.id);
            }}
            style={{
              gridColumnStart: section.x + 1,
              gridRowStart: section.y + 1,
              position: "relative",
              width: "90px",
              height: "90px",
              cursor: "pointer",
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                transform: `rotate(${section.rotation}deg)`,
                transformOrigin: "center",
              }}
            >
              <img
                src={imageMap[section.type]}
                alt={section.type}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  pointerEvents: "none",
                }}
              />
            </div>
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

        {gridOverlay}



        {/* ❌ Show modal only if there are validation errors */}
        {hasValidated && validationErrors.length > 0 && (
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
          width: boardWidth,
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

