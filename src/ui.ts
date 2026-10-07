/**
 * How the stay looks in a terminal: colors, an icon per turn, the agent's
 * needs as little bars, and a spinner while it thinks or waits.
 *
 * Only what is printed is dressed up; the diary itself stays plain text,
 * because it is the agent's memory and goes to the model as is. Anywhere that
 * is not a terminal (CI, a pipe, the tests passing their own `log`), every
 * line comes out exactly as plain as before. NO_COLOR and FORCE_COLOR work as
 * usual.
 */
import { styleText } from 'node:util';
import type { State } from './world/observe.ts';
import type { NeedName } from './world/types.ts';

type Style = Parameters<typeof styleText>[0];

export interface TurnReport {
  turn: number;
  total: number;
  line: string;
  state: State;
  /** What the brain did this turn, in order. */
  acts: ReadonlyArray<{ name: string; ok: boolean }>;
}

export interface Ui {
  info(line: string): void;
  success(line: string): void;
  warn(line: string): void;
  error(line: string): void;
  turn(report: TurnReport): void;
  /** Bold, for something to copy. */
  strong(text: string): string;
  /** Underlined, for a URL. */
  link(text: string): string;
  /** Shows a spinner with `text` until the returned function is called. */
  busy(text: string | (() => string)): () => void;
}

const ICONS: Record<string, string> = {
  walk: '🚶',
  do_activity: '✨',
  start_conversation: '👋',
  respond: '🤝',
  say: '💬',
  leave_conversation: '🚪',
  end_vacation: '📮',
};

const NEEDS: Array<[NeedName, string]> = [
  ['energy', '⚡'],
  ['hunger', '🍔'],
  ['social', '💬'],
  ['fun', '🎉'],
];

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Plain lines through `log` when one is given or stdout is not a terminal; the fancy version otherwise. */
export function createUi(log?: (line: string) => void): Ui {
  if (log || !process.stdout.isTTY) return plainUi(log ?? console.log, log ?? console.error);
  // One for the whole program, so there is only ever one spinner to clear.
  return (terminal ??= terminalUi());
}

let terminal: Ui | undefined;

function plainUi(log: (line: string) => void, error: (line: string) => void): Ui {
  return {
    info: log,
    success: log,
    warn: log,
    error,
    turn: ({ turn, line }) => log(`[${turn}] ${line}`),
    strong: (text) => text,
    link: (text) => text,
    busy: () => () => {},
  };
}

function terminalUi(): Ui {
  const out = process.stdout;
  const paint = (style: Style, text: string) => styleText(style, text, { stream: out });
  let spinner: { timer: NodeJS.Timeout } | undefined;

  const clear = () => {
    if (!spinner) return;
    clearInterval(spinner.timer);
    spinner = undefined;
    out.write('\r\x1b[2K\x1b[?25h');
  };
  process.once('exit', clear);

  const print = (line: string, to = console.log) => {
    clear();
    to(line);
  };

  const bar = (value: number) => {
    const filled = Math.max(0, Math.min(5, Math.round(value / 20)));
    const color = value > 60 ? 'green' : value >= 30 ? 'yellow' : 'red';
    return paint(color, '▰'.repeat(filled)) + paint('dim', '▱'.repeat(5 - filled));
  };

  return {
    info: (line) => print(line),
    success: (line) => print(`${paint('green', '✔')} ${line}`),
    warn: (line) => print(paint('yellow', line)),
    error: (line) => print(paint('red', `✗ ${line}`), console.error),

    turn({ turn, total, line, state, acts }) {
      const refused = acts.some((a) => !a.ok);
      const last = acts.at(-1);
      const icon = refused ? '❌' : last ? (ICONS[last.name] ?? '•') : '💤';
      const count = paint('dim', `${String(turn + 1).padStart(String(total).length)}/${total}`);
      const where = `${paint(['bold', 'cyan'], state.here.name)} ${paint('dim', `· ${state.time}`)}`;
      const body = refused ? paint('red', line) : acts.length ? line : paint('dim', line);
      const needs = NEEDS.map(([need, emoji]) => `${emoji}${bar(state.you.needs[need])}`).join(' ');
      const indent = ' '.repeat(String(total).length * 2 + 3);
      print(`\n ${count}  ${icon}  ${where}\n${indent}${body}\n${indent}${needs}`);
    },

    strong: (text) => paint('bold', text),
    link: (text) => paint(['underline', 'blue'], text),

    busy(text) {
      clear();
      let frame = 0;
      const draw = () => {
        const label = typeof text === 'function' ? text() : text;
        out.write(`\r\x1b[2K ${paint('magenta', FRAMES[frame++ % FRAMES.length])} ${paint('dim', label)}`);
      };
      out.write('\x1b[?25l');
      draw();
      const mine = { timer: setInterval(draw, 80) };
      spinner = mine;
      return () => {
        if (spinner === mine) clear();
      };
    },
  };
}
