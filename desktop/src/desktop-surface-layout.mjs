export const DESKTOP_ORB_WIDTH = 172
export const DESKTOP_ORB_HEIGHT = 204
export const DESKTOP_PANEL_WIDTH = 440
export const DESKTOP_PANEL_HEIGHT = 680
export const DESKTOP_TASK_SURFACE_WIDTH = 360
export const DESKTOP_TASK_CARD_HEIGHT = 54
export const DESKTOP_TASK_CARD_GAP = 8
export const DESKTOP_TASK_STACK_PADDING = 8
export const DESKTOP_TASK_STACK_LIFT = 14
const DESKTOP_TASK_PLACEMENT_HYSTERESIS = 48
// The visible orb is ~92px centred in the 172×204 transparent window. Snapping
// flushes the visual — not the window — to the screen edge, so the window may
// sit partially off-screen by exactly the padding amount.
export const DESKTOP_ORB_VISUAL_SIZE = 92
export const DESKTOP_ORB_VISUAL_PAD_X = Math.round((DESKTOP_ORB_WIDTH - DESKTOP_ORB_VISUAL_SIZE) / 2)
export const DESKTOP_ORB_VISUAL_PAD_Y = Math.round((DESKTOP_ORB_HEIGHT - DESKTOP_ORB_VISUAL_SIZE) / 2)

// Electron's V8 int conversion rejects -0 with an opaque "conversion failure"
// TypeError, and Math.round(-0.2) yields exactly that while JSON logs it as
// plain 0 — every coordinate handed to setPosition/setBounds goes through
// this. (The || also defuses NaN from a destroyed-window read.)
export function windowAxis(value) {
  return Math.round(value) || 0
}
export const DESKTOP_ORB_SNAP_DISTANCE = 96
export const DESKTOP_ORB_EDGE_MARGIN = 8

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(minimum, value), maximum)
}

// Quadrant-aware panel placement: the panel opens toward the roomier screen
// half so the orb stays exactly where the user left it — above the panel when
// the orb sits near the bottom, right of it when near the left edge.
export function desktopConversationPanelBounds({
  orbBounds,
  workArea,
  width = DESKTOP_PANEL_WIDTH,
  height = DESKTOP_PANEL_HEIGHT,
}) {
  const panelWidth = Math.min(width, workArea.width)
  const panelHeight = Math.min(height, workArea.height)
  const orbCenterX = orbBounds.x + orbBounds.width / 2
  const orbCenterY = orbBounds.y + orbBounds.height / 2
  const growLeft = orbCenterX >= workArea.x + workArea.width / 2
  const growDown = orbCenterY < workArea.y + workArea.height / 2
  return {
    x: clamp(
      growLeft ? orbBounds.x + orbBounds.width - panelWidth : orbBounds.x,
      workArea.x,
      workArea.x + workArea.width - panelWidth,
    ),
    y: clamp(
      growDown ? orbBounds.y : orbBounds.y + orbBounds.height - panelHeight,
      workArea.y,
      workArea.y + workArea.height - panelHeight,
    ),
    width: panelWidth,
    height: panelHeight,
    anchor: {
      horizontal: growLeft ? 'right' : 'left',
      vertical: growDown ? 'top' : 'bottom',
    },
  }
}

// Collapsing returns the orb to the corner of the panel it was anchored to
// when the panel opened — not always the top-right.
export function desktopOrbAnchorFromPanel({ bounds, workArea, anchor }) {
  const horizontal = anchor?.horizontal === 'left' ? 'left' : 'right'
  const vertical = anchor?.vertical === 'bottom' ? 'bottom' : 'top'
  return {
    x: clamp(
      horizontal === 'right'
        ? bounds.x + bounds.width - DESKTOP_ORB_WIDTH
        : bounds.x,
      workArea.x,
      workArea.x + workArea.width - DESKTOP_ORB_WIDTH,
    ),
    y: clamp(
      vertical === 'top'
        ? bounds.y
        : bounds.y + bounds.height - DESKTOP_ORB_HEIGHT,
      workArea.y,
      workArea.y + workArea.height - DESKTOP_ORB_HEIGHT,
    ),
    width: DESKTOP_ORB_WIDTH,
    height: DESKTOP_ORB_HEIGHT,
  }
}

// Edge snap after a drag: flush the orb VISUAL (not the transparent window)
// to the nearest screen edge when dropped within the snap distance.
export function desktopOrbSnapPosition({ x, y }, workArea) {
  const snap = { x, y }
  const visualLeft = x + DESKTOP_ORB_VISUAL_PAD_X
  const visualRight = visualLeft + DESKTOP_ORB_VISUAL_SIZE
  const visualTop = y + DESKTOP_ORB_VISUAL_PAD_Y
  const visualBottom = visualTop + DESKTOP_ORB_VISUAL_SIZE
  if (visualLeft - workArea.x < DESKTOP_ORB_SNAP_DISTANCE) {
    snap.x = workArea.x + DESKTOP_ORB_EDGE_MARGIN - DESKTOP_ORB_VISUAL_PAD_X
  } else if (workArea.x + workArea.width - visualRight < DESKTOP_ORB_SNAP_DISTANCE) {
    snap.x = workArea.x + workArea.width - DESKTOP_ORB_EDGE_MARGIN
      - DESKTOP_ORB_VISUAL_SIZE - DESKTOP_ORB_VISUAL_PAD_X
  }
  if (visualTop - workArea.y < DESKTOP_ORB_SNAP_DISTANCE) {
    snap.y = workArea.y + DESKTOP_ORB_EDGE_MARGIN - DESKTOP_ORB_VISUAL_PAD_Y
  } else if (workArea.y + workArea.height - visualBottom < DESKTOP_ORB_SNAP_DISTANCE) {
    snap.y = workArea.y + workArea.height - DESKTOP_ORB_EDGE_MARGIN
      - DESKTOP_ORB_VISUAL_SIZE - DESKTOP_ORB_VISUAL_PAD_Y
  }
  return snap
}

