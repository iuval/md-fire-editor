import { useRef, useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Modal } from './Modal'
import { useT } from '../i18n/index.ts'

export interface SettingsTab {
  id: string
  /** The row in the side nav / mobile list, and the page title behind it. */
  label: string
  icon: React.ReactNode
  /** One line under the label in the mobile list, where there is room for it. */
  hint?: string
  content: React.ReactNode
}

interface SettingsDialogProps {
  tabs: SettingsTab[]
  /** The account the panel belongs to: a name, or "Guest". */
  title: string
  /** Second line under the name (email, or the local-store note). */
  subtitle?: string
  /** Desktop opens here; a phone always starts at the list. */
  initialTab?: string
  /** Below 768px the panel is a full page with push navigation instead. */
  mobile: boolean
  onClose: () => void
}

/**
 * Every preference in one place.
 *
 * Desktop: one dialog whose sections are a vertical tablist — the same panel
 * for appearance, usage, agents, the vault and the account, so nothing has to
 * be reopened to change the next thing.
 *
 * Phone: a full page instead of a floating card, because a 390px card inside a
 * scrim is a squeezed version of this. The first screen lists the sections the
 * way a system settings app does, and picking one pushes a page whose header
 * carries the way back.
 */
export function SettingsDialog({
  tabs,
  title,
  subtitle,
  initialTab,
  mobile,
  onClose,
}: SettingsDialogProps) {
  const t = useT()
  const headingId = 'settings-heading'
  // A phone starts at the list: `page === null` is that list.
  const [page, setPage] = useState<string | null>(mobile ? null : (initialTab ?? tabs[0]?.id ?? null))
  const navRef = useRef<HTMLDivElement>(null)

  // A phone has one more screen than the desktop does: the list itself. On
  // desktop there is always a section, even before one was picked.
  const shown = mobile ? page : (page ?? tabs[0]?.id ?? null)
  const active = tabs.find((tab) => tab.id === shown) ?? tabs[0]

  /** Arrow keys walk the tablist, as any tab strip is expected to behave. */
  const onNavKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const buttons = [...(navRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
    if (buttons.length === 0) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const last = buttons.length - 1
    let next = 0
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    else if (event.key === 'ArrowDown') next = index === last ? 0 : index + 1
    else next = index <= 0 ? last : index - 1
    buttons[next]?.focus()
    const target = tabs.find((tab) => tab.id === buttons[next].dataset.tabId)
    if (target) setPage(target.id)
  }

  const closeButton = (
    <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
      <X size={16} />
    </button>
  )

  if (mobile) {
    return (
      <Modal labelledBy={headingId} onClose={onClose} className="settings is-mobile">
        <div className="settings-head">
          {shown ? (
            <>
              {/* The way back sits where a phone puts it: top left, naming the
                  screen it returns to. */}
              <button
                className="settings-back"
                onClick={() => setPage(null)}
                aria-label={t('settings.back')}
              >
                <ChevronLeft size={18} aria-hidden="true" />
                {t('settings.heading')}
              </button>
              {closeButton}
            </>
          ) : (
            <>
              <h2 id={headingId} className="settings-title">
                {t('settings.heading')}
              </h2>
              {closeButton}
            </>
          )}
        </div>

        {shown && active ? (
          <div className="settings-content">
            <h3 id={headingId} className="settings-page-title">
              {active.label}
            </h3>
            {active.content}
          </div>
        ) : (
          <div className="settings-content settings-content--list">
            <div className="settings-identity">
              <span className="settings-identity-name">{title}</span>
              {subtitle && <span className="settings-identity-sub">{subtitle}</span>}
            </div>
            <div className="settings-list">
              {tabs.map((tab) => (
                <button key={tab.id} className="settings-row" onClick={() => setPage(tab.id)}>
                  <span className="settings-row-icon" aria-hidden="true">
                    {tab.icon}
                  </span>
                  <span className="settings-row-text">
                    <span className="settings-row-label">{tab.label}</span>
                    {tab.hint && <span className="settings-row-hint">{tab.hint}</span>}
                  </span>
                  <ChevronRight size={16} className="settings-row-chevron" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    )
  }

  return (
    <Modal labelledBy={headingId} onClose={onClose} className="settings">
      <div className="settings-head">
        <h2 id={headingId} className="settings-title">
          {t('settings.heading')}
        </h2>
        {closeButton}
      </div>

      <div className="settings-body">
        <div className="settings-nav">
          <div className="settings-identity">
            <span className="settings-identity-name">{title}</span>
            {subtitle && <span className="settings-identity-sub">{subtitle}</span>}
          </div>
          <div
            className="settings-tabs"
            role="tablist"
            aria-orientation="vertical"
            aria-label={t('settings.sections')}
            ref={navRef}
            onKeyDown={onNavKeyDown}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                className="settings-tab"
                data-tab-id={tab.id}
                id={`settings-tab-${tab.id}`}
                aria-selected={tab.id === active?.id}
                aria-controls={`settings-panel-${tab.id}`}
                tabIndex={tab.id === active?.id ? 0 : -1}
                onClick={() => setPage(tab.id)}
              >
                <span className="settings-tab-icon" aria-hidden="true">
                  {tab.icon}
                </span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {active && (
          <div
            className="settings-content"
            role="tabpanel"
            id={`settings-panel-${active.id}`}
            aria-labelledby={`settings-tab-${active.id}`}
          >
            {active.content}
          </div>
        )}
      </div>
    </Modal>
  )
}
