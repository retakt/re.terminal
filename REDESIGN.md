# re.Term Redesign Specification

## Overview
Redesign the `re.Term` frontend to provide a VS Code-like terminal experience. This includes a tabbed interface for multiple terminal instances, a management bar for quick actions, and a responsive, independent scrolling container.

## Architecture

### 1. Layout Structure
- **Main Container**: A full-screen flex container (`h-screen`, `w-screen`, `overflow-hidden`).
- **Header/Tabs Area**: A horizontal scrollable area at the top for terminal tabs, mimicking VS Code's editor tabs.
- **Terminal Area**: A central area that hosts the active xterm.js instance.
- **Management Bar**: A floating or docked bar at the bottom (using `animate-ui`) for terminal controls.

### 2. Components

#### `TerminalTabs`
- Displays a list of open terminal instances.
- Supports switching between terminals.
- "Add" button to create new instances.
- "Close" button on each tab.

#### `TerminalInstance`
- Wraps the `@xterm/xterm` component.
- Manages its own connection state via `TerminalContext`.
- Fits perfectly within its parent container using `FitAddon`.

#### `ManagementBar` (from `animate-ui`)
- **Pagination/Navigation**: Switch between terminal instances.
- **Actions**:
  - `Ban` -> Clear Terminal.
  - `X` -> Close Terminal.
  - `IdCard` -> Terminal Info/Status.
  - `Move to` -> Custom command execution or session migration.

### 3. State Management (`TerminalContext`)
- `terminalList`: Array of active terminal objects `{ id, title, status }`.
- `activeTerminalId`: ID of the currently visible terminal.
- `createTerminal()`: Request backend to spawn a new PTY.
- `closeTerminal(id)`: Request backend to kill a PTY.
- `switchTerminal(id)`: Update local UI and notify backend of active focus.

### 4. Responsive Design
- **Desktop**: Tabs at top, Management Bar at bottom.
- **Mobile**: Management Bar becomes the primary navigation tool; tabs might be hidden or collapsed into a menu.
- **Scrolling**: The terminal container handles its own scrolling; the main page remains fixed.

## Implementation Plan

1.  **Setup**: Install dependencies (`lucide-react`, `motion`, `clsx`, `tailwind-merge`).
2.  **Context Update**: Enhance `TerminalProvider` to handle multiple named instances.
3.  **Component Creation**:
    - Create `TerminalTabs.tsx`.
    - Create `TerminalContainer.tsx` (the independent scrolling wrapper).
    - Implement `ManagementBar.tsx` using the provided example.
4.  **Integration**: Assemble the components in `App.tsx` (or `main.tsx`).
5.  **Refinement**: Apply VS Code-like styling (dark theme, specific borders, hover states).
