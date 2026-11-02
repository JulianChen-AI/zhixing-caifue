'use client';
import { Select } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';

export type ChoiceOption = { value: string; label: string };

type Props = { label: string; options: ChoiceOption[]; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean; inline?: number };

/** Few options render as tappable rows; longer lists use a styled popover instead of the OS menu. */
export function FlowSelect({ label, options, value, onChange, placeholder = '请选择', disabled, inline = 4 }: Props) {
  if (options.length <= inline) return (
    <div className="choice-list" role="radiogroup" aria-label={label}>
      {options.map(option => <button type="button" role="radio" aria-checked={option.value === value} data-value={option.value} className="choice-item" disabled={disabled} key={option.value} onClick={() => { if (option.value !== value) onChange(option.value); }}><span>{option.label}</span><Check aria-hidden size={16} /></button>)}
    </div>
  );
  return (
    <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger className="choice-trigger" aria-label={label}>
        <Select.Value placeholder={placeholder} />
        <Select.Icon><ChevronDown aria-hidden size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="choice-popover" position="popper" sideOffset={6} collisionPadding={12}>
          <Select.Viewport>
            {options.map(option => <Select.Item className="choice-option" data-value={option.value} value={option.value} key={option.value}><Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator className="choice-check"><Check aria-hidden size={16} /></Select.ItemIndicator></Select.Item>)}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function FlowMulti({ label, options, value, onChange, disabled }: { label: string; options: ChoiceOption[]; value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  return (
    <div className="choice-list" role="group" aria-label={label}>
      {options.map(option => {
        const on = value.includes(option.value);
        return <button type="button" role="checkbox" aria-checked={on} data-value={option.value} className="choice-item" disabled={disabled} key={option.value} onClick={() => onChange(on ? value.filter(v => v !== option.value) : [...value, option.value])}><span>{option.label}</span><Check aria-hidden size={16} /></button>;
      })}
    </div>
  );
}
