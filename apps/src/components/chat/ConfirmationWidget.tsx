import { Button } from '@/components/ui/button';

interface ConfirmationWidgetProps {
  prompt: string;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function ConfirmationWidget({ prompt, onSubmit, disabled }: ConfirmationWidgetProps) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="text-sm font-medium mb-4">{prompt}</div>
      <div className="flex gap-3">
        <Button
          onClick={() => onSubmit('Yes')}
          disabled={disabled}
          className="flex-1"
        >
          Yes
        </Button>
        <Button
          onClick={() => onSubmit('No')}
          disabled={disabled}
          variant="outline"
          className="flex-1"
        >
          No
        </Button>
      </div>
    </div>
  );
}