function normalizedTaskCount(value) {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function taskSurfaceHeight(taskCount) {
  const count = normalizedTaskCount(taskCount)
  if (count === 0) return 0
  const stackHeight = (
    count * DESKTOP_TASK_CARD_HEIGHT
    + Math.max(0, count - 1) * DESKTOP_TASK_CARD_GAP
    + DESKTOP_TASK_STACK_PADDING * 2
  )
  return stackHeight - DESKTOP_TASK_STACK_LIFT
}

export function desktopSurfaceSize(taskCount, {
  taskAreaHeight = Number.POSITIVE_INFINITY,
  workAreaHeight,
} = {}) {
  const count = normalizedTaskCount(taskCount)
  if (count === 0) {
    return { width: DESKTOP_ORB_WIDTH, height: DESKTOP_ORB_HEIGHT }
  }
  const legacyAvailableHeight = Number.isFinite(workAreaHeight)
    ? Math.max(0, workAreaHeight - DESKTOP_ORB_HEIGHT)
    : Number.POSITIVE_INFINITY
  const availableHeight = Number.isFinite(taskAreaHeight)
    ? Math.max(0, taskAreaHeight)
    : legacyAvailableHeight
  return {
    width: DESKTOP_TASK_SURFACE_WIDTH,
    height: DESKTOP_ORB_HEIGHT + Math.min(
      taskSurfaceHeight(count),
      availableHeight,
    ),
  }
}

export function desktopOrbBounds(bounds, {
  taskCount = 0,
  placement = 'below',
  orbOffsetX,
} = {}) {
  const hasTaskSurface = normalizedTaskCount(taskCount) > 0
  const horizontalOffset = hasTaskSurface && Number.isFinite(orbOffsetX)
    ? orbOffsetX
    : Math.round((bounds.width - DESKTOP_ORB_WIDTH) / 2)
  return {
    x: bounds.x + horizontalOffset,
    y: hasTaskSurface && placement === 'above'
      ? bounds.y + bounds.height - DESKTOP_ORB_HEIGHT
      : bounds.y,
    width: DESKTOP_ORB_WIDTH,
    height: DESKTOP_ORB_HEIGHT,
  }
}

export function desktopTaskPlacement({
  orbBounds,
  workArea,
  taskCount,
  placement = 'below',
}) {
  if (normalizedTaskCount(taskCount) === 0) return placement
  const requestedHeight = taskSurfaceHeight(taskCount)
  const availableAbove = Math.max(0, orbBounds.y - workArea.y)
  const availableBelow = Math.max(0, (
    workArea.y + workArea.height
    - orbBounds.y - orbBounds.height
  ))
  const aboveFits = availableAbove >= requestedHeight
  const belowFits = availableBelow >= requestedHeight

  if (aboveFits && !belowFits) return 'above'
  if (belowFits && !aboveFits) return 'below'

  // Prefer the roomier side, but retain the current direction in a narrow
  // band around the screen midpoint so a small drag does not make cards jump.
  if (
    Math.abs(availableAbove - availableBelow)
    <= DESKTOP_TASK_PLACEMENT_HYSTERESIS
  ) return placement
  return availableAbove > availableBelow ? 'above' : 'below'
}

export function desktopSurfaceLayout({
  bounds,
  currentTaskCount = 0,
  taskCount = 0,
  placement = 'below',
  orbOffsetX,
  workArea,
}) {
  const currentOrb = desktopOrbBounds(bounds, {
    taskCount: currentTaskCount,
    placement,
    orbOffsetX,
  })
  const orbBounds = {
    ...currentOrb,
    x: clamp(
      currentOrb.x,
      workArea.x,
      workArea.x + workArea.width - DESKTOP_ORB_WIDTH,
    ),
    y: clamp(
      currentOrb.y,
      workArea.y,
      workArea.y + workArea.height - DESKTOP_ORB_HEIGHT,
    ),
  }
  const nextPlacement = desktopTaskPlacement({
    orbBounds,
    workArea,
    taskCount,
    placement,
  })
  const taskAreaHeight = nextPlacement === 'above'
    ? orbBounds.y - workArea.y
    : workArea.y + workArea.height - orbBounds.y - orbBounds.height
  const size = desktopSurfaceSize(taskCount, { taskAreaHeight })
  const x = clamp(
    orbBounds.x - Math.round((size.width - DESKTOP_ORB_WIDTH) / 2),
    workArea.x,
    workArea.x + workArea.width - size.width,
  )
  const y = normalizedTaskCount(taskCount) > 0 && nextPlacement === 'above'
    ? orbBounds.y + DESKTOP_ORB_HEIGHT - size.height
    : orbBounds.y

  return {
    bounds: { x: windowAxis(x), y: windowAxis(y), width: size.width, height: size.height },
    placement: nextPlacement,
    orbOffsetX: normalizedTaskCount(taskCount) > 0
      ? orbBounds.x - x
      : 0,
  }
}
