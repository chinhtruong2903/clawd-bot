"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { io, type Socket } from "socket.io-client";

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  content: string;
};

type HealthState = {
  online: boolean;
  ready: boolean;
  detail: string;
};

type CommandLog = {
  id: string;
  title: string;
  ok: boolean;
  content: string;
};

type StatusResponse = {
  rootDir?: string;
  instance?: {
    id: string;
    name: string;
    containerName: string;
    gatewayPort: number;
    sshPort: number;
  };
  openclawBaseUrl?: string;
  hasGatewayToken?: boolean;
  docker?: {
    ok?: boolean;
    stdout?: string;
    stderr?: string;
  };
  health?: {
    ok?: boolean;
    data?: {
      ok?: boolean;
      status?: string;
    };
    error?: string;
  };
  ready?: {
    ok?: boolean;
    data?: {
      ready?: boolean;
      failing?: unknown[];
    };
    error?: string;
  };
  models?: {
    ok?: boolean;
    data?: {
      data?: { id: string }[];
    };
    raw?: string;
    error?: string;
  };
};

type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
};

type UsageCost = {
  updatedAt?: number;
  days?: number;
  daily?: UsageDay[];
  totals?: UsageTotals;
};

type UsageDay = UsageTotals & {
  date: string;
};

type UsageTotals = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  totalCost?: number;
  inputCost?: number;
  outputCost?: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
  missingCostEntries?: number;
};

type ClawbotInstance = {
  id: string;
  name: string;
  containerName: string;
  gatewayPort: number;
  sshPort: number;
  token: string;
  baseUrl: string;
};

const DEFAULT_API_BASE = process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:3001";
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, "");
const SSH_HOST_LABEL = process.env.NEXT_PUBLIC_SSH_HOST_LABEL || "127.0.0.1";
const TERMINAL_CLIENT_PASSWORD = "TNCC29032002";

