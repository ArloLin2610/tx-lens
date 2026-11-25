import type { ReactNode } from 'react';

export const Segmented = <T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) => (
  <div className="segmented" role="group" aria-label={label}>
    {options.map((option) => <button key={String(option.value)} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>
);

/** A captioned text or date input. */
export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field"><span>{label}</span>{children}</label>
);

/** A captioned button group. Not a <label>: that would rename the first button after the caption. */
export const FieldGroup = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="field"><span>{label}</span>{children}</div>
);

/** One of the three zones, as a coloured name. */
export const ZoneName = ({ kind }: { kind: 'vah' | 'poc' | 'val' }) => <span className={`zone-name zone-${kind}`}>{kind.toUpperCase()} 區</span>;
