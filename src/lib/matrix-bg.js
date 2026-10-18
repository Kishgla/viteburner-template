// Uses Bitburner's browser DOM, which is not part of the stable Netscript API.
// Changes to the game's terminal markup may require updates to the selectors here.
import getopts from './getopts.js';

const CELL_WIDTH = 14;
const CELL_HEIGHT = 16;
const FONT_SIZE = 14;
const DEFAULT_COLOR_SPREAD = 0;
const SINGLETON_KEY = '__viteburnerMatrixBackground';
const SINGLETON_VERSION = 3;

const OPTION_DEFINITIONS = {
  blur: { alias: 'b', type: 'string', default: 0, min: 0, max: 10 },
  color: { alias: 'c', type: 'string', default: 0 },
  delay: { alias: 'd', type: 'string', default: 33, min: 1, max: 10000 },
  help: { alias: 'h', type: 'boolean', default: false },
  opacity: { alias: 'o', type: 'string', default: 25, min: 0, max: 100 },
  rainbow: { alias: 'R', type: 'string', default: false, min: 1, max: 100, optionalValue: 10 },
  random: { alias: 'r', type: 'boolean', default: false },
  spread: { alias: 'S', type: 'string', default: DEFAULT_COLOR_SPREAD, min: 0, max: 360 },
  stop: { alias: 's', type: 'boolean', default: false },
  log: { alias: 'l', type: 'boolean', default: false },
};

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog('ALL');
  const opts = parseOptions(ns);

  const doc = eval('document');
  const win = eval('window');
  let existing = win[SINGLETON_KEY];
  let ownerIsRunning = isLiveOwner(ns, existing);

  if (opts.stop) {
    if (ownerIsRunning) {
      existing.stopRequested = true;
      ns.tprint(`${ns.getScriptName()}: stop requested for PID ${existing.pid}.`);
    } else {
      removeLegacyElements(doc);
      delete win[SINGLETON_KEY];
      ns.tprint(`${ns.getScriptName()}: no active matrix background was found.`);
    }
    return;
  }

  if (ownerIsRunning && existing.version !== SINGLETON_VERSION) {
    ns.kill(existing.pid);
    removeLegacyElements(doc);
    delete win[SINGLETON_KEY];
    ns.print(`WARN: Replaced incompatible matrix background PID ${existing.pid}.`);
    existing = undefined;
    ownerIsRunning = false;
  }

  if (ownerIsRunning) {
    existing.options = runtimeOptions(opts);
    existing.revision += 1;
    if (opts.log) ns.ui.openTail(existing.pid);
    ns.tprint(`${ns.getScriptName()}: updated matrix background PID ${existing.pid}.`);
    return;
  }

  if (existing !== undefined) {
    removeLegacyElements(doc);
    delete win[SINGLETON_KEY];
    ns.print('WARN: Removed stale matrix background singleton state.');
  }

  if (!findTerminalHost(doc)) {
    ns.tail();
    fail(ns, 'the terminal must be visible for the initial launch.');
  }

  const token = `${ns.pid}:${Date.now()}:${Math.random()}`;
  const state = {
    active: true,
    hostname: ns.getHostname(),
    options: runtimeOptions(opts),
    pid: ns.pid,
    revision: 0,
    stopRequested: false,
    token,
    version: SINGLETON_VERSION,
  };
  win[SINGLETON_KEY] = state;

  const renderer = createRenderer(doc, win, token, state.options);
  ns.atExit(() => cleanupOwner(doc, win, token, renderer));
  if (opts.log) ns.tail();
  printOptions(ns, state.options, 'Matrix terminal background started.');

  let activeOpts = state.options;
  let appliedRevision = state.revision;
  let rainbowStartedAt = Date.now();
  let wasAttached = false;

  while (!state.stopRequested) {
    if (appliedRevision !== state.revision) {
      activeOpts = state.options;
      appliedRevision = state.revision;
      rainbowStartedAt = Date.now();
      renderer.style.textContent = matrixCSS(activeOpts);
      recolorDrops(renderer, activeOpts);
      printOptions(ns, activeOpts, 'Matrix terminal background updated.');
    }

    const attached = attachToCurrentTerminal(renderer, activeOpts);
    if (!attached) {
      if (wasAttached) ns.print('INFO: Terminal hidden; matrix rendering paused.');
      wasAttached = false;
      await ns.sleep(250);
      continue;
    }

    if (!wasAttached) {
      if (renderer.hasRendered) ns.print('INFO: Terminal restored; matrix rendering resumed.');
      wasAttached = true;
    }

    if (doc.hidden || renderer.terminal.getClientRects().length === 0) {
      await ns.sleep(250);
      continue;
    }

    syncCanvasSize(renderer, activeOpts);
    drawFrame(renderer, activeOpts, rainbowStartedAt);
    renderer.hasRendered = true;
    await ns.sleep(activeOpts.delay);
  }
}

