import { useEffect, useCallback, RefObject } from "react"

interface KeyboardNavigationOptions {
  onEnter?: () => void
  onEscape?: () => void
  onArrowUp?: () => void
  onArrowDown?: () => void
  onArrowLeft?: () => void
  onArrowRight?: () => void
  onSpace?: () => void
  onTab?: (direction: "forward" | "backward") => void
  disabled?: boolean
}

/**
 * Hook for handling keyboard navigation events
 * Provides common keyboard shortcuts for interactive components
 */
export function useKeyboardNavigation(
  ref: RefObject<HTMLElement>,
  options: KeyboardNavigationOptions
) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (options.disabled) return

      // Ignore if user is typing in an input
      const target = event.target as HTMLElement
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true"

      switch (event.key) {
        case "Enter":
          if (options.onEnter && !isInput) {
            event.preventDefault()
            options.onEnter()
          }
          break
        case "Escape":
          if (options.onEscape) {
            event.preventDefault()
            options.onEscape()
          }
          break
        case "ArrowUp":
          if (options.onArrowUp) {
            event.preventDefault()
            options.onArrowUp()
          }
          break
        case "ArrowDown":
          if (options.onArrowDown) {
            event.preventDefault()
            options.onArrowDown()
          }
          break
        case "ArrowLeft":
          if (options.onArrowLeft) {
            event.preventDefault()
            options.onArrowLeft()
          }
          break
        case "ArrowRight":
          if (options.onArrowRight) {
            event.preventDefault()
            options.onArrowRight()
          }
          break
        case " ":
          if (options.onSpace && !isInput) {
            event.preventDefault()
            options.onSpace()
          }
          break
        case "Tab":
          if (options.onTab) {
            options.onTab(event.shiftKey ? "backward" : "forward")
          }
          break
      }
    },
    [options]
  )

  useEffect(() => {
    const element = ref.current
    if (!element) return

    element.addEventListener("keydown", handleKeyDown)
    return () => element.removeEventListener("keydown", handleKeyDown)
  }, [ref, handleKeyDown])
}

interface FocusTrapOptions {
  initialFocus?: RefObject<HTMLElement>
  restoreFocus?: boolean
}

/**
 * Hook for trapping focus within a modal or dialog
 * Prevents tab key from leaving the trapped container
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  options: FocusTrapOptions = {}
) {
  const { initialFocus, restoreFocus = true } = options
  const previousActiveElement = document.activeElement as HTMLElement | null

  useEffect(() => {
    const container = ref.current
    if (!container) return

    // Set initial focus
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const firstElement = (initialFocus?.current ||
      focusableElements[0]) as HTMLElement
    firstElement?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return

      const focusableList = Array.from(focusableElements) as HTMLElement[]
      const currentIndex = focusableList.indexOf(
        document.activeElement as HTMLElement
      )

      if (event.shiftKey) {
        // Shift + Tab: move backward
        if (currentIndex === 0) {
          event.preventDefault()
          focusableList[focusableList.length - 1]?.focus()
        }
      } else {
        // Tab: move forward
        if (currentIndex === focusableList.length - 1) {
          event.preventDefault()
          focusableList[0]?.focus()
        }
      }
    }

    container.addEventListener("keydown", handleKeyDown)

    return () => {
      container.removeEventListener("keydown", handleKeyDown)
      if (restoreFocus && previousActiveElement) {
        previousActiveElement.focus()
      }
    }
  }, [ref, initialFocus, restoreFocus])
}

interface FocusVisibleOptions {
  enabled?: boolean
}

/**
 * Hook to manage visible focus indicators (keyboard-only)
 * Shows focus indicators only when navigating with keyboard
 */
export function useFocusVisible(options: FocusVisibleOptions = {}) {
  const { enabled = true } = options

  useEffect(() => {
    if (!enabled) return

    let isUsingKeyboard = false

    const handleMouseDown = () => {
      isUsingKeyboard = false
      document.documentElement.classList.remove("focus-visible-active")
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore modifier keys
      if (
        event.key === "Control" ||
        event.key === "Alt" ||
        event.key === "Meta" ||
        event.key === "Shift"
      ) {
        return
      }
      isUsingKeyboard = true
      document.documentElement.classList.add("focus-visible-active")
    }

    window.addEventListener("mousedown", handleMouseDown)
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("mousedown", handleMouseDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [enabled])
}

/**
 * Get all focusable elements within a container
 */
export function getFocusableElements(
  container: HTMLElement,
  options: { includeHidden?: boolean } = {}
): HTMLElement[] {
  const { includeHidden = false } = options

  const selector = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(",")

  const elements = Array.from(
    container.querySelectorAll(selector)
  ) as HTMLElement[]

  if (includeHidden) return elements

  return elements.filter((el) => {
    const style = window.getComputedStyle(el)
    return style.display !== "none" && style.visibility !== "hidden"
  })
}
