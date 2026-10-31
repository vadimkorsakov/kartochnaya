// Full layer snapshots are session-only: Escape restores typography, reference
// size and auto-fit along with characters. Document history still owns persistence.
const copy = value => JSON.parse(JSON.stringify(value));
export function createInlineHistory(element) {
  return { states: [{ element: copy(element), caret: null }], index: 0, formatted: false };
}
export function recordInlineHistory(history, element, caret) {
  const current = history.states[history.index];
  if (JSON.stringify(current.element) === JSON.stringify(element)) {
    current.caret = caret && copy(caret);
    return;
  }
  history.states.splice(history.index + 1);
  history.states.push({ element: copy(element), caret: caret && copy(caret) });
  history.index++;
}
export function moveInlineHistory(history, direction) {
  const next = history.index + direction;
  if (next < 0 || next >= history.states.length) return null;
  history.index = next;
  return copy(history.states[next]);
}
