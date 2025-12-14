import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChoiceWidgetProps {
  prompt: string;
  options: string[];
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function ChoiceWidget({ prompt, options, onSubmit, disabled }: ChoiceWidgetProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleSubmit = () => {
    if (selected) {
      onSubmit(selected);
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="text-sm font-medium mb-3">{prompt}</div>
      <div className="space-y-2 mb-3">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => setSelected(option)}
            disabled={disabled}
            className={cn(
              'w-full text-left px-3 py-2 rounded-md border transition-colors',
              'hover:bg-accent',
              selected === option
                ? 'border-primary bg-primary/10'
                : 'border-border'
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'w-4 h-4 rounded-full border-2 flex items-center justify-center',
                  selected === option ? 'border-primary' : 'border-muted-foreground'
                )}
              >
                {selected === option && (
                  <div className="w-2 h-2 rounded-full bg-primary" />
                )}
              </div>
              <span className="text-sm">{option}</span>
            </div>
          </button>
        ))}
      </div>
      <Button
        onClick={handleSubmit}
        disabled={!selected || disabled}
        className="w-full"
      >
        Confirm Selection
      </Button>
    </div>
  );
}
