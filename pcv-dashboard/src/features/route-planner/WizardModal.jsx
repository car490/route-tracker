// Step-aware sibling of Modal.jsx for multi-step flows with real side effects along the
// way — deliberately does not close on backdrop click, since a stray click shouldn't
// discard progress (or, past the point a step has saved to the DB, misleadingly imply
// it did).
export default function WizardModal({ title, step, totalSteps, fullBleed, footer, children }) {
  return (
    <div className="modal-overlay">
      <div className={`modal-card wizard-card${fullBleed ? ' wizard-card--full' : ''}`}>
        <div className="modal-header wizard-header">
          <span>{title}</span>
          <span className="wizard-step-indicator">Step {step} of {totalSteps}</span>
        </div>
        <div className="modal-body wizard-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
