/** One coordinate system for raster backgrounds, entities and pointer hit testing. */
export const BOARD = {
  width: 1200,
  height: 690,
  left: 210,
  top: 116,
  cols: 9,
  cell: 99,
  lawnHeight: 504,
  houseRight: 136,
  mowerX: 183,
} as const;
export const cellX = (col: number) => BOARD.left + (col + 0.5) * BOARD.cell;
export const cellY = (row: number, rows: number) =>
  BOARD.top + ((row + 0.5) * BOARD.lawnHeight) / rows;
export const feetY = (row: number, rows: number) =>
  cellY(row, rows) + (BOARD.lawnHeight / rows) * 0.28;
export function cellAt(x: number, y: number, rows: number) {
  return {
    col: Math.floor((x - BOARD.left) / BOARD.cell),
    row: Math.floor((y - BOARD.top) / (BOARD.lawnHeight / rows)),
  };
}
export const healthFraction = (value: number, max: number) =>
  max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
