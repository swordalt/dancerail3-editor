import React, { useEffect, useRef, useState } from 'react';

interface CommitInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'onKeyDown'> {
  value: string | number;
  onCommit: (value: string) => void;
}

export default function CommitInput({ value, onCommit, ...inputProps }: CommitInputProps) {
  const [draftValue, setDraftValue] = useState(String(value ?? ''));
  const lastCommittedDraftRef = useRef(String(value ?? ''));

  useEffect(() => {
    const nextValue = String(value ?? '');
    setDraftValue(nextValue);
    lastCommittedDraftRef.current = nextValue;
  }, [value]);

  const commitDraft = () => {
    if (draftValue === lastCommittedDraftRef.current) {
      return;
    }

    lastCommittedDraftRef.current = draftValue;
    onCommit(draftValue);
  };

  return (
    <input
      {...inputProps}
      value={draftValue}
      onChange={(event) => setDraftValue(event.target.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commitDraft();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
