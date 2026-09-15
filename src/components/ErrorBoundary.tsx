import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: React.ReactNode
  title?: string
  fullscreen?: boolean
  onReset?: () => void
}

interface State {
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo })
    console.error('[ErrorBoundary]', error, errorInfo)
  }
  render() {
    if (this.state.error) {
      const { title = 'Something went wrong', fullscreen = true } = this.props
      const container = fullscreen
        ? 'min-h-full bg-gray-950 flex items-center justify-center p-6'
        : 'w-full flex items-center justify-center p-6'
      return (
        <div className={container}>
          <div className="max-w-sm w-full bg-red-500/10 border border-red-500/20 rounded-2xl p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={26} className="text-red-400" />
            </div>
            <h2 className="text-lg font-bold text-red-400 mb-2">{title}</h2>
            <p className="text-gray-400 text-sm mb-1">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <p className="text-gray-600 text-xs mb-6">
              If this keeps happening, contact your system administrator.
            </p>
            <button
              onClick={() => {
                this.setState({ error: null, errorInfo: null })
                this.props.onReset?.()
              }}
              className="flex items-center gap-2 mx-auto bg-amber-500 hover:bg-amber-400 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
            >
              <RefreshCw size={14} /> Reload screen
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
