import { useEffect, useRef, useState } from 'react'
import {
  getDefaultInstanceUrl,
  getStoredInstanceUrl,
  isCapacitorNative,
  isValidInstanceUrl,
  normalizeInstanceUrl,
  parsePairingInvitePayload,
  setStoredInstanceUrl,
} from '@/lib/api-base'

type BarcodeDetectorResult = { rawValue?: string }
type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>
}
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance
type JsQr = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: 'attemptBoth' | 'dontInvert' | 'onlyInvert' | 'invertFirst' },
) => { data: string } | null

function getBarcodeDetector(): BarcodeDetectorConstructor | null {
  const candidate = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector
  return typeof candidate === 'function'
    ? candidate as BarcodeDetectorConstructor
    : null
}

async function loadJsQr(): Promise<JsQr> {
  const module = await import('jsqr')
  return module.default
}

function decodeVideoFrameWithJsQr(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  jsQr: JsQr,
): string | null {
  const width = video.videoWidth
  const height = video.videoHeight
  if (width <= 0 || height <= 0) {
    return null
  }

  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  context.drawImage(video, 0, 0, width, height)
  const imageData = context.getImageData(0, 0, width, height)
  return jsQr(imageData.data, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null
}

async function decodeVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  detector: BarcodeDetectorInstance | null,
  jsQr: JsQr,
): Promise<string | null> {
  if (detector) {
    try {
      const detected = await detector.detect(video)
      const rawValue = detected.find((item) => typeof item.rawValue === 'string')?.rawValue
      if (rawValue) {
        return rawValue
      }
    } catch {
      // Fall through to the canvas decoder below.
    }
  }

  return decodeVideoFrameWithJsQr(video, canvas, jsQr)
}

/**
 * Connect screen. Used when Auth0 is disabled or when running in Capacitor
 * (where Auth0 checkSession hangs in the WebView).
 *
 * On native (Capacitor), the user can paste a pairing invite or manually enter
 * an instance URL (hosted Hervald or a self-hosted Hammurabi) and credential.
 * The URL is verified against `/api/modules` and the mobile scope endpoint
 * before either value is persisted, so a bad URL or key never leaves partial
 * state behind.
 *
 * On web, the URL field is hidden — the page is served from a specific
 * instance and relative URLs target that same host.
 */
