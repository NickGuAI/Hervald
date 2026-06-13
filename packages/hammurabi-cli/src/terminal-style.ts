export type TerminalStatus = 'pass' | 'warn' | 'fail' | 'info'

const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'

const WORDMARK = [
  ' _   _ _____ ______     ___    _     ____  ',
  '| | | | ____|  _ \\ \\   / / \\  | |   |  _ \\ ',
  '| |_| |  _| | |_) \\ \\ / / _ \\ | |   | | | |',
  '|  _  | |___|  _ < \\ V / ___ \\| |___| |_| |',
  '|_| |_|_____|_| \\_\\ \\_/_/   \\_\\_____|____/ ',
]

function color(value: string, code: string): string {
  return `${code}${value}${RESET}`
}

function icon(status: TerminalStatus): string {
  if (status === 'pass') return color('✓', GREEN)
  if (status === 'warn') return color('!', YELLOW)
  if (status === 'fail') return color('x', RED)
  return color('>', CYAN)
}

export function printHervaldBrand(
  label: string,
  write: (chunk: string) => void = (chunk) => process.stdout.write(chunk),
): void {
  write(`${color(WORDMARK.join('\n'), CYAN)}\n`)
  write(`${color('Hervald', BOLD)} - operator-controlled agent fleet runtime\n`)
  write(`${color(label, DIM)}\n\n`)
}

export function formatStatusLine(
  status: TerminalStatus,
  name: string,
  message: string,
  hint?: string,
): string {
  const firstLine = `${icon(status)} ${color(name, BOLD)}: ${message}`
  return hint ? `${firstLine}\n  ${color(hint, DIM)}` : firstLine
}

export async function withTerminalSpinner<T>(
  label: string,
  task: () => Promise<T>,
  messages: {
    success?: string
    failure?: string
  } = {},
): Promise<T> {
  const frames = ['-', '\\', '|', '/']
  let frameIndex = 0
  const useSpinner = process.stdout.isTTY === true
  let timer: NodeJS.Timeout | null = null

  if (useSpinner) {
    process.stdout.write(`${color(frames[frameIndex], CYAN)} ${label}`)
    timer = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length
      process.stdout.write(`\r${color(frames[frameIndex], CYAN)} ${label}`)
    }, 80)
  } else {
    process.stdout.write(`${formatStatusLine('info', label, 'started')}\n`)
  }

  try {
    const result = await task()
    if (timer) clearInterval(timer)
    if (useSpinner) {
      process.stdout.write(`\r${formatStatusLine('pass', label, messages.success ?? 'done')}\n`)
    } else {
      process.stdout.write(`${formatStatusLine('pass', label, messages.success ?? 'done')}\n`)
    }
    return result
  } catch (error) {
    if (timer) clearInterval(timer)
    if (useSpinner) {
      process.stdout.write(`\r${formatStatusLine('fail', label, messages.failure ?? 'failed')}\n`)
    } else {
      process.stdout.write(`${formatStatusLine('fail', label, messages.failure ?? 'failed')}\n`)
    }
    throw error
  }
}
