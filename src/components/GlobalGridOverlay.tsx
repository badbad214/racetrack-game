import type { Section } from "../types/types";
import { grassSvgPath, roadSvgPath, straightRoadSvgPath } from "../logic/trackMaskGeometry";

interface GlobalGridOverlayProps {
  spacing: number;
  tileSize: number;
  x: number;
  y: number;
  cols: number;
  rows: number;
  sections: Section[];
}

function roadClip(type: Section["type"], tileSize: number) {
  if (type === "curve90") {
    return <path d={roadSvgPath(tileSize)} />;
  }

  return <path d={straightRoadSvgPath(tileSize)} />;
}

function gridLines(width: number, height: number, spacing: number) {
  const lines = [];

  for (let pos = 0; pos <= width; pos += spacing) {
    lines.push(<line key={`v-${pos}`} x1={pos + 0.5} y1={0} x2={pos + 0.5} y2={height} />);
  }

  for (let pos = 0; pos <= height; pos += spacing) {
    lines.push(<line key={`h-${pos}`} x1={0} y1={pos + 0.5} x2={width} y2={pos + 0.5} />);
  }

  return lines;
}

function roadTransform(section: Section, tileSize: number, originX: number, originY: number): string {
  const tileX = section.x * tileSize - originX;
  const tileY = section.y * tileSize - originY;
  return `translate(${tileX} ${tileY}) rotate(${section.rotation} ${tileSize / 2} ${tileSize / 2})`;
}

function roadShape(section: Section, tileSize: number, originX: number, originY: number) {
  return (
    <g transform={roadTransform(section, tileSize, originX, originY)}>
      {roadClip(section.type, tileSize)}
    </g>
  );
}

function grassShape(section: Section, tileSize: number, originX: number, originY: number) {
  const path = grassSvgPath(section.type, tileSize);
  if (!path) return null;

  return (
    <g transform={roadTransform(section, tileSize, originX, originY)}>
      <path d={path} fillRule="evenodd" />
    </g>
  );
}

export const GlobalGridOverlay: React.FC<GlobalGridOverlayProps> = ({
  spacing,
  tileSize,
  x,
  y,
  cols,
  rows,
  sections,
}) => {
  const width = cols * tileSize;
  const height = rows * tileSize;
  const originX = x * tileSize;
  const originY = y * tileSize;
  const maskId = `road-grid-mask-${x}-${y}-${cols}-${rows}`;
  const grassMaskId = `grass-mask-${x}-${y}-${cols}-${rows}`;

  return (
    <svg
      width={width}
      height={height}
      style={{
        position: "absolute",
        top: originY,
        left: originX,
        pointerEvents: "none",
        zIndex: 5,
      }}
      shapeRendering="crispEdges"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
          <rect x={0} y={0} width={width} height={height} fill="black" />
          {sections.map((section) => (
            <g key={section.id} fill="white">{roadShape(section, tileSize, originX, originY)}</g>
          ))}
        </mask>
        <mask id={grassMaskId} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
          <rect x={0} y={0} width={width} height={height} fill="black" />
          {sections.map((section) => (
            <g key={section.id} fill="white">{grassShape(section, tileSize, originX, originY)}</g>
          ))}
        </mask>
      </defs>

      <g mask={`url(#${maskId})`} stroke="rgba(255,255,255,0.72)" strokeWidth="1">
        {gridLines(width, height, spacing)}
      </g>
    </svg>
  );
};