/** Parse and normalize all command-line options. */
function parseOptions(ns) {
  const opts = getopts(normalizeNegativeValueArgs(ns.args), getoptsConfiguration(ns));

  if (opts.help) showHelp(ns);
  if (opts._.length) fail(ns, 'too many positional arguments.');

  for (const name of ['blur', 'color', 'delay', 'opacity', 'spread']) {
    opts[name] = parseInteger(ns, name, opts[name], OPTION_DEFINITIONS[name]);
  }

  if (opts.rainbow === '') {
    opts.rainbow = OPTION_DEFINITIONS.rainbow.optionalValue;
  } else if (opts.rainbow !== false) {
    opts.rainbow = parseInteger(ns, 'rainbow', opts.rainbow, OPTION_DEFINITIONS.rainbow);
  }

  // Color accepts every integer and wraps it into the CSS hue range.
  opts.color = normalizeHue(opts.color);
  if (opts.random) opts.color = Math.floor(Math.random() * 360);
  return opts;
}

/** Preserve negative numeric values that getopts would otherwise treat as flags. */
function normalizeNegativeValueArgs(args) {
  const numericOptionNames = ['blur', 'color', 'delay', 'opacity', 'rainbow', 'spread'];
  const aliases = new Map(numericOptionNames.map((name) => [`-${OPTION_DEFINITIONS[name].alias}`, name]));
  const normalized = [];

  for (let index = 0; index < args.length; index++) {
    const argument = String(args[index]);
    const longName = argument.startsWith('--') ? argument.slice(2) : undefined;
    const optionName = numericOptionNames.includes(longName) ? longName : aliases.get(argument);
    const next = args[index + 1];
    const nextString = next === undefined ? '' : String(next);

    if (optionName && /^-(?:\d+(?:\.\d*)?|\.\d+|Infinity)$/.test(nextString)) {
      normalized.push(`--${optionName}=${nextString}`);
      index += 1;
    } else {
      normalized.push(argument);
    }
  }
  return normalized;
}

/** Validate one finite integer and return its numeric value. */
function parseInteger(ns, name, rawValue, definition) {
  const value = Number(rawValue);
  const belowMinimum = definition.min !== undefined && value < definition.min;
  const aboveMaximum = definition.max !== undefined && value > definition.max;

  if (
    rawValue === '' ||
    typeof rawValue === 'boolean' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    belowMinimum ||
    aboveMaximum
  ) {
    const range =
      definition.min === undefined ? 'an integer' : `an integer from ${definition.min} to ${definition.max}`;
    fail(ns, `${name} must be ${range}.`);
  }
  return value;
}

/** Build getopts configuration from the shared option definitions. */
function getoptsConfiguration(ns) {
  const config = {
    boolean: [],
    string: [],
    default: {},
    alias: {},
    unknown: (arg) => fail(ns, `invalid option: ${arg.length > 1 ? '--' : '-'}${arg}`),
  };

  for (const [name, definition] of Object.entries(OPTION_DEFINITIONS)) {
    config[definition.type].push(name);
    config.default[name] = definition.default;
    config.alias[name] = [definition.alias];
  }
  return config;
}

/** Return true only when the recorded singleton owner still exists. */
function isLiveOwner(ns, state) {
  return (
    state?.active === true &&
    Number.isInteger(state.pid) &&
    typeof state.hostname === 'string' &&
    ns.isRunning(state.pid, state.hostname)
  );
}

/** Copy only values consumed by the live renderer. */
function runtimeOptions(opts) {
  return {
    blur: opts.blur,
    color: opts.color,
    delay: opts.delay,
    opacity: opts.opacity,
    rainbow: opts.rainbow,
    spread: opts.spread,
  };
}

/** Create renderer state and its persistent stylesheet. */
function createRenderer(doc, win, token, opts) {
  const style = doc.createElement('style');
  style.id = 'matrix-css';
  style.textContent = matrixCSS(opts);
  doc.head.appendChild(style);

  return {
    canvas: undefined,
    chars: [],
    columns: [],
    container: undefined,
    ctx: undefined,
    doc,
    dpr: 0,
    hasRendered: false,
    height: 0,
    hues: [],
    observer: undefined,
    resetHeights: [],
    resizeRequested: true,
    style,
    terminal: undefined,
    token,
    width: 0,
    win,
  };
}

/** Locate the element pair used to mount the background. */
function findTerminalHost(doc) {
  const terminal = doc.querySelector('#terminal');
  const terminalWrapper = terminal?.parentElement;
  const container = terminalWrapper?.parentElement;
  return terminal && terminalWrapper && container ? { terminal, terminalWrapper, container } : undefined;
}

