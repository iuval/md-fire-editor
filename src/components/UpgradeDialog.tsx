import { Sparkles, X } from 'lucide-react'
import { Modal } from './Modal'

interface UpgradeDialogProps {
  onClose: () => void
  onExport: () => void
}

/**
 * Shown instead of the share panel when the account has no paid plan. Payments
 * are not integrated yet, so this is a honest "ask us" screen, not a dead end:
 * exporting the vault always works.
 */
export function UpgradeDialog({ onClose, onExport }: UpgradeDialogProps) {
  return (
    <Modal labelledBy="upgrade-heading" onClose={onClose}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="upgrade-heading">Compartir requiere un plan</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>

        <p className="share-hint-box">
          Tu cuenta está en el plan gratuito: podés crear y editar todas las notas que quieras,
          y exportarlas siempre. Compartir con otras personas y vincular agentes está en el plan
          pago.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>
            <Sparkles size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Planes previstos: $4/mes solo · $12/mes hasta 5 personas
          </span>
          <span className="hint">Los pagos todavía no están habilitados; escribinos para activarlo.</span>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onExport}>
            Exportar mis notas
          </button>
          <button className="btn" onClick={onClose}>
            Entendido
          </button>
        </div>
    </Modal>
  )
}
