import { useEffect, useRef } from 'react'

type Options = {
  runOnMount?: boolean
}

/**
 * Runs an interval only when the tab is active (visible + focused).
 * This reduces background polling and cuts Supabase egress.
 */
export function useVisibilityInterval(
  fn: () => void | Promise<void>,
  ms: number,
  deps: unknown[] = [],
  opts: Options = {}
): void {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let timer: number | null = null
    const isActive = () => document.visibilityState === 'visible' && document.hasFocus()

    const stop = () => {
      if (timer) window.clearInterval(timer)
      timer = null
    }

    const start = () => {
      stop()
      if (!isActive()) return
      timer = window.setInterval(() => void fnRef.current(), ms)
    }

    const onChange = () => {
      if (isActive()) start()
      else stop()
    }

    if (opts.runOnMount && isActive()) {
      void fnRef.current()
    }
    start()

    window.addEventListener('visibilitychange', onChange)
    window.addEventListener('focus', onChange)
    window.addEventListener('blur', onChange)

    return () => {
      stop()
      window.removeEventListener('visibilitychange', onChange)
      window.removeEventListener('focus', onChange)
      window.removeEventListener('blur', onChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, opts.runOnMount, ...deps])
}
