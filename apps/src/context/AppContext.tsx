import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { Conversation } from '@/types/api';
import { DEV_USER_ID } from '@/config';

// State types
interface AppState {
  selectedConversationId: string | null;
  conversations: Conversation[];
  chatsRefreshTrigger: number;
  agentsRefreshTrigger: number;
  userId: string;
  chatsPanelCollapsed: boolean;
  agentsPanelCollapsed: boolean;
}

// Action types
type AppAction =
  | { type: 'SELECT_CONVERSATION'; payload: string | null }
  | { type: 'SET_CONVERSATIONS'; payload: Conversation[] }
  | { type: 'ADD_CONVERSATION'; payload: Conversation }
  | { type: 'UPDATE_CONVERSATION'; payload: Conversation }
  | { type: 'REMOVE_CONVERSATION'; payload: string }
  | { type: 'REFRESH_CHATS' }
  | { type: 'REFRESH_AGENTS' }
  | { type: 'REFRESH_ALL' }
  | { type: 'SET_USER_ID'; payload: string }
  | { type: 'TOGGLE_CHATS_PANEL' }
  | { type: 'TOGGLE_AGENTS_PANEL' };

// Initial state
const initialState: AppState = {
  selectedConversationId: null,
  conversations: [],
  chatsRefreshTrigger: 0,
  agentsRefreshTrigger: 0,
  userId: DEV_USER_ID,
  chatsPanelCollapsed: false,
  agentsPanelCollapsed: false,
};

// Reducer
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SELECT_CONVERSATION':
      return { ...state, selectedConversationId: action.payload };

    case 'SET_CONVERSATIONS':
      return { ...state, conversations: action.payload };

    case 'ADD_CONVERSATION':
      return {
        ...state,
        conversations: [action.payload, ...state.conversations],
      };

    case 'UPDATE_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.payload.id ? action.payload : c
        ),
      };

    case 'REMOVE_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.filter((c) => c.id !== action.payload),
        selectedConversationId:
          state.selectedConversationId === action.payload
            ? null
            : state.selectedConversationId,
      };

    case 'REFRESH_CHATS':
      return { ...state, chatsRefreshTrigger: state.chatsRefreshTrigger + 1 };

    case 'REFRESH_AGENTS':
      return { ...state, agentsRefreshTrigger: state.agentsRefreshTrigger + 1 };

    case 'REFRESH_ALL':
      return {
        ...state,
        chatsRefreshTrigger: state.chatsRefreshTrigger + 1,
        agentsRefreshTrigger: state.agentsRefreshTrigger + 1,
      };

    case 'SET_USER_ID':
      return { ...state, userId: action.payload };

    case 'TOGGLE_CHATS_PANEL':
      return { ...state, chatsPanelCollapsed: !state.chatsPanelCollapsed };

    case 'TOGGLE_AGENTS_PANEL':
      return { ...state, agentsPanelCollapsed: !state.agentsPanelCollapsed };

    default:
      return state;
  }
}

// Context
interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  // Convenience selectors
  selectedConversation: Conversation | null;
  interactiveChats: Conversation[];
  backgroundAgents: Conversation[];
}

const AppContext = createContext<AppContextValue | null>(null);

// Provider
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  const selectedConversation =
    state.conversations.find((c) => c.id === state.selectedConversationId) ?? null;

  const interactiveChats = state.conversations.filter(
    (c) => c.status === 'active' || c.status === 'waiting_input'
  );

  const backgroundAgents = state.conversations.filter((c) => c.status === 'background');

  return (
    <AppContext.Provider
      value={{
        state,
        dispatch,
        selectedConversation,
        interactiveChats,
        backgroundAgents,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

// Hook
export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
