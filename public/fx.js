// @ts-check
/**
 * Small effects shared by the table and the tutorial (prototype art, not
 * rules): the clash icon, a dust puff, and a fight's tussle on a hex.
 */
export const CLASH = '<svg width="27" height="27" viewBox="0 0 9 9" shape-rendering="crispEdges"><path fill="#e0f2f4" d="M0 0h1v1h1v1h1v1h1v1H3V3H2V2H1V1H0zM8 0h1v1H8v1H7v1H6v1H5V3h1V2h1V1h1z"/><path fill="#f4b41a" d="M4 4h1v1H4zM3 5h1v1H3zM5 5h1v1H5zM2 6h1v1H2zM6 6h1v1H6z"/><path fill="#302b2d" d="M1 7h1v1h1v1H0V8h1zM7 7h1v1h1v1H6V8h1z"/></svg>';
export const DUST = '<svg width="18" height="12" viewBox="0 0 6 4" shape-rendering="crispEdges"><path fill="#a0948f" d="M2 0h2v1h1v1h1v2H0V2h1V1h1z"/><path fill="#e0f2f4" d="M2 1h1v1H2z"/></svg>';

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A tussle on a hex before the dead fly: it shakes, dust puffs, a little
 * blood, the clash icon (about a second). `holder` gets .is-tussling; the
 * effect is drawn inside `at` (the .hex). @param {Element} holder @param {Element} at @param {number} [ms]
 */
export function tussleOn(holder, at, ms = 1100) {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const fx = document.createElement('div');
  fx.className = 'tut-tussle';
  const puffs = [[-34, -10], [30, -14], [-20, 18], [26, 16], [0, -26]].map(([x, y], i) => `<span class="tut-dust" style="--dx:${x}px;--dy:${y}px;--d:${i * 70}ms">${DUST}</span>`).join('');
  const blood = [[-26, -30], [22, -34], [34, 4], [-36, 8], [10, 30], [-12, -38], [30, -20]].map(([x, y], i) => `<span class="tut-blood" style="--dx:${x}px;--dy:${y}px;--d:${200 + i * 50}ms"></span>`).join('');
  fx.innerHTML = `${puffs}${blood}<span class="tut-clash">${CLASH}</span>`;
  at.appendChild(fx);
  holder.classList.add('is-tussling');
  return sleep(ms).then(() => { fx.remove(); holder.classList.remove('is-tussling'); });
}
