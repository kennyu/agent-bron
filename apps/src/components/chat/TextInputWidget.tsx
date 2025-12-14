import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface TextInputWidgetProps {
  prompt: string;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function TextInputWidget({ prompt, onSubmit, disabled }: TextInputWidgetProps) {
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="text-sm font-medium mb-3">{prompt}</div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter your response..."
        disabled={disabled}
        className="min-h-[80px] mb-3"
      />
      <Button
        onClick={handleSubmit}
        disabled={!value.trim() || disabled}
        className="w-full"
      >
        Submit
      </Button>
    </div>
  );
}
