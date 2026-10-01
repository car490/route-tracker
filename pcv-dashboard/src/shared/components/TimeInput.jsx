// The dashboard's time box: 24-hour HH:MM on every PC. Replaces the browser's
// own time box (type "time"), which shows AM/PM on a PC set to US English (see
// docs/DECISIONS.md "Time format"). Typing "815", "0815" or "8:15" all give
// 08:15. onChange receives only "HH:MM" or '' — never a half-typed or
// 12-hour value (the rules live in ../time/timeEntry.js). Anything else
// shows a written error, not just a red border, and blocks a form submit.
import { useEffect, useId, useRef, useState } from 'react'
import { parseTime, toDisplay, valueFor, TIME_ERROR } from '../time/timeEntry.js'

export function TimeInput({ value, onChange, style, className = 'form-input', required, ...rest }) {
  // null while the box isn't being edited: it then shows the stored value.
  const [draft, setDraft] = useState(null)
  // The value when editing began: what the form goes back to while the box
  // holds something that isn't a valid time.
  const [original, setOriginal] = useState(value)
  const [touched, setTouched] = useState(false)
  const inputRef = useRef(null)
  const errorId = useId()

  const stored = toDisplay(value)
  const invalid = draft !== null && parseTime(draft) === null
  const showError = touched && invalid

  useEffect(() => {
    inputRef.current?.setCustomValidity(invalid ? TIME_ERROR : '')
  }, [invalid])

  function handleChange(e) {
    const next = e.target.value
    setDraft(next)
    const formValue = valueFor(next, original)
    if (formValue !== value) onChange(formValue)
  }

  function handleBlur() {
    setTouched(true)
    // A valid time snaps to HH:MM; an invalid one stays so it can be fixed.
    if (!invalid) setDraft(null)
  }

  const { width = '100%', ...inputStyle } = style ?? {}

  return (
    <span style={{ display: 'inline-block', width }}>
      <input
        {...rest}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH:MM"
        className={className}
        style={{ ...inputStyle, width: '100%', fontVariantNumeric: 'tabular-nums' }}
        value={draft ?? stored}
        required={required}
        aria-invalid={showError || undefined}
        aria-describedby={showError ? errorId : undefined}
        onFocus={() => {
          if (draft === null) { setDraft(stored); setOriginal(value) }
        }}
        onChange={handleChange}
        onBlur={handleBlur}
      />
      {showError && <span id={errorId} className="time-input-error" role="alert">{TIME_ERROR}</span>}
    </span>
  )
}