/** Attach to the current terminal, replacing stale DOM references when needed. */
function attachToCurrentTerminal(renderer, opts) {
  const host = findTerminalHost(renderer.doc);
  if (!host) {
    detachCanvas(renderer);
    return false;
  }

  const unchanged =
    renderer.canvas?.isConnected && renderer.container === host.container && renderer.terminal === host.terminal;
  if (unchanged) return true;

  detachCanvas(renderer);
  renderer.terminal = host.terminal;
  renderer.container = host.container;
  renderer.container.dataset.matrixBackground = renderer.token;

  const canvas = renderer.doc.createElement('canvas');
  canvas.id = 'matrix-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.container.insertBefore(canvas, host.terminalWrapper);

  renderer.canvas = canvas;
  renderer.ctx = canvas.getContext('2d');
  renderer.columns = [];
  renderer.chars = [];
  renderer.hues = [];
  renderer.resetHeights = [];
  renderer.resizeRequested = true;

  if (typeof renderer.win.ResizeObserver === 'function') {
    renderer.observer = new renderer.win.ResizeObserver(() => {
      renderer.resizeRequested = true;
    });
    renderer.observer.observe(host.container);
  }

  syncCanvasSize(renderer, opts);
  return true;
}

/** Resize for the terminal and device-pixel ratio, then reconcile columns. */
function syncCanvasSize(renderer, opts) {
  const width = Math.max(1, Math.floor(renderer.container.clientWidth));
  const height = Math.max(1, Math.floor(renderer.container.clientHeight));
  const dpr = Math.max(1, renderer.win.devicePixelRatio || 1);
  const dimensionsChanged = renderer.width !== width || renderer.height !== height || renderer.dpr !== dpr;

  if (renderer.resizeRequested || dimensionsChanged) {
    renderer.width = width;
    renderer.height = height;
    renderer.dpr = dpr;
    renderer.canvas.width = Math.round(width * dpr);
    renderer.canvas.height = Math.round(height * dpr);
    renderer.canvas.style.width = `${width}px`;
    renderer.canvas.style.height = `${height}px`;
    configureContext(renderer);
    reconcileColumns(renderer, opts);
    renderer.resizeRequested = false;
  }
}

/** Restore drawing settings that canvas resizing resets. */
function configureContext(renderer) {
  renderer.ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
  renderer.ctx.font = `${FONT_SIZE}px monospace`;
  renderer.ctx.textBaseline = 'top';
  renderer.ctx.shadowBlur = 2;
}

/** Add or remove rain columns to match the current canvas width. */
function reconcileColumns(renderer, opts) {
  const targetCount = Math.ceil(renderer.width / CELL_WIDTH);
  renderer.columns.length = Math.min(renderer.columns.length, targetCount);
  renderer.chars.length = renderer.columns.length;
  renderer.hues.length = renderer.columns.length;
  renderer.resetHeights.length = renderer.columns.length;

  while (renderer.columns.length < targetCount) {
    renderer.columns.push(0);
    renderer.chars.push('\u30a0');
    renderer.hues.push(dropHue(opts.color, opts.spread));
    renderer.resetHeights.push(nextResetHeight(renderer.height));
  }
}

/** Render one animation frame. */
function drawFrame(renderer, opts, rainbowStartedAt) {
  const ctx = renderer.ctx;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
  ctx.shadowColor = '#000';
  ctx.fillRect(0, 0, renderer.width, renderer.height);

  const rainbowOffset = opts.rainbow === false ? 0 : ((Date.now() - rainbowStartedAt) / (opts.rainbow * 1000)) * 360;

  for (let index = 0; index < renderer.columns.length; index++) {
    const x = index * CELL_WIDTH;
    const y = renderer.columns[index];
    const hue = normalizeHue(renderer.hues[index] + rainbowOffset);

    ctx.fillStyle = ctx.shadowColor = '#000';
    ctx.fillRect(x, y - CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT);
    ctx.fillStyle = ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;
    ctx.fillText(renderer.chars[index], x, y - CELL_HEIGHT);

    if (y > renderer.resetHeights[index]) {
      renderer.columns[index] = 0;
      renderer.hues[index] = dropHue(opts.color, opts.spread);
      renderer.resetHeights[index] = nextResetHeight(renderer.height);
    } else {
      renderer.columns[index] = y + CELL_HEIGHT;
    }

    renderer.chars[index] = String.fromCharCode(12448 + Math.floor(Math.random() * 96));
    ctx.fillStyle = ctx.shadowColor = `hsl(${hue}, 100%, 85%)`;
    ctx.fillText(renderer.chars[index], x, y);
  }
}

function nextResetHeight(canvasHeight) {
  return canvasHeight + Math.random() * Math.max(canvasHeight * 4, CELL_HEIGHT);
}

