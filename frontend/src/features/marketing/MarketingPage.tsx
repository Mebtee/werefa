import { useEffect } from 'react'
import './marketing.css'
import { MarketingHeader } from './components/MarketingHeader'
import { MarketingFooter } from './components/MarketingFooter'
import { HeroSection } from './components/HeroSection'
import { TrustStrip } from './components/TrustStrip'
import { HowItWorksSection } from './components/HowItWorksSection'
import { ProductFlow } from './components/ProductFlow'
import { FeaturesSection } from './components/FeaturesSection'
import { BenefitsSection } from './components/BenefitsSection'
import { BusinessTypesSection } from './components/BusinessTypesSection'
import { DashboardSection } from './components/DashboardSection'
import { PaymentSection } from './components/PaymentSection'
import { TelegramSection } from './components/TelegramSection'
import { CustomerExperienceSection } from './components/CustomerExperienceSection'
import { PricingSection } from './components/PricingSection'
import { AboutSection } from './components/AboutSection'
import { FaqSection } from './components/FaqSection'
import { FinalCta } from './components/FinalCta'

const MARKETING_TITLE = 'Werefa — Scheduling & booking for service businesses'

/**
 * The Werefa public marketing site, served at `/`.
 *
 * Fully static and independent of any authenticated layout: it makes no API
 * calls, needs no session and renders with an empty database or the backend
 * offline. The business booking surface lives separately at `/p/:slug` and is
 * unaffected.
 */
export function MarketingPage() {
  useEffect(() => {
    document.title = MARKETING_TITLE
    return () => {
      document.title = 'Werefa'
    }
  }, [])

  return (
    <div className="mkt">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <MarketingHeader />
      <main className="mkt-main" id="main">
        <HeroSection />
        <TrustStrip />
        <HowItWorksSection />
        <ProductFlow />
        <FeaturesSection />
        <BenefitsSection />
        <BusinessTypesSection />
        <DashboardSection />
        <PaymentSection />
        <TelegramSection />
        <CustomerExperienceSection />
        <PricingSection />
        <AboutSection />
        <FaqSection />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  )
}
