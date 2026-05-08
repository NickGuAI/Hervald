/*
 * Vendored from react-bits ChromaGrid:
 * https://github.com/DavidHDev/react-bits/blob/main/src/ts-tailwind/Components/ChromaGrid/ChromaGrid.tsx
 *
 * License: MIT + Commons Clause License Condition v1.0
 * Copyright (c) 2026 David Haz
 *
 * Permission is granted to use, copy, modify, merge, publish, and distribute
 * this code as part of an application, website, or product, provided this
 * notice is included in substantial portions of the Software.
 *
 * Commons Clause restriction: do not sell, sublicense, or redistribute the
 * component itself, alone or bundled, as a library or ported version.
 *
 * Local modifications:
 * - Removed demo data fallback.
 * - Added per-item button props and callbacks for in-app interactions.
 * - Kept the spotlight / chroma masking behavior while aligning with
 *   Hammurabi's org-card semantics.
 */

import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type MouseEventHandler,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { gsap } from 'gsap'
import { cn } from '@/lib/utils'

type SetterFn = (value: number | string) => void

type ChromaCardProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'className' | 'style' | 'type' | 'onClick'
>

export interface ChromaItem {
  id?: string
  image: string
  title: string
  subtitle: string
  handle?: string
  location?: string
  borderColor?: string
  gradient?: string
  url?: string
  cardClassName?: string
  cardProps?: ChromaCardProps
  onClick?: () => void
}

export interface ChromaGridProps {
  items?: ChromaItem[]
  className?: string
  radius?: number
  damping?: number
  fadeOut?: number
  ease?: string
  spotlightColor?: string
}

const DEFAULT_CARD_GRADIENT = 'linear-gradient(165deg, rgba(245,241,232,0.08), rgba(28,28,28,0.92))'
const DEFAULT_CARD_BORDER = 'rgba(245,241,232,0.18)'

