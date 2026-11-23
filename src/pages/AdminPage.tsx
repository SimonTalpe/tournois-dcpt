import { Link } from 'react-router'
import { DemoModeNotice, PageTitle } from '../components/ui.tsx'
import { AccountsSection } from '../features/admin/AccountsSection.tsx'
import { LocationsSection } from '../features/admin/LocationsSection.tsx'
import { NameOnlySection } from '../features/admin/NameOnlySection.tsx'
import { AllowedEmailsSection } from '../features/admin/AllowedEmailsSection.tsx'
import { SpectatorCodeSection } from '../features/admin/SpectatorCodeSection.tsx'
import { useAuth } from '../features/auth/AuthContext.ts'

export function AdminPage() {
  const { demoMode } = useAuth()
  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <PageTitle>Administration</PageTitle>
        <p className="max-w-[60ch] text-[17px] leading-normal">
          Les matchs, scores et tournois se modifient directement sur leurs pages. Ici : comptes, noms seuls, lieux et
          accès.
        </p>
        <Link
          to="/tournois?nouveau=1"
          className="inline-flex min-h-[52px] items-center border-2 border-black bg-black px-5 text-[17px] font-semibold text-white hover:border-ochre-text hover:bg-ochre-text"
        >
          Créer un tournoi
        </Link>
      </div>
      {demoMode ? (
        <DemoModeNotice />
      ) : (
        <>
          <AccountsSection />
          <NameOnlySection />
          <LocationsSection />
          <SpectatorCodeSection />
          <AllowedEmailsSection />
        </>
      )}
    </section>
  )
}
