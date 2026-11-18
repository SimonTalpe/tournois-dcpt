import { DemoModeNotice } from '../components/ui.tsx'
import { AccountsSection } from '../features/admin/AccountsSection.tsx'
import { NameOnlySection } from '../features/admin/NameOnlySection.tsx'
import { AllowedEmailsSection } from '../features/admin/AllowedEmailsSection.tsx'
import { SpectatorCodeSection } from '../features/admin/SpectatorCodeSection.tsx'
import { useAuth } from '../features/auth/AuthContext.ts'

export function AdminPage() {
  const { demoMode } = useAuth()
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold text-court">Administration</h1>
      {demoMode ? (
        <DemoModeNotice />
      ) : (
        <>
          <AccountsSection />
          <NameOnlySection />
          <SpectatorCodeSection />
          <AllowedEmailsSection />
        </>
      )}
    </section>
  )
}
