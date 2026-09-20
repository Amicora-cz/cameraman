// The demo keeps its state in localStorage, so a scenario can walk the whole
// flow (connect → write a note → see it listed) against static pages.
const KEY = "acme-demo";

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { connected: false, notes: [] }; }
  catch { return { connected: false, notes: [] }; }
}
function save(state) { localStorage.setItem(KEY, JSON.stringify(state)); }

window.acmeDemo = {
  load,
  save,
  reset() { localStorage.removeItem(KEY); },
};
