/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 设为 true/1 时启用气泡内工具 JSON 剥离与「已隐藏」提示；默认关闭 */
  readonly VITE_TOOL_JSON_MASK?: string;
}

type ChatState = {
  sessionId: string;
  model: string;
  busy: boolean;
  settings: Record<string, string>;
  workspacePath: string;
};

type ChatSendResult = {
  ok: boolean;
  requestId?: string;
  text?: string;
  error?: string;
  sessionId?: string;
  stopped?: boolean;
  responseState?: "complete" | "abnormal";
  responseReason?: string;
  debug?: {
    length?: number;
    hasWorkspaceContext?: boolean;
    hasConversationHistory?: boolean;
    /** 最终 prompt 是否包含 TARGET_FILE_CONTEXT（用户点选/解析到的目标文件已读入） */
    hasTargetFileContext?: boolean;
    /** 目标文件诊断一句话（含路径或失败原因） */
    targetFileSummary?: string;
    hasModelfileRef?: boolean;
    preview?: string;
    bridgeMode?: string;
    /** 与 payload.interactionMode 一致，便于诊断表展示 */
    ollamaInteraction?: "priestess" | "assistant";
    /** Claude CLI 子进程 stderr 摘要（工具/权限等） */
    cliStderrPreview?: string;
    cliExitCode?: number | null;
    cliCwd?: string;
  };
};

type DeltaPayload = { requestId: string; text: string };
type StatusPayload = { busy: boolean; requestId: string };
type ModelEntry = { id: string; name: string; provider: string };
type PromptHistoryItem = { role: "user" | "assistant"; text: string };

declare global {
  interface Window {
    desktopApi: {
      getState: () => Promise<ChatState>;
      newSession: () => Promise<{ sessionId: string }>;
      sendMessage: (payload: {
        prompt: string;
        model?: string;
        provider?: string;
        sessionId?: string;
        history?: PromptHistoryItem[];
        interactionMode?: "priestess" | "assistant";
      }) => Promise<ChatSendResult>;
      stopMessage: () => Promise<{ ok: boolean; error?: string; sessionId?: string }>;
      getWorkspace: () => Promise<{ path: string }>;
      chooseWorkspace: () => Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>;
      openDrive: (drive: string) => Promise<{ ok: boolean; error?: string }>;
      getSettings: () => Promise<Record<string, string>>;
      saveSettings: (payload: Record<string, string>) => Promise<Record<string, string>>;
      clearModelSettings: () => Promise<Record<string, string>>;
      listModels: (payload: { source: "openrouter" | "anthropic"; apiKey?: string }) => Promise<{
        ok: boolean;
        models?: ModelEntry[];
        error?: string;
      }>;
      onDelta: (handler: (payload: DeltaPayload) => void) => () => void;
      onStatus: (handler: (payload: StatusPayload) => void) => () => void;
    };
  }
}

export {};