function normalizeTerminalChunk(chunk: string) {
  return chunk
    .replace(/\u009b/g, "\x1b[")
    .replace(/\u009d/g, "\x1b]")
    .replace(/\u0090/g, "\x1bP")
    .replace(/\u009c/g, "\x1b\\")
    .replace(/\u008f/g, "\x1bO")
    .replace(/\x1b\[\?9001[hl]/g, "")
    .replace(/\x1b\[\?1004[hl]/g, "");
}

function getSpecialTerminalInput(event: KeyboardEvent) {
  if (event.altKey || event.metaKey) {
    return null;
  }

  if (event.ctrlKey) {
    if (event.key.length === 1) {
      const code = event.key.toUpperCase().charCodeAt(0);
      if (code >= 65 && code <= 90) {
        return String.fromCharCode(code - 64);
      }
    }
    return null;
  }

  const keyMap: Record<string, string> = {
    ArrowUp: "\x1b[A",
    ArrowDown: "\x1b[B",
    ArrowRight: "\x1b[C",
    ArrowLeft: "\x1b[D",
    Home: "\x1b[H",
    End: "\x1b[F",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
    Insert: "\x1b[2~",
    Delete: "\x1b[3~",
    Backspace: "\x7f",
    Enter: "\r",
    Tab: "\t",
    Escape: "\x1b",
    " ": " ",
  };

  return keyMap[event.key] ?? null;
}

async function copyTerminalSelection(terminal: Terminal) {
  const selection = terminal.getSelection();
  if (!selection) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(selection);
    terminal.clearSelection();
    return true;
  } catch {
    return false;
  }
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path
        d="M4 12L20 4L16.5 20L12.3 13.6L4 12Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path
        d="M20 12A8 8 0 1 1 17.7 6.4M20 5V12H13"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function PowerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path
        d="M12 3V12M6.3 6.7A8 8 0 1 0 17.7 6.7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path
        d="M14.7 6.3L17.7 3.3A4 4 0 0 1 20.7 8.8L9.2 20.3L4 22L5.7 16.8L17.2 5.3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function LogIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path
        d="M5 5H19M5 12H19M5 19H13"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${
        ok
          ? "border-[#b8d8c2] bg-[#edf8ef] text-[#126534]"
          : "border-[#ead0ca] bg-[#fff2ef] text-[#a23625]"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-[#16803c]" : "bg-[#c2412d]"}`} />
      {label}
    </span>
  );
}

function formatNumber(value?: number) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatCurrency(value?: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value ?? 0);
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<"console" | "instances">("console");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "hello",
      role: "assistant",
      content: "Setup OpenClaw on the left, then send a message here to test the API bridge.",
    },
  ]);
  const [input, setInput] = useState("");
  const [health, setHealth] = useState<HealthState>({
    online: false,
    ready: false,
    detail: "Checking",
  });
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [logs, setLogs] = useState<CommandLog[]>([]);
  const [usage, setUsage] = useState<UsageCost | null>(null);
  const [usageError, setUsageError] = useState("");
  const [instances, setInstances] = useState<ClawbotInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState("local");
  const [instanceForm, setInstanceForm] = useState({
    name: "",
    containerName: "",
    gatewayPort: "",
    sshPort: "",
    token: "",
  });
  const [terminalConnected, setTerminalConnected] = useState(false);
  const [terminalUnlocked, setTerminalUnlocked] = useState(false);
  const [terminalPassword, setTerminalPassword] = useState("");
  const [terminalAuthError, setTerminalAuthError] = useState("");
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [selectedContainer, setSelectedContainer] = useState("");
  const [containersError, setContainersError] = useState("");
  const [isLoadingContainers, setIsLoadingContainers] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);
  const modelIds = status?.models?.data?.data?.map((model) => model.id) ?? [];
  const selectedContainerInfo = useMemo(
    () => containers.find((container) => container.name === selectedContainer),
    [containers, selectedContainer],
  );
  const latestUsageDay = usage?.daily?.filter((day) => (day.totalTokens ?? 0) > 0).at(-1);
  const selectedInstance = instances.find((instance) => instance.id === selectedInstanceId);

  function instanceQuery(instanceId = selectedInstanceId) {
    return `instanceId=${encodeURIComponent(instanceId)}`;
  }

  function pushLog(title: string, ok: boolean, content: string) {
    setLogs((current) => [
      {
        id: crypto.randomUUID(),
        title,
        ok,
        content: content.trim() || "No output.",
      },
      ...current,
    ].slice(0, 8));
  }

  async function refreshStatus() {
    try {
      const response = await fetch(`${API_BASE}/api/openclaw/status?${instanceQuery()}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as StatusResponse;
      setStatus(data);
      setHealth({
        online: Boolean(data?.health?.ok),
        ready: Boolean(data?.ready?.ok && data?.ready?.data?.ready),
        detail: data?.ready?.data?.ready ? "Ready" : data?.health?.ok ? "Live" : "Offline",
      });
    } catch (error) {
      setHealth({
        online: false,
        ready: false,
        detail: error instanceof Error ? error.message : "Offline",
      });
    }
  }

  async function refreshContainers() {
    if (!terminalUnlocked) {
      return;
    }

    setIsLoadingContainers(true);
    try {
      const response = await fetch(`${API_BASE}/api/terminal/containers`, {
        cache: "no-store",
      });
      const data = await response.json();
      const nextContainers = Array.isArray(data?.containers) ? data.containers as DockerContainer[] : [];
      setContainers(nextContainers);
      setContainersError(data?.ok ? "" : data?.error || "Failed to list containers.");
      setSelectedContainer((current) => {
        if (current && nextContainers.some((container) => container.name === current)) {
          return current;
        }
        const running = nextContainers.find((container) => container.state?.toLowerCase() === "running");
        return running?.name || nextContainers[0]?.name || "";
      });
    } catch (error) {
      setContainers([]);
      setContainersError(error instanceof Error ? error.message : "Failed to list containers.");
    } finally {
      setIsLoadingContainers(false);
    }
  }

  async function refreshInstances() {
    try {
      const response = await fetch(`${API_BASE}/api/instances`, {
        cache: "no-store",
      });
      const data = await response.json();
      const nextInstances = Array.isArray(data?.instances) ? data.instances as ClawbotInstance[] : [];
      setInstances(nextInstances);
      setSelectedInstanceId((current) => {
        if (current && nextInstances.some((instance) => instance.id === current)) {
          return current;
        }
        return data?.activeId || nextInstances[0]?.id || "local";
      });
    } catch {
      setInstances([]);
    }
  }

  async function refreshUsage() {
    try {
      const response = await fetch(`${API_BASE}/api/openclaw/usage-cost?days=30&${instanceQuery()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      setUsage(data?.ok ? data.data : null);
      setUsageError(data?.ok ? "" : data?.error || data?.stderr || "Failed to load usage.");
    } catch (error) {
      setUsage(null);
      setUsageError(error instanceof Error ? error.message : "Failed to load usage.");
    }
  }

  async function runAction(title: string, endpoint: string) {
    setActiveAction(title);
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const response = await fetch(`${API_BASE}${endpoint}${separator}${instanceQuery()}`, {
        method: "POST",
      });
      const data = await response.json();
      const output = [data?.stdout, data?.stderr, data?.error].filter(Boolean).join("\n");
      pushLog(title, Boolean(data?.ok), output || JSON.stringify(data, null, 2));
      await refreshStatus();
    } catch (error) {
      pushLog(title, false, error instanceof Error ? error.message : "Request failed.");
    } finally {
      setActiveAction(null);
    }
  }

  async function loadLogs() {
    setActiveAction("Load logs");
    try {
      const response = await fetch(`${API_BASE}/api/openclaw/logs?tail=160&${instanceQuery()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      const output = [data?.stdout, data?.stderr, data?.error].filter(Boolean).join("\n");
      pushLog("Docker logs", Boolean(data?.ok), output || JSON.stringify(data, null, 2));
    } catch (error) {
      pushLog("Docker logs", false, error instanceof Error ? error.message : "Request failed.");
    } finally {
      setActiveAction(null);
    }
  }

  function sendTerminalSignal(signal: "ctrl-c" | "restart" | "clear") {
    if (!terminalUnlocked) {
      return;
    }

    if (signal === "clear") {
      terminalRef.current?.reset();
      terminalRef.current?.focus();
      return;
    }

    if (signal === "restart") {
      socketRef.current?.emit("terminal:restart");
      terminalRef.current?.write("\r\n[restarting terminal]\r\n");
      terminalRef.current?.focus();
      return;
    }

    const terminal = terminalRef.current;
    if (terminal?.hasSelection()) {
      void copyTerminalSelection(terminal);
      return;
    }

    socketRef.current?.emit("terminal:input", "\x03");
  }

  function attachContainer() {
    if (!terminalUnlocked) {
      return;
    }

    if (!socketRef.current?.connected) {
      return;
    }

    const container = selectedContainer || containers[0]?.name;
    if (!container) {
      terminalRef.current?.write("\r\n[no container selected]\r\n");
      return;
    }

    terminalRef.current?.write(`\r\n[attaching to ${container}]\r\n`);
    terminalRef.current?.focus();
    socketRef.current.emit("terminal:container", {
      name: container,
      shell: "bash",
    });
  }

  function unlockTerminal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (terminalPassword === TERMINAL_CLIENT_PASSWORD) {
      setTerminalUnlocked(true);
      setTerminalPassword("");
      setTerminalAuthError("");
      window.sessionStorage.setItem("clawbot-terminal-unlocked", "true");
      return;
    }

    setTerminalAuthError("Sai mật khẩu terminal.");
  }

  function lockTerminal() {
    setTerminalUnlocked(false);
    setTerminalConnected(false);
    setContainers([]);
    setSelectedContainer("");
    window.sessionStorage.removeItem("clawbot-terminal-unlocked");
  }

  async function createInstance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      name: instanceForm.name.trim(),
      containerName: instanceForm.containerName.trim() || undefined,
      gatewayPort: instanceForm.gatewayPort ? Number(instanceForm.gatewayPort) : undefined,
      sshPort: instanceForm.sshPort ? Number(instanceForm.sshPort) : undefined,
      token: instanceForm.token.trim() || undefined,
    };
    if (!payload.name) {
      pushLog("Create instance", false, "Instance name is required.");
      return;
    }

    setActiveAction("Create instance");
    try {
      const response = await fetch(`${API_BASE}/api/instances`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      pushLog("Create instance", Boolean(data?.ok), JSON.stringify(data, null, 2));
      if (data?.ok && data?.instance?.id) {
        setSelectedInstanceId(data.instance.id);
        setInstanceForm({ name: "", containerName: "", gatewayPort: "", sshPort: "", token: "" });
      }
      await refreshInstances();
    } catch (error) {
      pushLog("Create instance", false, error instanceof Error ? error.message : "Request failed.");
    } finally {
      setActiveAction(null);
    }
  }

  async function setActiveInstance(instanceId: string) {
    setActiveAction("Set active instance");
    try {
      const response = await fetch(`${API_BASE}/api/instances/active`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instanceId }),
      });
      const data = await response.json();
      pushLog("Set active instance", Boolean(data?.ok), JSON.stringify(data, null, 2));
      setSelectedInstanceId(instanceId);
      await refreshInstances();
      await refreshStatus();
      await refreshUsage();
    } catch (error) {
      pushLog("Set active instance", false, error instanceof Error ? error.message : "Request failed.");
    } finally {
      setActiveAction(null);
    }
  }

  async function instanceAction(title: string, instanceId: string, action: "start" | "stop" | "restart") {
    setActiveAction(title);
    try {
      const response = await fetch(`${API_BASE}/api/instances/${encodeURIComponent(instanceId)}/${action}`, {
        method: "POST",
      });
      const data = await response.json();
      const output = [data?.stdout, data?.stderr, data?.error].filter(Boolean).join("\n");
      pushLog(title, Boolean(data?.ok), output || JSON.stringify(data, null, 2));
      await refreshInstances();
      await refreshStatus();
      await refreshContainers();
    } catch (error) {
      pushLog(title, false, error instanceof Error ? error.message : "Request failed.");
    } finally {
      setActiveAction(null);
    }
  }

  async function deleteInstance(instance: ClawbotInstance) {
    const confirmed = window.confirm(
      `Delete ${instance.name}?\n\nThis removes only the managed Clawbot container ${instance.containerName} and its Clawbot volume.`,
    );
    if (!confirmed) {
      return;
    }

    setActiveAction("Delete instance");
    try {
      const response = await fetch(`${API_BASE}/api/instances/${encodeURIComponent(instance.id)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      const output = [
        data?.container?.stdout,
        data?.container?.stderr,
        data?.volume?.stdout,
        data?.volume?.stderr,
        data?.error,
      ].filter(Boolean).join("\n");
      pushLog("Delete instance", Boolean(data?.ok), output || JSON.stringify(data, null, 2));
      await refreshInstances();
      await refreshContainers();
      await refreshStatus();
      await refreshUsage();
    } catch (error) {
      pushLog("Delete instance", false, error instanceof Error ? error.message : "Request failed.");
    } finally {
      setActiveAction(null);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || isSending) {
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        content,
      },
    ]);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch(`${API_BASE}/api/openclaw/chat?${instanceQuery()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: content,
          model: "openclaw",
          maxOutputTokens: 768,
        }),
      });
      const data = await response.json();
      const output =
        data?.outputText ||
        data?.data?.output_text ||
        data?.error ||
        data?.data?.error?.message ||
        "No response text returned.";

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: output,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: error instanceof Error ? error.message : "Request failed.",
        },
      ]);
    } finally {
      setIsSending(false);
      void refreshStatus();
    }
  }

  useEffect(() => {
    setTerminalUnlocked(window.sessionStorage.getItem("clawbot-terminal-unlocked") === "true");
    void refreshInstances();
    void refreshStatus();
    void refreshContainers();
    void refreshUsage();
    const statusTimer = window.setInterval(() => void refreshStatus(), 15000);
    const containerTimer = window.setInterval(() => void refreshContainers(), 5000);
    const usageTimer = window.setInterval(() => void refreshUsage(), 60000);
    return () => {
      window.clearInterval(statusTimer);
      window.clearInterval(containerTimer);
      window.clearInterval(usageTimer);
    };
    // The polling loop intentionally captures the current selected instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMessages([
      {
        id: "hello",
        role: "assistant",
        content: selectedInstance
          ? `Chat is using ${selectedInstance.name} on ${selectedInstance.baseUrl}.`
          : "Select or create a Clawbot instance, then send a message here.",
      },
    ]);
    void refreshStatus();
    void refreshUsage();
    // This effect is keyed by instance id so switching instances resets the chat thread once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstanceId]);

  useEffect(() => {
    if (!terminalUnlocked) {
      return undefined;
    }

    const terminalHost = terminalHostRef.current;
    if (!terminalHost) {
      return undefined;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "Consolas, 'Cascadia Mono', monospace",
      fontSize: 12,
      rows: 18,
      theme: {
        background: "#10120f",
        foreground: "#f3efe4",
        cursor: "#f3efe4",
        selectionBackground: "#355f52",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHost);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const fitTerminal = () => {
      try {
        fitAddon.fit();
        socketRef.current?.emit("terminal:resize", {
          cols: terminal.cols,
          rows: terminal.rows,
        });
      } catch {
        // xterm can throw while the container is hidden during hot reload.
      }
    };

    const dataListener = terminal.onData((data) => {
      socketRef.current?.emit("terminal:input", data);
    });
    const pasteListener = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) {
        return;
      }

      event.preventDefault();
      socketRef.current?.emit("terminal:input", text.replace(/\r\n/g, "\r").replace(/\n/g, "\r"));
    };
    terminalHost.addEventListener("paste", pasteListener);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }

      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "c") {
        if (terminal.hasSelection()) {
          event.preventDefault();
          void copyTerminalSelection(terminal);
          return false;
        }
        return true;
      }

      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "v") {
        return true;
      }

      const input = getSpecialTerminalInput(event);
      if (input === null) {
        return true;
      }

      event.preventDefault();
      socketRef.current?.emit("terminal:input", input);
      return false;
    });
    window.setTimeout(fitTerminal, 0);
    window.setTimeout(() => terminal.focus(), 0);
    window.addEventListener("resize", fitTerminal);

    return () => {
      window.removeEventListener("resize", fitTerminal);
      terminalHost.removeEventListener("paste", pasteListener);
      dataListener.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalUnlocked]);

  useEffect(() => {
    if (!terminalUnlocked) {
      setTerminalConnected(false);
      return undefined;
    }

    const socket = io(`${API_BASE}/terminal`, {
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setTerminalConnected(true);
      terminalRef.current?.write("[connected]\r\n");
      if (terminalRef.current) {
        socket.emit("terminal:resize", {
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
        });
      }
      void refreshContainers();
    });

    socket.on("disconnect", () => {
      setTerminalConnected(false);
      terminalRef.current?.write("\r\n[disconnected]\r\n");
    });

    socket.on("terminal:data", (chunk: string) => {
      terminalRef.current?.write(normalizeTerminalChunk(chunk));
    });

    socket.on("connect_error", (error) => {
      setTerminalConnected(false);
      terminalRef.current?.write(`\r\n[terminal error] ${error.message}\r\n`);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // The socket must be recreated only when the terminal lock state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalUnlocked]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  return (
    <main className="min-h-screen bg-[#f6f5f1] text-[#1d1d1b]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-[#d8d3c8] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-[#626056]">
              Clawbot server console
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-[#171714] sm:text-3xl">
              OpenClaw Setup
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedInstanceId}
              onChange={(event) => setActiveInstance(event.target.value)}
              className="h-10 min-w-44 rounded-lg border border-[#cfc8ba] bg-white px-3 text-sm font-semibold outline-none transition focus:border-[#175c4c] focus:ring-2 focus:ring-[#175c4c]/20"
            >
              {instances.length ? (
                instances.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.name}
                  </option>
                ))
              ) : (
                <option value="local">Local OpenClaw</option>
              )}
            </select>
            <StatusPill ok={health.online} label={health.detail} />
            <button
              type="button"
              onClick={() => void refreshStatus()}
              className="flex h-10 items-center gap-2 rounded-lg border border-[#25251f] bg-[#25251f] px-3 text-sm font-medium text-white transition hover:bg-[#3a3a32]"
            >
              <RefreshIcon />
              Refresh
            </button>
          </div>
        </header>

        <nav className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("console")}
            className={`h-10 rounded-lg px-4 text-sm font-semibold transition ${
              activeTab === "console"
                ? "bg-[#175c4c] text-white"
                : "border border-[#cfc8ba] bg-white text-[#25251f] hover:bg-[#f0ece4]"
            }`}
          >
            Console
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("instances")}
            className={`h-10 rounded-lg px-4 text-sm font-semibold transition ${
              activeTab === "instances"
                ? "bg-[#175c4c] text-white"
                : "border border-[#cfc8ba] bg-white text-[#25251f] hover:bg-[#f0ece4]"
            }`}
          >
            Instances
          </button>
        </nav>

        {activeTab === "instances" ? (
          <section className="grid flex-1 grid-cols-1 gap-5 py-5 xl:grid-cols-[420px_1fr]">
            <section className="rounded-lg border border-[#d8d3c8] bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold">Create Instance</h2>
              <form onSubmit={createInstance} className="mt-4 space-y-3">
                <label className="block text-sm font-semibold">
                  Name
                  <input
                    value={instanceForm.name}
                    onChange={(event) => setInstanceForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="research-bot"
                    className="mt-1 h-10 w-full rounded-lg border border-[#cfc8ba] px-3 text-sm font-normal outline-none transition focus:border-[#175c4c] focus:ring-2 focus:ring-[#175c4c]/20"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Container name
                  <input
                    value={instanceForm.containerName}
                    onChange={(event) => setInstanceForm((current) => ({ ...current, containerName: event.target.value }))}
                    placeholder="openclaw-research-bot"
                    className="mt-1 h-10 w-full rounded-lg border border-[#cfc8ba] px-3 text-sm font-normal outline-none transition focus:border-[#175c4c] focus:ring-2 focus:ring-[#175c4c]/20"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm font-semibold">
                    Gateway port
                    <input
                      value={instanceForm.gatewayPort}
                      onChange={(event) => setInstanceForm((current) => ({ ...current, gatewayPort: event.target.value }))}
                      placeholder="18790"
                      inputMode="numeric"
                      className="mt-1 h-10 w-full rounded-lg border border-[#cfc8ba] px-3 text-sm font-normal outline-none transition focus:border-[#175c4c] focus:ring-2 focus:ring-[#175c4c]/20"
                    />
                  </label>
                  <label className="block text-sm font-semibold">
                    SSH port
                    <input
                      value={instanceForm.sshPort}
                      onChange={(event) => setInstanceForm((current) => ({ ...current, sshPort: event.target.value }))}
                      placeholder="2223"
                      inputMode="numeric"
                      className="mt-1 h-10 w-full rounded-lg border border-[#cfc8ba] px-3 text-sm font-normal outline-none transition focus:border-[#175c4c] focus:ring-2 focus:ring-[#175c4c]/20"
                    />
                  </label>
                </div>
                <label className="block text-sm font-semibold">
                  Gateway token
                  <input
                    value={instanceForm.token}
                    onChange={(event) => setInstanceForm((current) => ({ ...current, token: event.target.value }))}
                    placeholder="leave blank to generate"
                    className="mt-1 h-10 w-full rounded-lg border border-[#cfc8ba] px-3 text-sm font-normal outline-none transition focus:border-[#175c4c] focus:ring-2 focus:ring-[#175c4c]/20"
                  />
                </label>
                <button
                  type="submit"
                  disabled={Boolean(activeAction)}
                  className="h-11 w-full rounded-lg bg-[#175c4c] px-3 text-sm font-semibold text-white transition hover:bg-[#1f715e] disabled:cursor-not-allowed disabled:bg-[#9ca69f]"
                >
                  Create instance
                </button>
              </form>
            </section>

            <section className="rounded-lg border border-[#d8d3c8] bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Clawbot Instances</h2>
                <button
                  type="button"
                  onClick={() => void refreshInstances()}
                  className="text-sm font-semibold text-[#175c4c] hover:underline"
                >
                  Refresh
                </button>
              </div>
              <div className="mt-4 grid gap-3">
                {instances.map((instance) => (
                  <article
                    key={instance.id}
                    className={`rounded-lg border p-4 ${
                      instance.id === selectedInstanceId
                        ? "border-[#86b894] bg-[#edf8ef]"
                        : "border-[#e2ded4] bg-[#fbfaf7]"
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold">{instance.name}</h3>
                          {instance.id === selectedInstanceId ? <StatusPill ok label="Active" /> : null}
                        </div>
                        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                          <div className="min-w-0">
                            <dt className="text-[#626056]">Container</dt>
                            <dd className="truncate font-semibold" title={instance.containerName}>{instance.containerName}</dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-[#626056]">Gateway</dt>
                            <dd className="truncate font-semibold" title={instance.baseUrl}>{instance.baseUrl}</dd>
                          </div>
                          <div>
                            <dt className="text-[#626056]">SSH</dt>
                            <dd className="font-semibold">{SSH_HOST_LABEL}:{instance.sshPort}</dd>
                          </div>
                          <div>
                            <dt className="text-[#626056]">Token</dt>
                            <dd className="font-semibold">{instance.token}</dd>
                          </div>
                        </dl>
                      </div>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <button
                          type="button"
                          onClick={() => void setActiveInstance(instance.id)}
                          disabled={Boolean(activeAction)}
                          className="rounded-lg border border-[#cfc8ba] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-[#f0ece4] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                        >
                          Set active
                        </button>
                        <button
                          type="button"
                          onClick={() => void instanceAction("Start instance", instance.id, "start")}
                          disabled={Boolean(activeAction)}
                          className="rounded-lg border border-[#cfc8ba] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-[#f0ece4] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                        >
                          Start
                        </button>
                        <button
                          type="button"
                          onClick={() => void instanceAction("Stop instance", instance.id, "stop")}
                          disabled={Boolean(activeAction)}
                          className="rounded-lg border border-[#cfc8ba] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-[#f0ece4] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                        >
                          Stop
                        </button>
                        <button
                          type="button"
                          onClick={() => void instanceAction("Restart instance", instance.id, "restart")}
                          disabled={Boolean(activeAction)}
                          className="rounded-lg border border-[#cfc8ba] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-[#f0ece4] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                        >
                          Restart
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteInstance(instance)}
                          disabled={Boolean(activeAction)}
                          className="rounded-lg border border-[#ead0ca] bg-[#fff2ef] px-3 py-2 text-xs font-semibold text-[#a23625] transition hover:bg-[#ffe5df] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
                {!instances.length ? (
                  <p className="text-sm text-[#626056]">No instances yet.</p>
                ) : null}
              </div>
            </section>
          </section>
        ) : (
        <section className="grid flex-1 grid-cols-1 gap-5 py-5 xl:grid-cols-[460px_1fr]">
          <div className="space-y-5">
            <section className="rounded-lg border border-[#d8d3c8] bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Setup Status</h2>
                <a
                  href={`${API_BASE}/api/docs`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-[#175c4c] hover:underline"
                >
                  Swagger
                </a>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <StatusPill ok={Boolean(status?.hasGatewayToken)} label="Gateway token" />
                <StatusPill ok={Boolean(status?.health?.ok)} label="Gateway live" />
                <StatusPill ok={Boolean(status?.ready?.ok && status?.ready?.data?.ready)} label="Gateway ready" />
                <StatusPill ok={Boolean(status?.models?.ok && modelIds.length)} label="Models API" />
              </div>

              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[#626056]">Backend</dt>
                  <dd className="max-w-[260px] truncate font-medium" title={API_BASE}>
                    {API_BASE.replace(/^https?:\/\//, "")}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[#626056]">OpenClaw</dt>
                  <dd className="max-w-[260px] truncate font-medium" title={status?.openclawBaseUrl || ""}>
                    {status?.openclawBaseUrl?.replace(/^https?:\/\//, "") || "Unknown"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[#626056]">Project root</dt>
                  <dd className="max-w-[260px] truncate font-medium" title={status?.rootDir || ""}>
                    {status?.rootDir || "Unknown"}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-lg border border-[#d8d3c8] bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold">Actions</h2>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void runAction("Enable OpenResponses", "/api/openclaw/enable-responses")}
                  disabled={Boolean(activeAction)}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#175c4c] px-3 text-sm font-semibold text-white transition hover:bg-[#1f715e] disabled:cursor-not-allowed disabled:bg-[#9ca69f]"
                >
                  <WrenchIcon />
                  Enable API
                </button>
                <button
                  type="button"
                  onClick={() => void runAction("Build Docker stack", "/api/openclaw/docker/build")}
                  disabled={Boolean(activeAction)}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#25251f] bg-[#25251f] px-3 text-sm font-semibold text-white transition hover:bg-[#3a3a32] disabled:cursor-not-allowed disabled:bg-[#9ca69f]"
                >
                  <WrenchIcon />
                  Build
                </button>
                <button
                  type="button"
                  onClick={() => void runAction("Start Docker stack", "/api/openclaw/docker/start")}
                  disabled={Boolean(activeAction)}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#cfc8ba] bg-[#fbfaf7] px-3 text-sm font-semibold transition hover:bg-[#f0ece4] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                >
                  <PowerIcon />
                  Start
                </button>
                <button
                  type="button"
                  onClick={() => void runAction("Stop Docker stack", "/api/openclaw/docker/stop")}
                  disabled={Boolean(activeAction)}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#cfc8ba] bg-[#fbfaf7] px-3 text-sm font-semibold transition hover:bg-[#f0ece4] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                >
                  <PowerIcon />
                  Stop
                </button>
                <button
                  type="button"
                  onClick={() => void runAction("Restart Docker stack", "/api/openclaw/docker/restart")}
                  disabled={Boolean(activeAction)}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#cfc8ba] bg-[#fbfaf7] px-3 text-sm font-semibold transition hover:bg-[#f0ece4] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                >
                  <RefreshIcon />
                  Restart
                </button>
                <button
                  type="button"
                  onClick={() => void loadLogs()}
                  disabled={Boolean(activeAction)}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#cfc8ba] bg-[#fbfaf7] px-3 text-sm font-semibold transition hover:bg-[#f0ece4] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                >
                  <LogIcon />
                  Logs
                </button>
              </div>
              <p className="mt-3 text-sm text-[#626056]">
                {activeAction ? `${activeAction} is running...` : "Actions call the NestJS backend, then backend controls OpenClaw or Docker."}
              </p>
            </section>

            <section className="rounded-lg border border-[#d8d3c8] bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold">Models</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {modelIds.length ? (
                  modelIds.map((id) => (
                    <span key={id} className="rounded-lg bg-[#edf8ef] px-3 py-1.5 text-xs font-semibold text-[#126534]">
                      {id}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-[#626056]">No model list yet.</span>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-[#d8d3c8] bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Usage</h2>
                <button
                  type="button"
                  onClick={() => void refreshUsage()}
                  className="text-sm font-semibold text-[#175c4c] hover:underline"
                >
                  Refresh
                </button>
              </div>
              {usageError ? (
                <p className="mt-3 text-sm font-semibold text-[#a23625]">{usageError}</p>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-[#e2ded4] bg-[#fbfaf7] p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#626056]">30 day tokens</p>
                      <p className="mt-1 text-xl font-semibold">{formatNumber(usage?.totals?.totalTokens)}</p>
                    </div>
                    <div className="rounded-lg border border-[#e2ded4] bg-[#fbfaf7] p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#626056]">30 day cost</p>
                      <p className="mt-1 text-xl font-semibold">{formatCurrency(usage?.totals?.totalCost)}</p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-[#626056]">Input</dt>
                      <dd className="font-semibold">{formatNumber(usage?.totals?.input)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-[#626056]">Output</dt>
                      <dd className="font-semibold">{formatNumber(usage?.totals?.output)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-[#626056]">Cache read</dt>
                      <dd className="font-semibold">{formatNumber(usage?.totals?.cacheRead)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-[#626056]">Cache write</dt>
                      <dd className="font-semibold">{formatNumber(usage?.totals?.cacheWrite)}</dd>
                    </div>
                  </dl>
                  {latestUsageDay ? (
                    <p className="text-xs text-[#626056]">
                      Latest: <span className="font-semibold">{latestUsageDay.date}</span> - {formatNumber(latestUsageDay.totalTokens)} tokens - {formatCurrency(latestUsageDay.totalCost)}
                    </p>
                  ) : (
                    <p className="text-xs text-[#626056]">No usage found in the selected window.</p>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-[#d8d3c8] bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Terminal</h2>
                <div className="flex items-center gap-3">
                  <span className={terminalConnected ? "text-xs font-semibold text-[#126534]" : "text-xs font-semibold text-[#a23625]"}>
                    {terminalUnlocked ? (terminalConnected ? "Connected shell" : "Disconnected") : "Locked"}
                  </span>
                  {terminalUnlocked ? (
                    <button
                      type="button"
                      onClick={lockTerminal}
                      className="rounded-lg border border-[#d8d3c8] bg-[#fbfaf7] px-3 py-1.5 text-xs font-semibold transition hover:bg-[#f0ece4]"
                    >
                      Lock
                    </button>
                  ) : null}
                </div>
              </div>

              {!terminalUnlocked ? (
                <form onSubmit={unlockTerminal} className="mt-4 rounded-lg border border-[#e2ded4] bg-[#fbfaf7] p-4">
                  <label className="text-sm font-semibold text-[#1d1d1b]" htmlFor="terminal-password">
                    Terminal password
                  </label>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      id="terminal-password"
                      type="password"
                      value={terminalPassword}
                      onChange={(event) => {
                        setTerminalPassword(event.target.value);
                        setTerminalAuthError("");
                      }}
                      className="h-10 min-w-0 rounded-lg border border-[#cfc8ba] bg-white px-3 text-sm outline-none transition focus:border-[#175c4c] focus:ring-2 focus:ring-[#175c4c]/20"
                      placeholder="Nhập mật khẩu để mở terminal"
                    />
                    <button
                      type="submit"
                      className="h-10 rounded-lg bg-[#175c4c] px-4 text-sm font-semibold text-white transition hover:bg-[#10483b]"
                    >
                      Unlock
                    </button>
                  </div>
                  <p className={terminalAuthError ? "mt-2 text-xs font-semibold text-[#a23625]" : "mt-2 text-xs text-[#626056]"}>
                    {terminalAuthError || "Terminal sẽ không kết nối socket cho tới khi mở khóa."}
                  </p>
                </form>
              ) : (
                <>
                  <div className="mt-4 rounded-lg border border-[#e2ded4] bg-[#fbfaf7] p-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <select
                        value={selectedContainer}
                        onChange={(event) => setSelectedContainer(event.target.value)}
                        className="h-10 min-w-0 rounded-lg border border-[#cfc8ba] bg-white px-3 text-sm outline-none transition focus:border-[#175c4c] focus:ring-2 focus:ring-[#175c4c]/20"
                      >
                        {containers.length ? (
                          containers.map((container) => (
                            <option key={container.id || container.name} value={container.name}>
                              {container.name} - {container.state}
                            </option>
                          ))
                        ) : (
                          <option value="">No containers</option>
                        )}
                      </select>
                      <button
                        type="button"
                        onClick={() => void refreshContainers()}
                        disabled={isLoadingContainers}
                        className="h-10 rounded-lg border border-[#cfc8ba] bg-white px-3 text-sm font-semibold transition hover:bg-[#f0ece4] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                      >
                        {isLoadingContainers ? "Loading" : "Refresh"}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <p className={containersError ? "font-semibold text-[#a23625]" : "text-[#626056]"}>
                        {containersError || `${containers.length} container${containers.length === 1 ? "" : "s"} found`}
                      </p>
                      <p className="max-w-full truncate text-[#626056]" title={`GET ${API_BASE}/api/terminal/containers`}>
                        GET {API_BASE}/api/terminal/containers
                      </p>
                    </div>
                    {selectedContainerInfo ? (
                      <p className="mt-2 truncate text-xs text-[#626056]" title={`${selectedContainerInfo.name} - ${selectedContainerInfo.status} - ${selectedContainerInfo.image}`}>
                        Selected: <span className="font-semibold">{selectedContainerInfo.name}</span>
                        <span> - {selectedContainerInfo.status} - {selectedContainerInfo.image}</span>
                      </p>
                    ) : null}
                  </div>

                  <div
                    className="mt-4 h-80 min-w-0 overflow-hidden rounded-lg bg-[#10120f] p-2 text-white"
                    onClick={() => terminalRef.current?.focus()}
                  >
                    <div ref={terminalHostRef} className="h-full min-w-0 [&_.xterm]:h-full" />
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    <p className="text-xs text-[#626056]">
                      Click vào vùng terminal rồi gõ trực tiếp như terminal bình thường.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => sendTerminalSignal("ctrl-c")}
                        disabled={!terminalConnected}
                        className="rounded-lg border border-[#d8d3c8] bg-[#fbfaf7] px-3 py-1.5 text-xs font-semibold transition hover:bg-[#f0ece4] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                      >
                        Ctrl+C
                      </button>
                      <button
                        type="button"
                        onClick={() => sendTerminalSignal("restart")}
                        disabled={!terminalConnected}
                        className="rounded-lg border border-[#d8d3c8] bg-[#fbfaf7] px-3 py-1.5 text-xs font-semibold transition hover:bg-[#f0ece4] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                      >
                        Restart shell
                      </button>
                      <button
                        type="button"
                        onClick={attachContainer}
                        disabled={!terminalConnected || !selectedContainer}
                        className="rounded-lg border border-[#d8d3c8] bg-[#fbfaf7] px-3 py-1.5 text-xs font-semibold transition hover:bg-[#f0ece4] disabled:cursor-not-allowed disabled:text-[#9c978e]"
                      >
                        Attach container
                      </button>
                      <button
                        type="button"
                        onClick={() => sendTerminalSignal("clear")}
                        className="rounded-lg border border-[#d8d3c8] bg-[#fbfaf7] px-3 py-1.5 text-xs font-semibold transition hover:bg-[#f0ece4]"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>

            <section className="rounded-lg border border-[#d8d3c8] bg-[#25251f] p-4 text-white shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Action Output</h2>
                <span className="text-xs text-[#d8d3c8]">{logs.length} recent</span>
              </div>
              <div className="mt-3 max-h-80 space-y-3 overflow-y-auto">
                {logs.length ? (
                  logs.map((log) => (
                    <article key={log.id} className="rounded-lg bg-black/25 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">{log.title}</h3>
                        <span className={log.ok ? "text-xs text-[#8fd29d]" : "text-xs text-[#ffad9f]"}>
                          {log.ok ? "OK" : "Failed"}
                        </span>
                      </div>
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[#f3efe4]">
                        {log.content}
                      </pre>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[#d8d3c8]">Run an action to see output here.</p>
                )}
              </div>
            </section>
          </div>

          <div className="flex min-h-[78vh] flex-col overflow-hidden rounded-lg border border-[#d8d3c8] bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-[#e2ded4] px-4 py-3">
              <div>
                <h2 className="text-base font-semibold">Chat Test</h2>
                <p className="text-sm text-[#626056]">Uses POST {API_BASE}/api/openclaw/chat</p>
              </div>
              <StatusPill ok={health.ready} label={health.ready ? "Ready" : "Not ready"} />
            </div>

            <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[82%] rounded-lg px-4 py-3 text-sm leading-6 shadow-sm sm:max-w-[72%] ${
                      message.role === "user"
                        ? "bg-[#175c4c] text-white"
                        : "border border-[#e2ded4] bg-[#fbfaf7] text-[#242420]"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  </div>
                </article>
              ))}
              {isSending ? (
                <article className="flex justify-start">
                  <div className="rounded-lg border border-[#e2ded4] bg-[#fbfaf7] px-4 py-3 text-sm text-[#626056] shadow-sm">
                    Thinking...
                  </div>
                </article>
              ) : null}
            </div>

            <form onSubmit={sendMessage} className="border-t border-[#e2ded4] bg-[#fbfaf7] p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  rows={3}
                  placeholder="Message OpenClaw..."
                  className="min-h-24 flex-1 resize-none rounded-lg border border-[#cfc8ba] bg-white px-3 py-3 text-sm leading-6 outline-none transition focus:border-[#175c4c] focus:ring-2 focus:ring-[#175c4c]/20"
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  className="flex h-12 items-center justify-center gap-2 rounded-lg bg-[#175c4c] px-5 text-sm font-semibold text-white transition hover:bg-[#1f715e] disabled:cursor-not-allowed disabled:bg-[#9ca69f] sm:self-end"
                >
                  <SendIcon />
                  Send
                </button>
              </div>
            </form>
          </div>
        </section>
        )}
      </div>
    </main>
  );
}