/** Reassign every stream within the currently configured color range. */
function recolorDrops(renderer, opts) {
  for (let index = 0; index < renderer.hues.length; index++) {
    renderer.hues[index] = dropHue(opts.color, opts.spread);
  }
}

function dropHue(baseHue, spread) {
  const greenHue = 120;
  return normalizeHue(greenHue + baseHue + (Math.random() - 0.5) * spread);
}

function normalizeHue(hue) {
  return ((hue % 360) + 360) % 360;
}

/** Remove only DOM state owned by this renderer instance. */
function detachCanvas(renderer) {
  renderer.observer?.disconnect();
  renderer.observer = undefined;
  renderer.canvas?.remove();

  if (renderer.container?.dataset.matrixBackground === renderer.token) {
    delete renderer.container.dataset.matrixBackground;
  }

  renderer.canvas = undefined;
  renderer.ctx = undefined;
  renderer.container = undefined;
  renderer.terminal = undefined;
}

function destroyRenderer(renderer) {
  if (!renderer) return;
  detachCanvas(renderer);
  renderer.style?.remove();
}

/** Clean up only if this process still owns the global singleton. */
function cleanupOwner(doc, win, token, renderer) {
  const state = win[SINGLETON_KEY];
  if (state?.token !== token) return;

  state.active = false;
  destroyRenderer(renderer);
  removeLegacyElements(doc);
  delete win[SINGLETON_KEY];
}

/** Remove artifacts left by stale or pre-singleton versions. */
function removeLegacyElements(doc) {
  doc.getElementById('matrix-canvas')?.remove();
  doc.getElementById('matrix-css')?.remove();
  doc.querySelector('[data-matrix-background]')?.removeAttribute('data-matrix-background');
  doc.getElementById('transparent-term')?.removeAttribute('id');
}

function matrixCSS(opts) {
  return [
    '[data-matrix-background] {',
    '  position: relative;',
    '  isolation: isolate;',
    '}',
    '[data-matrix-background] > :not(canvas#matrix-canvas) {',
    '  position: relative;',
    '  z-index: 1;',
    '  background-color: transparent !important;',
    '}',
    '[data-matrix-background] #terminal {',
    '  background-color: transparent !important;',
    '}',
    '[data-matrix-background] > canvas#matrix-canvas {',
    '  position: absolute;',
    '  inset: 0;',
    '  z-index: 0;',
    '  pointer-events: none;',
    `  opacity: ${opts.opacity}%;`,
    `  filter: blur(${opts.blur}px);`,
    '}',
  ].join('\n');
}

function printOptions(ns, opts, message) {
  ns.print(`INFO: ${message}`);
  ns.print(`INFO:  Delay: ${opts.delay}ms  Hue: ${opts.color}deg  Opacity: ${opts.opacity}%`);
  ns.print(`INFO:  Blur: ${opts.blur}px   Rainbow: ${opts.rainbow === false ? 'Off' : `${opts.rainbow}s`}`);
  ns.print(`INFO:  Color spread: ${opts.spread}deg`);
}

function fail(ns, message) {
  ns.tprint(`${ns.getScriptName()}: ERROR: ${message}`);
  showHelp(ns);
}

function showHelp(ns) {
  ns.tprint(`Usage: ${ns.getScriptName()} [OPTIONS]`);
  ns.tprint(
    [
      '',
      'Adds a multicolor Matrix-style background behind the visible terminal.',
      '',
      '  -b, --blur N         Blur in pixels from 0 to 10. (default: 0)',
      '  -c, --color DEG      Integer hue offset from green; values wrap modulo 360.',
      '  -d, --delay MS       Frame delay from 1 to 10000ms. (default: 33)',
      '  -o, --opacity PCT    Opacity from 0 to 100%. (default: 25)',
      '  -R, --rainbow [SEC]  Cycle colors in 1-100 seconds. (default: Off|10)',
      '  -S, --spread DEG     Per-drop color range from 0 to 360deg. (default: 0)',
      '',
      '  -r, --random         Choose a random hue offset; overrides --color.',
      '  -s, --stop           Stop the owner and remove its DOM elements.',
      '  -l, --log            Open the persistent renderer log.',
      '  -h, --help           Print this help.',
      '',
      'Examples:',
      `  run ${ns.getScriptName()}`,
      `  run ${ns.getScriptName()} --color 120 --spread 0`,
      `  run ${ns.getScriptName()} --random --spread 60`,
      `  run ${ns.getScriptName()} --rainbow 10 --opacity 40`,
      `  run ${ns.getScriptName()} --color 240 --delay 20`,
      `  run ${ns.getScriptName()} --stop`,
      '',
      'The initial launch requires the terminal view. Rendering pauses and reattaches',
      'when navigation temporarily removes or replaces the terminal DOM node.',
    ].join('\n'),
  );
  ns.exit();
}
