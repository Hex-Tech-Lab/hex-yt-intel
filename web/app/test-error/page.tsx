'use client'

import { useEffect } from 'react'

export default function TestErrorPage() {
  useEffect(() => {
    throw new Error('Sentry test error - This error is intentional for Sentry monitoring verification')
  }, [])

  return (
    <div className="p-8">
      <h1>Testing Sentry...</h1>
      <p>If you see this message, the test error was not triggered. Check the browser console.</p>
    </div>
  )
}
