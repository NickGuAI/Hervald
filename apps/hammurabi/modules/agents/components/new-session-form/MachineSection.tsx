import type { AgentSession, Machine } from '@/types'
import { useState } from 'react'
import { AddWorkerWizard } from './AddWorkerWizard'
import { getMachineConnectionHost, getMachineDisplayValue } from './helpers'

interface MachineSectionProps {
  selectedHost: string
  setSelectedHost: (value: string) => void
  machines: Machine[]
  resumeLocked: boolean
  resumeSource: AgentSession | null
}

export function MachineSection({
  selectedHost,
  setSelectedHost,
  machines,
  resumeLocked,
  resumeSource,
}: MachineSectionProps) {
  const [showAddWorkerWizard, setShowAddWorkerWizard] = useState(false)
  const [showAuthWizard, setShowAuthWizard] = useState(false)
  const remoteMachines = machines.filter((machine) => machine.host)
  const selectedMachine = remoteMachines.find((machine) => machine.id === selectedHost) ?? null

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="section-title block">Machine</label>
        {!resumeLocked ? (
          <div className="flex items-center gap-2">
            {selectedMachine ? (
              <button
                type="button"
                onClick={() => setShowAuthWizard(true)}
                className="text-xs uppercase tracking-wide text-sumi-diluted underline underline-offset-2"
              >
                Provider auth
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowAddWorkerWizard(true)}
              className="text-xs uppercase tracking-wide text-sumi-diluted underline underline-offset-2"
            >
              Add worker
            </button>
          </div>
        ) : null}
      </div>
      {resumeLocked ? (
        <div className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-black">
          {getMachineDisplayValue(resumeSource, machines)}
        </div>
      ) : (
        <>
          <select
            value={selectedHost}
            onChange={(event) => setSelectedHost(event.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
          >
            <option value="">Local (this server)</option>
            {remoteMachines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.label} ({machine.user ? `${machine.user}@` : ''}{getMachineConnectionHost(machine)})
              </option>
            ))}
          </select>

          <AddWorkerWizard
            open={showAddWorkerWizard}
            onClose={() => setShowAddWorkerWizard(false)}
            onMachineReady={(machine) => {
              setSelectedHost(machine.id)
              setShowAddWorkerWizard(false)
            }}
          />

          <AddWorkerWizard
            open={showAuthWizard}
            onClose={() => setShowAuthWizard(false)}
            initialMachine={selectedMachine}
            onMachineReady={(machine) => {
              setSelectedHost(machine.id)
              setShowAuthWizard(false)
            }}
          />
        </>
      )}
    </div>
  )
}
