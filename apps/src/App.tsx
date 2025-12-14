import { AppProvider } from '@/context/AppContext';
import { ChatsPanel } from '@/components/chats/ChatsPanel';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { AgentsPanel } from '@/components/agents/AgentsPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import './index.css';

function AppLayout() {
  return (
    <div className="h-screen w-screen flex overflow-hidden bg-background">
      {/* Left Panel: Interactive Chats */}
      <ErrorBoundary>
        <ChatsPanel />
      </ErrorBoundary>

      {/* Center Panel: Chat Window */}
      <ErrorBoundary>
        <ChatWindow />
      </ErrorBoundary>

      {/* Right Panel: Background Agents */}
      <ErrorBoundary>
        <AgentsPanel />
      </ErrorBoundary>
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppLayout />
      </AppProvider>
    </ErrorBoundary>
  );
}

export default App;