export function ApiKeyLandingPage({
  onApiKeySubmit,
}: {
  onApiKeySubmit: (key: string) => void
}) {
  const isNative = isCapacitorNative()
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null)
  const scannerCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const scannerStreamRef = useRef<MediaStream | null>(null)
  const scannerTimerRef = useRef<number | null>(null)
  const [instanceUrl, setInstanceUrl] = useState(
    () => getStoredInstanceUrl() ?? '',
  )
  const [pairingInvite, setPairingInvite] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const canSubmit = isNative
    ? Boolean(pairingInvite.trim() || (instanceUrl.trim() && apiKey.trim()))
    : Boolean(apiKey.trim())

  function stopScanner() {
    if (scannerTimerRef.current !== null) {
      window.clearTimeout(scannerTimerRef.current)
      scannerTimerRef.current = null
    }
    scannerStreamRef.current?.getTracks().forEach((track) => track.stop())
    scannerStreamRef.current = null
    if (scannerVideoRef.current) {
      scannerVideoRef.current.srcObject = null
    }
    setIsScanning(false)
  }

  useEffect(() => () => {
    if (scannerTimerRef.current !== null) {
      window.clearTimeout(scannerTimerRef.current)
      scannerTimerRef.current = null
    }
    scannerStreamRef.current?.getTracks().forEach((track) => track.stop())
    scannerStreamRef.current = null
    if (scannerVideoRef.current) {
      scannerVideoRef.current.srcObject = null
    }
  }, [])

  async function validateConnection(instanceBaseUrl: string, credential: string): Promise<boolean> {
    const authHeaders = { 'X-Hammurabi-Api-Key': credential }
    const modulesResponse = await fetch(`${instanceBaseUrl}/api/modules`, {
      headers: authHeaders,
    })
    if (modulesResponse.status === 401) {
      setSubmitError('Invalid API key. Check the key and try again.')
      return false
    }
    if (modulesResponse.status === 403) {
      setSubmitError('API key is missing required mobile access scopes.')
      return false
    }
    if (!modulesResponse.ok) {
      setSubmitError(`Server returned ${modulesResponse.status}. Try again or check the instance.`)
      return false
    }

    const verifyResponse = await fetch(`${instanceBaseUrl}/api/auth/mobile/verify`, {
      headers: authHeaders,
    })
    if (verifyResponse.status === 401) {
      setSubmitError('Invalid API key. Check the key and try again.')
      return false
    }
    if (verifyResponse.status === 403) {
      setSubmitError('API key is missing required mobile access scopes.')
      return false
    }
    if (verifyResponse.status === 404) {
      setSubmitError('This instance does not support mobile access verification yet.')
      return false
    }
    if (!verifyResponse.ok) {
      setSubmitError(`Server returned ${verifyResponse.status}. Try again or check the instance.`)
      return false
    }

    return true
  }

  async function handlePasteInvite() {
    setSubmitError(null)
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      setSubmitError('Clipboard paste is unavailable. Paste the invite payload manually.')
      return
    }

    try {
      const pasted = await navigator.clipboard.readText()
      setPairingInvite(pasted)
      const invite = parsePairingInvitePayload(pasted)
      if (invite) {
        setInstanceUrl(invite.instanceUrl)
        setApiKey(invite.apiKey)
      } else if (pasted.trim()) {
        setSubmitError('Pairing invite must include an instance URL and API key or token.')
      }
    } catch {
      setSubmitError('Clipboard paste was blocked. Paste the invite payload manually.')
    }
  }

  async function handleScanInvite() {
    setSubmitError(null)
    setScannerError(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerError('QR scanning is unavailable. Paste the invite payload instead.')
      return
    }

    let jsQr: JsQr
    try {
      jsQr = await loadJsQr()
    } catch {
      setScannerError('QR scanning is unavailable. Paste the invite payload instead.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      scannerStreamRef.current = stream
      setIsScanning(true)

      const video = scannerVideoRef.current
      const canvas = scannerCanvasRef.current
      if (!video || !canvas) {
        stopScanner()
        setScannerError('QR scanner could not start. Paste the invite payload instead.')
        return
      }

      video.srcObject = stream
      await video.play()

      const BarcodeDetector = getBarcodeDetector()
      const detector = BarcodeDetector ? new BarcodeDetector({ formats: ['qr_code'] }) : null
      const scanFrame = async () => {
        if (!scannerStreamRef.current || !scannerVideoRef.current) {
          return
        }

        try {
          const rawValue = await decodeVideoFrame(scannerVideoRef.current, canvas, detector, jsQr)
          if (rawValue) {
            const invite = parsePairingInvitePayload(rawValue)
            if (!invite) {
              setScannerError('Scanned code is not a Hammurabi mobile invite.')
            } else {
              setPairingInvite(rawValue)
              setInstanceUrl(invite.instanceUrl)
              setApiKey(invite.apiKey)
              setScannerError(null)
              stopScanner()
              return
            }
          }
        } catch {
          // Keep scanning; individual frame failures are common while the camera warms up.
        }

        scannerTimerRef.current = window.setTimeout(scanFrame, 400)
      }

      void scanFrame()
    } catch {
      stopScanner()
      setScannerError('Camera access was blocked. Paste the invite payload instead.')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedKey = apiKey.trim()

    let verifyUrl: string
    let keyToSubmit = trimmedKey
    let instanceUrlToStore = normalizeInstanceUrl(instanceUrl)

    if (isNative) {
      const hasManualCredentials = Boolean(instanceUrlToStore && keyToSubmit)
      if (!hasManualCredentials) {
        const invite = parsePairingInvitePayload(pairingInvite)
        if (!invite) {
          setSubmitError('Pairing invite must include an instance URL and API key or token.')
          return
        }
        instanceUrlToStore = invite.instanceUrl
        keyToSubmit = invite.apiKey
      }

      if (!keyToSubmit) {
        setSubmitError('Paste an API key or pairing invite.')
        return
      }
      if (!isValidInstanceUrl(instanceUrlToStore)) {
        setSubmitError('Enter a valid instance URL like https://hervald.gehirn.ai.')
        return
      }
      verifyUrl = `${instanceUrlToStore}/api/modules`
    } else {
      if (!keyToSubmit) return
      verifyUrl = '/api/modules'
    }

    setSubmitError(null)
    setIsSubmitting(true)
    try {
      if (isNative) {
        const valid = await validateConnection(instanceUrlToStore, keyToSubmit)
        if (!valid) {
          return
        }
      } else {
        const res = await fetch(verifyUrl, {
          headers: { 'X-Hammurabi-Api-Key': keyToSubmit },
        })
        if (res.status === 401) {
          setSubmitError('Invalid API key. Check the key and try again.')
          return
        }
        if (res.status === 403) {
          setSubmitError('API key is missing required scopes (agents and services).')
          return
        }
        if (!res.ok) {
          setSubmitError(`Server returned ${res.status}. Try again or check the instance.`)
          return
        }
      }

      if (isNative) {
        setStoredInstanceUrl(instanceUrlToStore)
      }
      onApiKeySubmit(keyToSubmit)
    } catch {
      setSubmitError('Connection failed. Check the URL and your network.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--hv-bg-raised)]">
      <div className="card-sumi max-w-lg w-full mx-4 p-8 sm:p-12 animate-fade-in">
        <h1 className="font-display text-display text-[color:var(--hv-fg)] mb-2 text-center">
          Hervald
        </h1>
        <p className="text-sm font-body text-[color:var(--hv-fg-subtle)] mb-6 text-center">
          {isNative ? 'Connect to your Hervald instance' : 'Sign in with API key'}
        </p>

        <div className="divider-ink mb-6" />

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {isNative && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-1">
                <label
                  htmlFor="pairing-invite"
                  className="block text-xs font-body text-[color:var(--hv-fg-subtle)] uppercase tracking-wide"
                >
                  Pairing Invite
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleScanInvite}
                    className="text-xs font-body text-[color:var(--hv-accent)] hover:text-[color:var(--hv-fg)] disabled:opacity-50"
                    disabled={isSubmitting || isScanning}
                  >
                    Scan QR
                  </button>
                  <button
                    type="button"
                    onClick={handlePasteInvite}
                    className="text-xs font-body text-[color:var(--hv-accent)] hover:text-[color:var(--hv-fg)] disabled:opacity-50"
                    disabled={isSubmitting}
                  >
                    Paste Invite
                  </button>
                </div>
              </div>
              <video
                ref={scannerVideoRef}
                className={isScanning
                  ? 'mb-3 aspect-[4/3] w-full rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] object-cover'
                  : 'hidden'}
                playsInline
                muted
              />
              <canvas ref={scannerCanvasRef} className="hidden" aria-hidden="true" />
              {isScanning && (
                <button
                  type="button"
                  onClick={stopScanner}
                  className="btn-ghost mb-3 w-full"
                >
                  Stop scanning
                </button>
              )}
              {scannerError && (
                <p className="mb-3 text-sm text-[color:var(--hv-accent-danger)]" role="alert">
                  {scannerError}
                </p>
              )}
              <textarea
                id="pairing-invite"
                placeholder='{"instanceUrl":"https://hervald.gehirn.ai","apiKey":"..."}'
                value={pairingInvite}
                onChange={(e) => setPairingInvite(e.target.value)}
                className="w-full min-h-24 px-4 py-3 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] font-mono text-xs text-[color:var(--hv-fg)] placeholder:text-[color:var(--hv-fg-faint)] focus:outline-none focus:ring-2 focus:ring-[color:var(--hv-field-focus-border)]"
                autoComplete="off"
                disabled={isSubmitting}
                spellCheck={false}
              />
            </div>
          )}

          {isNative && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-1">
                <label
                  htmlFor="instance-url"
                  className="block text-xs font-body text-[color:var(--hv-fg-subtle)] uppercase tracking-wide"
                >
                  Instance URL
                </label>
                <button
                  type="button"
                  onClick={() => setInstanceUrl(getDefaultInstanceUrl())}
                  className="text-xs font-body text-[color:var(--hv-accent)] hover:text-[color:var(--hv-fg)] disabled:opacity-50"
                  disabled={isSubmitting}
                >
                  Hosted Hervald
                </button>
              </div>
              <input
                id="instance-url"
                type="url"
                placeholder={getDefaultInstanceUrl()}
                value={instanceUrl}
                onChange={(e) => setInstanceUrl(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] text-[color:var(--hv-fg)] placeholder:text-[color:var(--hv-fg-faint)] focus:outline-none focus:ring-2 focus:ring-[color:var(--hv-field-focus-border)]"
                autoComplete="url"
                inputMode="url"
                disabled={isSubmitting}
                required={!pairingInvite.trim()}
              />
            </div>
          )}

          <div>
            {isNative && (
              <label
                htmlFor="api-key"
                className="block text-xs font-body text-[color:var(--hv-fg-subtle)] mb-1 uppercase tracking-wide"
              >
                API Key
              </label>
            )}
            <input
              id="api-key"
              type="password"
              placeholder={isNative ? 'Paste your API key or token' : 'Paste your API key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] text-[color:var(--hv-fg)] placeholder:text-[color:var(--hv-fg-faint)] focus:outline-none focus:ring-2 focus:ring-[color:var(--hv-field-focus-border)]"
              autoComplete="off"
              autoFocus={!isNative}
              disabled={isSubmitting}
            />
          </div>

          {submitError && (
            <p className="text-sm text-[color:var(--hv-accent-danger)]" role="alert">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit || isSubmitting}
            className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Verifying...' : isNative ? 'Connect' : 'Sign in'}
          </button>
        </form>

        <p className="text-whisper text-[color:var(--hv-fg-faint)] mt-8 uppercase text-center">
          Authenticated access only
        </p>
      </div>
    </div>
  )
}
