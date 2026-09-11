// RESIDENCY-PORTAL-1: the Residency Portal experience (Cedars-Sinai Talent
// Acquisition).
//
// It IS the staff Residency workspace: the same NgrpWorkspace and tab
// components, mounted under /portal/residency through the surface context
// (portal base path, no staff-only Send Transition Form, no event authoring,
// and events narrowed to what Talent Acquisition may see). What the staff app
// supplies around the workspace, a portal has to supply itself, so this
// component owns the cohort selection, the cohort settings and create dialogs,
// and the toasts.
//
// THE COHORT PICKER IS THE STAFF ONE, not a look-alike: the header's own
// ScopePicker with the same ResidencyCohortList pane and the same label rules,
// placed in the portal header's controls slot. With a single experience the
// pill names only the cohort, exactly as it does for a staff member who has one.
//
// Access is decided server-side by the Residency endpoints. This component
// renders whatever they allow and never widens it.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../hooks/useToast'
import { ToastContainer } from '../../components/Toast'
import NgrpWorkspace from '../../components/ngrp/NgrpWorkspace'
import CohortSettingsModal from '../../components/ngrp/CohortSettingsModal'
import CreateCohortDialog from '../../components/ngrp/CreateCohortDialog'
import ScopePicker from '../../components/Header/scope/ScopePicker'
import ResidencyCohortList from '../../components/Header/scope/ResidencyCohortList'
import { useNgrpCycles } from '../../lib/ngrp/useNgrpData'
import { orderCyclesForSelector, resolveSelectedCycle } from '../../lib/ngrp/ngrpStates'
import { ngrpCycleStorageKey } from '../../lib/ngrp/ngrpAccess'
import { NgrpSurfaceProvider, RESIDENCY_PORTAL_SURFACE } from '../../lib/ngrp/ngrpSurface'
import {
  RESIDENCY_EXPERIENCE, residencyCohortLabel, residencyCohortLive, residencyLabelIsState,
} from '../../lib/scopePickerLabels'
import { PortalHeaderControls } from '../PortalHeaderSlots'

const EXPERIENCES = [RESIDENCY_EXPERIENCE]
const stayInResidency = () => {}

export default function ResidencyPortal({ canManage = false }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { toasts, removeToast, toast } = useToast()
  const cyclesQuery = useNgrpCycles()
  // The same per-user cohort preference the staff app keeps, so an Owner who
  // previews the portal lands on the cohort they were already working in.
  const [cyclePref, setCyclePref] = useState(() => {
    try {
      const k = ngrpCycleStorageKey(user?.id)
      return k ? localStorage.getItem(k) : null
    } catch { return null }
  })
  const [showSettings, setShowSettings] = useState(false)
  const [showNewCohort, setShowNewCohort] = useState(false)

  const activeCycle = resolveSelectedCycle(cyclesQuery.cycles, cyclePref)
  const selectCycle = (id) => {
    setCyclePref(id)
    try {
      const k = ngrpCycleStorageKey(user?.id)
      if (k) localStorage.setItem(k, id)
    } catch { /* storage unavailable: the selection still applies this session */ }
  }
  // The exact object the staff app hands its header as `residencyCohort`.
  const residencyCohort = {
    status: cyclesQuery.status,
    cycles: orderCyclesForSelector(cyclesQuery.cycles),
    activeCycle,
    onSelectCycle: selectCycle,
    canManage,
    onManageCycle: () => setShowSettings(true),
    onNewCycle: () => setShowNewCohort(true),
  }

  return (
    <NgrpSurfaceProvider value={RESIDENCY_PORTAL_SURFACE}>
      <PortalHeaderControls>
        <ScopePicker
          experiences={EXPERIENCES}
          activeExperience={RESIDENCY_EXPERIENCE.id}
          onSwitchExperience={stayInResidency}
          cohortLabel={residencyCohortLabel(residencyCohort)}
          cohortLive={residencyCohortLive(activeCycle)}
          cohortLabelDimmed={residencyLabelIsState(residencyCohort)}
          cohortPane={<ResidencyCohortList {...residencyCohort} />}
        />
      </PortalHeaderControls>
      <div className="ptl-page ptl-residency-page">
        <h1 className="ptl-visually-hidden">Residency Portal</h1>
        <NgrpWorkspace
          cyclesStatus={cyclesQuery.status}
          cyclesCount={cyclesQuery.cycles.length}
          cycle={activeCycle}
          canManage={canManage}
          toast={toast}
          onEditCohort={() => setShowSettings(true)}
          onAddCohort={() => setShowNewCohort(true)}
          onSelectCycle={selectCycle}
        />
      </div>
      {showSettings && activeCycle && (
        <CohortSettingsModal
          cycle={activeCycle}
          canManage={canManage}
          toast={toast}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showNewCohort && (
        <CreateCohortDialog
          onClose={() => setShowNewCohort(false)}
          onCreated={(created) => {
            setShowNewCohort(false)
            toast?.success?.('Residency cohort added', `${created.name} is ready to configure.`)
            queryClient.invalidateQueries({ queryKey: ['ngrp_workspace'] })
            selectCycle(created.id)
            setShowSettings(true)
          }}
        />
      )}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </NgrpSurfaceProvider>
  )
}
