import type { PendingQuestion } from '@/types/api';
import { TextInputWidget } from './TextInputWidget';
import { ChoiceWidget } from './ChoiceWidget';
import { ConfirmationWidget } from './ConfirmationWidget';

interface InputWidgetProps {
  pendingQuestion: PendingQuestion;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function InputWidget({ pendingQuestion, onSubmit, disabled }: InputWidgetProps) {
  const { type, prompt, options } = pendingQuestion;

  switch (type) {
    case 'input':
      return (
        <TextInputWidget
          prompt={prompt}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );

    case 'choice':
      return (
        <ChoiceWidget
          prompt={prompt}
          options={options || []}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );

    case 'confirmation':
      return (
        <ConfirmationWidget
          prompt={prompt}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );

    default:
      return (
        <TextInputWidget
          prompt={prompt}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
  }
}
