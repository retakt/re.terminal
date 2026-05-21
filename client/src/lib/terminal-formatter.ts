/**
 * Terminal Output Formatter (Hybrid Mode)
 * 
 * CONDITIONAL formatter that:
 * - Keeps normal log entries unchanged (timestamps, colored tags, severity labels)
 * - Only reformats raw terminal blobs containing control chars or unreadable output
 * 
 * Features:
 * - Sanitizes ANSI codes and control characters (only when needed)
 * - Converts \r sequences to real line breaks (for messy output)
 * - Adds Docker-style prefixes ([+], =>, #0, ERROR, WARNING) for build output
 * - Preserves original formatting for clean, structured logs
 */

/**
 * Strip ANSI escape codes from a string
 */
export function stripAnsiCodes(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

/**
 * Sanitize control characters while preserving meaningful ones
 * - Converts \r to line breaks (for overwrite sequences)
 * - Normalizes multiple newlines
 * - Removes other control characters except \t (for indentation)
 */
export function sanitizeControlChars(text: string): string {
  return text
    // Replace carriage returns with newlines (for progress overwrites)
    .replace(/\r+/g, '\n')
    // Normalize multiple newlines to single
    .replace(/\n{3,}/g, '\n\n')
    // Remove other control characters except tab
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Trim trailing whitespace from each line
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Detect if output needs pretty-printing (contains messy control chars or long blobs)
 */
export function needsPrettyPrint(rawOutput: string): boolean {
  // Check for escaped control character sequences (literal \r, \n in string)
  if (rawOutput.includes('\\r') || rawOutput.includes('\\n') || rawOutput.includes('\\t')) {
    return true;
  }
  
  // Check for actual control characters that make output unreadable
  if (/[\r\t\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(rawOutput)) {
    return true;
  }
  
  // Check for ANSI escape sequences
  if (/\u001b\[[0-9;?]*[ -/]*[@-~]/.test(rawOutput)) {
    return true;
  }
  
  // Check for extremely long single-line output (likely pasted build output)
  const lines = rawOutput.split('\n').filter(l => l.trim());
  if (lines.length === 1 && rawOutput.length > 500) {
    return true;
  }
  
  // Check for Docker/build-style patterns that benefit from vertical formatting
  if (/^(=>|\[.+\]|#\d+\s)/m.test(rawOutput) || rawOutput.includes('[+]')) {
    return true;
  }
  
  // Check for repeated \r patterns (progress bars, spinner output)
  if ((rawOutput.match(/\r/g) || []).length > 3) {
    return true;
  }
  
  return false;
}

/**
 * Split a long line into wrapped segments at word boundaries
 */
export function wrapLine(text: string, maxWidth: number = 80): string[] {
  if (text.length <= maxWidth) return [text];
  
  const lines: string[] = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= maxWidth) {
      lines.push(remaining);
      break;
    }
    
    // Find last space before maxWidth
    const cutIndex = remaining.lastIndexOf(' ', maxWidth);
    if (cutIndex > 0 && cutIndex < maxWidth) {
      lines.push(remaining.slice(0, cutIndex));
      remaining = remaining.slice(cutIndex + 1);
    } else {
      // No space found, hard break at maxWidth
      lines.push(remaining.slice(0, maxWidth));
      remaining = remaining.slice(maxWidth);
    }
  }
  
  return lines;
}

/**
 * Determine the prefix for a log line based on content analysis (Docker BuildKit style)
 */
export function getLinePrefix(line: string, context: {
  isFirst: boolean;
  hasError: boolean;
  hasWarning: boolean;
  isCommand: boolean;
  isOutput: boolean;
  stepNumber?: number;
}): string {
  const { isFirst, hasError, hasWarning, isCommand, isOutput, stepNumber = 0 } = context;
  
  // Error lines get ERROR prefix
  if (hasError || /error|failed|exception|fatal/i.test(line)) {
    return 'ERROR';
  }
  
  // Warning lines get WARNING prefix
  if (hasWarning || /warn|warning|deprecated/i.test(line)) {
    return 'WARNING';
  }
  
  // First line of a command gets [+] prefix
  if (isFirst && isCommand) {
    return '[+]';
  }
  
  // Subsequent command lines get => prefix
  if (isOutput) {
    return '=>';
  }
  
  // Running process output gets #N prefix
  if (stepNumber > 0) {
    return `#${stepNumber}`;
  }
  
  // Default: empty prefix for continuation lines
  return '  ';
}

/**
 * Format a raw terminal blob into structured vertical log entries (Docker BuildKit style)
 * ONLY use this for output that needsPrettyPrint() returns true for
 */
export function formatTerminalBlob(
  rawOutput: string,
  options: {
    maxWidth?: number;
    preserveTimestamps?: boolean;
    timestamp?: string;
    category?: string;
    action?: string;
    status?: string;
  } = {}
): FormattedLogEntry[] {
  const {
    maxWidth = 100,
    preserveTimestamps = true,
    timestamp,
    category,
    action,
    status
  } = options;
  
  // Step 1: Sanitize the raw output
  let cleaned = stripAnsiCodes(rawOutput);
  cleaned = sanitizeControlChars(cleaned);
  
  // Step 2: Split into lines
  const lines = cleaned.split('\n').filter(line => line.trim());
  
  if (lines.length === 0) return [];
  
  const entries: FormattedLogEntry[] = [];
  let stepNumber = 0;
  let inCommandBlock = false;
  
  for (let i = 0; i < lines.length; i++) {
    const originalLine = lines[i];
    const trimmed = originalLine.trim();
    
    if (!trimmed) continue;
    
    // Detect command vs output
    const isCommand = /^[a-z\/\\.:]+/.test(trimmed.toLowerCase()) && 
                      !/^\s*[\[\]#=>]/.test(trimmed) &&
                      trimmed.length < 200; // Commands are usually shorter
    const hasError = /error|failed|exception|fatal|killed|timeout/i.test(trimmed);
    const hasWarning = /warn|warning|deprecated|ignoring/i.test(trimmed);
    
    // Update step tracking
    if (isCommand && !inCommandBlock) {
      stepNumber++;
      inCommandBlock = true;
    } else if (!isCommand && inCommandBlock && trimmed.length < 50) {
      // Short line after command might be end of block
      inCommandBlock = false;
    }
    
    // Determine prefix
    const prefix = getLinePrefix(trimmed, {
      isFirst: i === 0 || (isCommand && !inCommandBlock),
      hasError,
      hasWarning,
      isCommand,
      isOutput: !isCommand,
      stepNumber: inCommandBlock ? stepNumber : 0
    });
    
    // Wrap long lines
    const wrappedLines = wrapLine(trimmed, maxWidth - prefix.length - 2);
    
    for (let j = 0; j < wrappedLines.length; j++) {
      const wrapped = wrappedLines[j];
      const displayPrefix = j === 0 ? prefix : '  '; // Indent continuation
      
      entries.push({
        prefix: displayPrefix,
        content: wrapped,
        level: hasError ? 'error' : hasWarning ? 'warning' : 'info',
        isCommand,
        stepNumber: inCommandBlock ? stepNumber : undefined,
        metadata: {
          timestamp: preserveTimestamps ? timestamp : undefined,
          category,
          action,
          status
        }
      });
    }
  }
  
  return entries;
}

/**
 * Main entry point: decides whether to format vertically or return original
 */
export function formatTerminalOutput(
  rawOutput: string,
  options: {
    maxWidth?: number;
    timestamp?: string;
    category?: string;
    action?: string;
    status?: string;
  } = {}
): FormattedLogEntry[] {
  // Only pretty-print if the output is messy/unreadable
  if (needsPrettyPrint(rawOutput)) {
    return formatTerminalBlob(rawOutput, options);
  }
  
  // Otherwise, return a single entry preserving original formatting
  // This keeps normal logs with timestamps, tags, etc. intact
  return [{
    prefix: '',
    content: rawOutput,
    level: (options.status as FormattedLogEntry['level']) || 'info',
    isCommand: false,
    metadata: {
      timestamp: options.timestamp,
      category: options.category,
      action: options.action,
      status: options.status
    }
  }];
}

export interface FormattedLogEntry {
  prefix: string;
  content: string;
  level: 'info' | 'warning' | 'error' | 'success';
  isCommand: boolean;
  stepNumber?: number;
  metadata?: {
    timestamp?: string;
    category?: string;
    action?: string;
    status?: string;
  };
}

/**
 * Helper: Get CSS class for log level
 */
export function getLevelClass(level: FormattedLogEntry['level']): string {
  switch (level) {
    case 'error': return 'log-error';
    case 'warning': return 'log-warning';
    case 'success': return 'log-success';
    default: return 'log-info';
  }
}

/**
 * Helper: Format timestamp for display
 */
export function formatTimestamp(ts?: string): string {
  if (!ts) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
