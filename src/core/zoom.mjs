// Desktop steps are strict neighbours on the 10 percentage point grid.
export function nextZoom(zoom, direction, mobile = false) {
  const percent = zoom * 100;
  // Ignore binary floating point residue at an exact grid boundary.
  const grid = Math.round((percent / 10) * 1e9) / 1e9;
  const next = mobile ? Math.round(percent + direction * 3)
    : (direction > 0 ? Math.floor(grid) + 1 : Math.ceil(grid) - 1) * 10;
  return Math.min(800, Math.max(4, next)) / 100;
}

export function parseZoomPercent(value) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const percent = Number(text);
  return Number.isInteger(percent) && percent >= 4 && percent <= 800 ? percent / 100 : null;
}