export function ChromaGrid({
  items = [],
  className,
  radius = 300,
  damping = 0.45,
  fadeOut = 0.6,
  ease = 'power3.out',
  spotlightColor = 'rgba(255,255,255,0.26)',
}: ChromaGridProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const fadeRef = useRef<HTMLDivElement | null>(null)
  const setX = useRef<SetterFn | null>(null)
  const setY = useRef<SetterFn | null>(null)
  const pos = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const element = rootRef.current
    if (!element) {
      return
    }

    setX.current = gsap.quickSetter(element, '--x', 'px') as SetterFn
    setY.current = gsap.quickSetter(element, '--y', 'px') as SetterFn

    const { width, height } = element.getBoundingClientRect()
    pos.current = { x: width / 2, y: height / 2 }
    setX.current(pos.current.x)
    setY.current(pos.current.y)
  }, [])

  function moveTo(x: number, y: number) {
    gsap.to(pos.current, {
      x,
      y,
      duration: damping,
      ease,
      onUpdate: () => {
        setX.current?.(pos.current.x)
        setY.current?.(pos.current.y)
      },
      overwrite: true,
    })
  }

  function handleMove(event: ReactPointerEvent<HTMLDivElement>) {
    const element = rootRef.current
    if (!element) {
      return
    }

    const rect = element.getBoundingClientRect()
    moveTo(event.clientX - rect.left, event.clientY - rect.top)
    gsap.to(fadeRef.current, { opacity: 0, duration: 0.25, overwrite: true })
  }

  function handleLeave() {
    gsap.to(fadeRef.current, {
      opacity: 1,
      duration: fadeOut,
      overwrite: true,
    })
  }

  function handleCardClick(item: ChromaItem) {
    item.onClick?.()
    if (!item.onClick && item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer')
    }
  }

  const handleCardMove: MouseEventHandler<HTMLElement> = (event) => {
    const card = event.currentTarget
    const rect = card.getBoundingClientRect()
    card.style.setProperty('--mouse-x', `${event.clientX - rect.left}px`)
    card.style.setProperty('--mouse-y', `${event.clientY - rect.top}px`)
  }

  return (
    <div
      ref={rootRef}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className={cn('relative flex h-full w-full flex-wrap items-start gap-4', className)}
      style={
        {
          '--r': `${radius}px`,
          '--x': '50%',
          '--y': '50%',
        } as CSSProperties
      }
    >
      {items.map((item, index) => (
        <button
          key={item.id ?? `${item.title}-${index}`}
          type="button"
          {...item.cardProps}
          onMouseMove={handleCardMove}
          onClick={() => handleCardClick(item)}
          className={cn(
            'group relative flex w-full max-w-[300px] flex-col overflow-hidden rounded-[20px] border-2 border-transparent text-left transition-transform duration-300 ease-out hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80',
            item.cardClassName,
          )}
          style={
            {
              borderColor: item.borderColor ?? DEFAULT_CARD_BORDER,
              background: item.gradient ?? DEFAULT_CARD_GRADIENT,
              boxShadow: '0 18px 48px rgba(0, 0, 0, 0.24)',
              '--spotlight-color': spotlightColor,
            } as CSSProperties
          }
        >
          <div
            className="pointer-events-none absolute inset-0 z-20 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            style={{
              background:
                'radial-gradient(circle at var(--mouse-x) var(--mouse-y), var(--spotlight-color), transparent 70%)',
            }}
          />

          <div className="relative z-10 flex-1 p-[10px]">
            <img
              src={item.image}
              alt={item.title}
              loading="lazy"
              className="h-full w-full rounded-[12px] object-cover"
            />
          </div>

          <footer className="relative z-10 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-3 pb-3 text-washi-white">
            <h3 className="m-0 truncate text-[1.05rem] font-semibold">{item.title}</h3>
            {item.handle ? (
              <span className="truncate text-right text-[0.95rem] opacity-80">{item.handle}</span>
            ) : null}
            <p className="m-0 truncate text-[0.85rem] opacity-85">{item.subtitle}</p>
            {item.location ? (
              <span className="truncate text-right text-[0.85rem] opacity-85">{item.location}</span>
            ) : null}
          </footer>
        </button>
      ))}

      <div
        className="pointer-events-none absolute inset-0 z-30"
        style={{
          background: 'rgba(0,0,0,0.001)',
          maskImage:
            'radial-gradient(circle var(--r) at var(--x) var(--y),transparent 0%,transparent 15%,rgba(0,0,0,0.10) 30%,rgba(0,0,0,0.22)45%,rgba(0,0,0,0.35)60%,rgba(0,0,0,0.50)75%,rgba(0,0,0,0.68)88%,white 100%)',
          WebkitMaskImage:
            'radial-gradient(circle var(--r) at var(--x) var(--y),transparent 0%,transparent 15%,rgba(0,0,0,0.10) 30%,rgba(0,0,0,0.22)45%,rgba(0,0,0,0.35)60%,rgba(0,0,0,0.50)75%,rgba(0,0,0,0.68)88%,white 100%)',
        }}
      />

      <div
        ref={fadeRef}
        className="pointer-events-none absolute inset-0 z-40 transition-opacity duration-[250ms]"
        style={{
          background: 'rgba(0,0,0,0.001)',
          maskImage:
            'radial-gradient(circle var(--r) at var(--x) var(--y),white 0%,white 15%,rgba(255,255,255,0.90)30%,rgba(255,255,255,0.78)45%,rgba(255,255,255,0.65)60%,rgba(255,255,255,0.50)75%,rgba(255,255,255,0.32)88%,transparent 100%)',
          WebkitMaskImage:
            'radial-gradient(circle var(--r) at var(--x) var(--y),white 0%,white 15%,rgba(255,255,255,0.90)30%,rgba(255,255,255,0.78)45%,rgba(255,255,255,0.65)60%,rgba(255,255,255,0.50)75%,rgba(255,255,255,0.32)88%,transparent 100%)',
          opacity: 1,
        }}
      />
    </div>
  )
}
