import React, { useEffect, useRef, useState } from "react";
import Button from "./common/Button";
import Icon from "./common/Icon";
import CodeEditor from "./contentviews/CodeEditor";
import { fetchApi } from "../utils";
import { useAppDispatch, useAppSelector } from "../ducks";
import { hideModal } from "../ducks/ui/modal";

export type InterceptRule = {
    id: string;
    name: string;
    enabled: boolean;
    filter: string;
    action: "breakpoint" | "mock" | "delay";
    intercept_phase?: "request" | "response" | "both";
    delay_ms?: number;
    mock_config?: {
        status_code?: number;
        headers?: Record<string, string>;
        data_source?: "inline" | "file";
        file_path?: string;
        body?: string;
        processor_type?: "raw" | "script";
        script_handler?: string;
    };
};

export type ServerMockFile = {
    name: string;
    path: string;
    size: number;
    mtime: number;
};

// 根据文件后缀推断常见的 MIME Content-Type
const guessContentType = (filename: string): string => {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    switch (ext) {
        case "json":
            return "application/json;charset=UTF-8";
        case "txt":
        case "log":
            return "text/plain;charset=UTF-8";
        case "html":
        case "htm":
            return "text/html;charset=UTF-8";
        case "xml":
            return "application/xml;charset=UTF-8";
        case "js":
            return "application/javascript;charset=UTF-8";
        case "css":
            return "text/css;charset=UTF-8";
        case "png":
            return "image/png";
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "gif":
            return "image/gif";
        case "webp":
            return "image/webp";
        case "svg":
            return "image/svg+xml";
        case "mp3":
            return "audio/mpeg";
        case "mp4":
            return "video/mp4";
        case "pdf":
            return "application/pdf";
        case "zip":
            return "application/zip";
        case "svga":
        case "bin":
        case "dat":
            return "application/octet-stream";
        default:
            return "application/octet-stream";
    }
};

export default function RulesView() {
    const dispatch = useAppDispatch();
    const modalData = useAppSelector((state) => state.ui.modal.modalData);
    const [rules, setRules] = useState<InterceptRule[]>([]);
    const [availableHandlers, setAvailableHandlers] = useState<string[]>([]);
    const [serverFiles, setServerFiles] = useState<ServerMockFile[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [editingRule, setEditingRule] = useState<InterceptRule | null>(null);
    const [status, setStatus] = useState<{
        type: "success" | "error" | "info";
        msg: string;
    } | null>(null);

    const toastTimerRef = useRef<any>(null);

    const showToast = (type: "success" | "error" | "info", msg: string) => {
        if (toastTimerRef.current) {
            clearTimeout(toastTimerRef.current);
        }
        setStatus({ type, msg });
        toastTimerRef.current = setTimeout(() => {
            setStatus(null);
            toastTimerRef.current = null;
        }, 2500);
    };

    // 当前准备删除的文件对象（用于在当前行内就地展开删除确认，不受 overflow 限制遮挡）
    const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<{
        path: string;
        name: string;
    } | null>(null);

    // 响应头是否展开折叠
    const [showHeadersConfig, setShowHeadersConfig] = useState<boolean>(false);

    useEffect(() => {
        loadRules();
        loadServerFiles();

        // 如果是通过 flow 上的“添加拦截规则”打开，自动直接进入新建/编辑视图，并预填去掉参数后的完整请求路径
        if (modalData?.initialUrl) {
            const url = modalData.initialUrl;
            let fullUrlWithoutQuery = url;
            let pathNameOnly = url;
            try {
                // 如果是标准完整 URL (http://... 或 https://...)
                const parsed = new URL(url);
                fullUrlWithoutQuery = `${parsed.origin}${parsed.pathname}`;
                pathNameOnly = parsed.pathname || url;
            } catch {
                // 如果没有 scheme，或者只是 host/path 形式，截断问号及之后 Query 参数
                fullUrlWithoutQuery = url.split("?")[0];
                const parts = fullUrlWithoutQuery.split("/");
                pathNameOnly = parts.length > 1 ? "/" + parts.slice(1).join("/") : fullUrlWithoutQuery;
            }

            setEditingRule({
                id: "rule_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
                name: pathNameOnly,
                enabled: true,
                filter: fullUrlWithoutQuery,
                action: "breakpoint",
                intercept_phase: "both",
                mock_config: {
                    status_code: 200,
                    data_source: "inline",
                    file_path: "",
                    body: "{\n  \"code\": 0\n}",
                    processor_type: "raw",
                    script_handler: "",
                },
            });
        }

        return () => {
            if (toastTimerRef.current) {
                clearTimeout(toastTimerRef.current);
            }
        };
    }, []);

    const loadRules = async () => {
        setLoading(true);
        try {
            const resp = await fetchApi("/intercept_rules");
            if (resp.ok) {
                const data = await resp.json();
                setRules(Array.isArray(data.rules) ? data.rules : []);
                setAvailableHandlers(Array.isArray(data.handlers) ? data.handlers : []);
            }
        } catch (e: any) {
            showToast("error", `加载规则失败: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const loadServerFiles = async () => {
        try {
            const resp = await fetchApi("/mock_files");
            if (resp.ok) {
                const data = await resp.json();
                setServerFiles(Array.isArray(data.files) ? data.files : []);
            }
        } catch (e: any) {
            console.error("加载服务器文件列表失败:", e);
        }
    };

    const handleToggleRule = async (rule: InterceptRule) => {
        const nextEnabled = !rule.enabled;
        setRules(rules.map((r) => (r.id === rule.id ? { ...r, enabled: nextEnabled } : r)));
        try {
            const resp = await fetchApi.post(`/intercept_rules/${rule.id}/toggle`, {
                enabled: nextEnabled,
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data.rules) {
                    setRules(data.rules);
                }
            }
        } catch (e: any) {
            showToast("error", `切换开关失败: ${e.message}`);
            setRules(rules);
        }
    };

    const handleSaveRules = async (newRules: InterceptRule[]) => {
        try {
            const resp = await fetchApi.put("/intercept_rules", { rules: newRules });
            if (resp.ok) {
                const data = await resp.json();
                setRules(data.rules || []);
                showToast("success", "规则已保存并即时生效");
            } else {
                const errText = await resp.text();
                showToast("error", `保存规则失败: ${errText}`);
            }
        } catch (e: any) {
            showToast("error", `网络请求失败: ${e.message}`);
        }
    };

    const handleDeleteRule = (id: string) => {
        const next = rules.filter((r) => r.id !== id);
        setRules(next);
        handleSaveRules(next);
    };

    const handleAddNewRule = () => {
        const newRule: InterceptRule = {
            id: `rule_${Date.now()}`,
            name: "新规则",
            enabled: true,
            filter: "/api/example",
            action: "breakpoint",
            intercept_phase: "both",
            mock_config: {
                status_code: 200,
                headers: {
                    "Content-Type": "application/json;charset=UTF-8",
                },
                data_source: "inline",
                file_path: "",
                body: "{\n  \"code\": 0,\n  \"msg\": \"ok\"\n}",
                processor_type: "raw",
                script_handler: availableHandlers.length > 0 ? availableHandlers[0] : "",
            },
        };
        setEditingRule(newRule);
    };

    const handleSaveEditingRule = () => {
        if (!editingRule) return;
        if (!editingRule.name.trim()) {
            showToast("error", "规则名称不能为空");
            return;
        }
        if (!editingRule.filter.trim()) {
            showToast("error", "匹配条件不能为空");
            return;
        }

        const exists = rules.some((r) => r.id === editingRule.id);
        const next = exists
            ? rules.map((r) => (r.id === editingRule.id ? editingRule : r))
            : [...rules, editingRule];

        setRules(next);
        setEditingRule(null);
        handleSaveRules(next);
    };

    // 选择并直接载入本地文件到编辑器（文本）
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !editingRule) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result;
            if (typeof content === "string") {
                const autoContentType = guessContentType(file.name);
                const currentHeaders = { ...(editingRule.mock_config?.headers || {}) };
                currentHeaders["Content-Type"] = autoContentType;

                setEditingRule({
                    ...editingRule,
                    mock_config: {
                        ...editingRule.mock_config,
                        data_source: "inline",
                        body: content,
                        headers: currentHeaders,
                    },
                });
                showToast("success", `已成功导入文件内容: ${file.name}`);
            }
        };
        reader.readAsText(file);
    };

    // 上传文件到服务器的 mock_files 目录（支持任意文本/二进制文件）
    const handleUploadToServer = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !editingRule) return;
        try {
            const formData = new FormData();
            formData.append("file", file);
            const resp = await fetchApi("/mock_files", {
                method: "POST",
                body: formData,
            });
            if (resp.ok) {
                const data = await resp.json();
                const uploaded = data.uploaded;
                setServerFiles(data.files || []);
                // 自动根据文件名推测 Content-Type
                const autoContentType = guessContentType(uploaded.name);
                const currentHeaders = { ...(editingRule.mock_config?.headers || {}) };
                currentHeaders["Content-Type"] = autoContentType;

                // 自动单选刚上传的文件，并智能更新 Content-Type
                setEditingRule({
                    ...editingRule,
                    mock_config: {
                        ...editingRule.mock_config,
                        data_source: "file",
                        file_path: uploaded.path,
                        headers: currentHeaders,
                    },
                });
                showToast("success", `文件已上传并选中: ${uploaded.name}`);
            } else {
                const errText = await resp.text();
                showToast("error", `上传到服务器失败: ${errText}`);
            }
        } catch (err: any) {
            showToast("error", `网络错误: ${err.message}`);
        }
    };

    // 执行删除服务器文件
    const executeDeleteServerFile = async (filePath: string) => {
        const fileName = filePath.split("/").pop() || filePath;
        try {
            const resp = await fetchApi(`/mock_files?filename=${encodeURIComponent(fileName)}`, {
                method: "DELETE",
            });
            if (resp.ok) {
                const data = await resp.json();
                setServerFiles(data.files || []);
                if (editingRule && editingRule.mock_config?.file_path === filePath) {
                    setEditingRule({
                        ...editingRule,
                        mock_config: {
                            ...editingRule.mock_config,
                            file_path: "",
                        },
                    });
                }
                // 删除成功静默完成，列表自动剔除该项，不弹顶部任何提示条，保持页面完全稳定
            } else {
                const errText = await resp.text();
                showToast("error", `删除失败: ${errText}`);
            }
        } catch (err: any) {
            showToast("error", `网络错误: ${err.message}`);
        } finally {
            setConfirmDeleteTarget(null);
        }
    };

    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                maxHeight: "calc(100vh - 120px)",
                padding: "16px 20px 20px 20px",
                overflowY: editingRule ? "hidden" : "auto",
                boxSizing: "border-box",
                background: "var(--mitmweb-bg)",
                color: "var(--mitmweb-fg)",
            }}
            onClick={() => {
                // 点击空白处关闭删除确认
                if (confirmDeleteTarget) {
                    setConfirmDeleteTarget(null);
                }
            }}
        >
            {/* 浮层 Toast 提示：固定悬浮于页面顶部，彻底避免推挤内容下移导致颠簸 */}
            {status && (
                <div
                    style={{
                        position: "fixed",
                        top: 48,
                        left: "50%",
                        transform: "translateX(-50%)",
                        zIndex: 9999,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 16px",
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 500,
                        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                        pointerEvents: "auto",
                        animation: "fadeIn 0.2s ease-out",
                        background:
                            status.type === "success"
                                ? "var(--mitmweb-success-soft-bg)"
                                : status.type === "error"
                                  ? "var(--mitmweb-danger-soft-bg)"
                                  : "var(--mitmweb-info-soft-bg)",
                        color:
                            status.type === "success"
                                ? "var(--mitmweb-success-soft-fg)"
                                : status.type === "error"
                                  ? "var(--mitmweb-danger-soft-fg)"
                                  : "var(--mitmweb-info-soft-fg)",
                    }}
                >
                    <Icon
                        name={
                            status.type === "success"
                                ? "confirm"
                                : status.type === "error"
                                  ? "warning"
                                  : "info"
                        }
                        size={15}
                    />
                    <span>{status.msg}</span>
                    <button
                        type="button"
                        onClick={() => setStatus(null)}
                        style={{
                            background: "transparent",
                            border: "none",
                            color: "inherit",
                            cursor: "pointer",
                            padding: "0 0 0 8px",
                            opacity: 0.8,
                            display: "flex",
                            alignItems: "center",
                        }}
                    >
                        <Icon name="close" size={12} />
                    </button>
                </div>
            )}

            {/* 顶栏控制区域：紧凑排列，布局高度恒定 */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingBottom: 10,
                    marginBottom: 12,
                    borderBottom: "1px solid var(--mitmweb-border)",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Icon name="pause" style={{ fontSize: 18, color: "var(--mitmweb-accent)" }} />
                    <h4 style={{ margin: 0, fontWeight: 600, color: "var(--mitmweb-fg-strong)" }}>
                        拦截管理
                    </h4>
                    <span style={{ fontSize: 12, color: "var(--mitmweb-fg-muted)", marginLeft: 4 }}>
                        (共 {rules.length} 条规则)
                    </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {!editingRule && (
                        <Button
                            onClick={handleAddNewRule}
                            icon="addSquare"
                            className="btn-sm btn-success"
                        >
                            添加新规则
                        </Button>
                    )}
                    <Button
                        onClick={() => {
                            loadRules();
                            loadServerFiles();
                        }}
                        icon="refresh"
                        className="btn-sm btn-default"
                    >
                        刷新
                    </Button>
                    <button
                        type="button"
                        className="btn btn-default btn-sm"
                        title="关闭弹窗"
                        onClick={() => dispatch(hideModal())}
                    >
                        <Icon name="close" size={13} /> 关闭
                    </button>
                </div>
            </div>

            {loading ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "var(--mitmweb-fg-muted)" }}>
                    <Icon name="refresh" /> 正在加载规则列表...
                </div>
            ) : editingRule ? (
                /* 编辑 / 新建规则表单页面：采用标准 Flex 列布局，表单内容独立滚动，底栏永远固定在弹窗底部 */
                <div
                    onKeyDown={(e) => e.stopPropagation()}
                    style={{
                        maxWidth: 960,
                        height: "calc(100vh - 190px)",
                        margin: "0 auto",
                        background: "var(--mitmweb-bg)",
                        border: "1px solid var(--mitmweb-border)",
                        borderRadius: 6,
                        display: "flex",
                        flexDirection: "column",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                        overflow: "hidden",
                    }}
                >
                    {/* 固定顶栏 */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--mitmweb-border)", padding: "14px 20px" }}>
                        <h4 style={{ margin: 0, fontWeight: 600, color: "var(--mitmweb-fg-strong)" }}>
                            {rules.some((r) => r.id === editingRule.id) ? "编辑规则" : "新建规则"}
                        </h4>
                        <button
                            type="button"
                            className="btn btn-default btn-xs"
                            onClick={() => setEditingRule(null)}
                        >
                            返回列表
                        </button>
                    </div>

                    {/* 中间表单区域：独立滚动 */}
                    <div
                        style={{
                            flex: 1,
                            overflowY: "auto",
                            padding: "16px 20px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 16,
                        }}
                    >
                        {/* 基本信息 */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14 }}>
                        <div>
                            <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mitmweb-fg)" }}>
                                规则名称
                            </label>
                            <input
                                type="text"
                                className="input"
                                placeholder="例如: 模拟用户详情返回"
                                value={editingRule.name}
                                style={{
                                    height: 32,
                                    marginTop: 4,
                                    border: "1px solid var(--mitmweb-border)",
                                    borderRadius: 4,
                                    background: "var(--mitmweb-bg)",
                                    color: "var(--mitmweb-fg)",
                                }}
                                onChange={(e) =>
                                    setEditingRule({ ...editingRule, name: e.target.value })
                                }
                            />
                        </div>

                        <div>
                            <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mitmweb-fg)" }}>
                                匹配条件 (支持路径包含、正则或过滤表达式如 ~u /api)
                            </label>
                            <input
                                type="text"
                                className="input"
                                placeholder="例如: /user/info 或 ~u /user/info & ~m post"
                                value={editingRule.filter}
                                style={{
                                    height: 32,
                                    marginTop: 4,
                                    fontFamily: "monospace",
                                    border: "1px solid var(--mitmweb-border)",
                                    borderRadius: 4,
                                    background: "var(--mitmweb-bg)",
                                    color: "var(--mitmweb-fg)",
                                }}
                                onChange={(e) =>
                                    setEditingRule({ ...editingRule, filter: e.target.value })
                                }
                            />
                        </div>
                    </div>

                    {/* 动作类型选择 */}
                    <div
                        style={{
                            padding: "12px 14px",
                            borderRadius: 6,
                            background: "var(--mitmweb-bg-alt)",
                            border: "1px solid var(--mitmweb-border)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                        }}
                    >
                        <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mitmweb-fg)" }}>
                            执行动作
                        </label>
                        <div style={{ display: "flex", gap: 24 }}>
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                <input
                                    type="radio"
                                    name="rule_action"
                                    checked={editingRule.action === "breakpoint"}
                                    onChange={() =>
                                        setEditingRule({ ...editingRule, action: "breakpoint" })
                                    }
                                />
                                <span style={{ fontWeight: 500 }}>断点拦截</span>
                            </label>
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                <input
                                    type="radio"
                                    name="rule_action"
                                    checked={editingRule.action === "mock"}
                                    onChange={() =>
                                        setEditingRule({
                                            ...editingRule,
                                            action: "mock",
                                            mock_config: editingRule.mock_config || {
                                                status_code: 200,
                                                data_source: "inline",
                                                file_path: "",
                                                body: "{\n  \"code\": 0\n}",
                                                processor_type: "raw",
                                                script_handler: "",
                                            },
                                        })
                                    }
                                />
                                <span style={{ fontWeight: 500 }}>模拟响应</span>
                            </label>
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                <input
                                    type="radio"
                                    name="rule_action"
                                    checked={editingRule.action === "delay"}
                                    onChange={() =>
                                        setEditingRule({
                                            ...editingRule,
                                            action: "delay",
                                            delay_ms: editingRule.delay_ms !== undefined ? editingRule.delay_ms : 1000,
                                        })
                                    }
                                />
                                <span style={{ fontWeight: 500 }}>响应延迟</span>
                            </label>
                        </div>
                    </div>

                    {/* 1. 如果是响应延迟模式 */}
                    {editingRule.action === "delay" && (
                        <div
                            style={{
                                padding: "14px",
                                borderRadius: 6,
                                border: "1px solid var(--mitmweb-border)",
                                background: "var(--mitmweb-bg)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 10,
                            }}
                        >
                            <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mitmweb-fg)" }}>
                                延迟时间 (毫秒)
                            </label>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <input
                                    type="number"
                                    className="input"
                                    min={0}
                                    step={100}
                                    placeholder="例如: 1000"
                                    value={editingRule.delay_ms ?? 1000}
                                    style={{
                                        width: 160,
                                        height: 32,
                                        border: "1px solid var(--mitmweb-border)",
                                        borderRadius: 4,
                                        background: "var(--mitmweb-bg)",
                                        color: "var(--mitmweb-fg)",
                                    }}
                                    onChange={(e) =>
                                        setEditingRule({
                                            ...editingRule,
                                            delay_ms: Math.max(0, parseInt(e.target.value, 10) || 0),
                                        })
                                    }
                                />
                                <span style={{ fontSize: 12, color: "var(--mitmweb-fg-muted)" }}>
                                    毫秒 (ms) —— 相当于 {((editingRule.delay_ms ?? 1000) / 1000).toFixed(2)} 秒后返回响应
                                </span>
                            </div>
                        </div>
                    )}

                    {/* 2. 如果是断点模式：同时拦截请求和响应 放在最前面 */}
                    {editingRule.action === "breakpoint" && (
                        <div
                            style={{
                                padding: "12px 14px",
                                borderRadius: 6,
                                border: "1px solid var(--mitmweb-border)",
                                background: "var(--mitmweb-bg)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 10,
                            }}
                        >
                            <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mitmweb-fg)" }}>
                                断点拦截阶段
                            </label>
                            <div style={{ display: "flex", gap: 20 }}>
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                    <input
                                        type="radio"
                                        name="intercept_phase"
                                        checked={editingRule.intercept_phase === "both" || !editingRule.intercept_phase}
                                        onChange={() =>
                                            setEditingRule({ ...editingRule, intercept_phase: "both" })
                                        }
                                    />
                                    <span>拦截请求和响应</span>
                                </label>
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                    <input
                                        type="radio"
                                        name="intercept_phase"
                                        checked={editingRule.intercept_phase === "request"}
                                        onChange={() =>
                                            setEditingRule({ ...editingRule, intercept_phase: "request" })
                                        }
                                    />
                                    <span>仅拦截请求</span>
                                </label>
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                    <input
                                        type="radio"
                                        name="intercept_phase"
                                        checked={editingRule.intercept_phase === "response"}
                                        onChange={() =>
                                            setEditingRule({ ...editingRule, intercept_phase: "response" })
                                        }
                                    />
                                    <span>仅拦截响应</span>
                                </label>
                            </div>
                        </div>
                    )}

                    {/* 3. 如果是模拟响应 (Mock) 模式 */}
                    {editingRule.action === "mock" && (
                        <div
                            style={{
                                padding: "14px",
                                borderRadius: 6,
                                border: "1px solid var(--mitmweb-border)",
                                background: "var(--mitmweb-bg)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 14,
                            }}
                        >
                            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 14 }}>
                                <div>
                                    <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mitmweb-fg)" }}>
                                        状态码
                                    </label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={editingRule.mock_config?.status_code || 200}
                                        style={{
                                            height: 32,
                                            marginTop: 4,
                                            border: "1px solid var(--mitmweb-border)",
                                            borderRadius: 4,
                                            background: "var(--mitmweb-bg)",
                                            color: "var(--mitmweb-fg)",
                                        }}
                                        onChange={(e) =>
                                            setEditingRule({
                                                ...editingRule,
                                                mock_config: {
                                                    ...editingRule.mock_config,
                                                    status_code: parseInt(e.target.value, 10) || 200,
                                                },
                                            })
                                        }
                                    />
                                </div>

                                <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mitmweb-fg)", margin: 0 }}>
                                            数据处理方法
                                        </label>
                                        <span
                                            className="help-tooltip-trigger"
                                            style={{
                                                position: "relative",
                                                display: "inline-flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                cursor: "help",
                                                color: "var(--mitmweb-fg-muted)",
                                            }}
                                        >
                                            <Icon name="help" size={13} />
                                            <span className="help-tooltip-bubble">
                                                读取加载脚本中以 rsp_ 开头的方法
                                            </span>
                                        </span>
                                    </div>
                                    <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                                        <select
                                            className="input"
                                            value={
                                                editingRule.mock_config?.processor_type === "script" &&
                                                editingRule.mock_config?.script_handler
                                                    ? editingRule.mock_config.script_handler
                                                    : ""
                                            }
                                            style={{
                                                height: 34,
                                                lineHeight: "22px",
                                                paddingTop: 4,
                                                paddingBottom: 4,
                                                width: "100%",
                                                fontFamily: "monospace, 'Consolas', 'Courier New', sans-serif",
                                                fontSize: 12.5,
                                                border: "1px solid var(--mitmweb-border)",
                                                borderRadius: 4,
                                                background: "var(--mitmweb-bg)",
                                                color: "var(--mitmweb-fg)",
                                                boxSizing: "border-box",
                                            }}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setEditingRule({
                                                    ...editingRule,
                                                    mock_config: {
                                                        ...editingRule.mock_config,
                                                        processor_type: val ? "script" : "raw",
                                                        script_handler: val,
                                                    },
                                                });
                                            }}
                                        >
                                            <option value="">无 (直接返回数据内容)</option>
                                            {availableHandlers.map((h) => (
                                                <option key={h} value={h}>
                                                    {h}
                                                </option>
                                            ))}
                                            {/* 如果当前规则配置了某个自定义函数，但不在已检测列表里，也保留显示 */}
                                            {editingRule.mock_config?.script_handler &&
                                                !availableHandlers.includes(editingRule.mock_config.script_handler) && (
                                                    <option value={editingRule.mock_config.script_handler}>
                                                        {editingRule.mock_config.script_handler}
                                                    </option>
                                                )}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* 响应头配置面板：可折叠展示，并支持预设与自由编辑 */}
                            <div
                                style={{
                                    border: "1px solid var(--mitmweb-border)",
                                    borderRadius: 6,
                                    background: "var(--mitmweb-bg-alt)",
                                    padding: "10px 14px",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 10,
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        cursor: "pointer",
                                        userSelect: "none",
                                    }}
                                    onClick={() => setShowHeadersConfig(!showHeadersConfig)}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mitmweb-fg)" }}>
                                            响应头配置 (Headers)
                                        </span>
                                        <span style={{ fontSize: 11.5, color: "var(--mitmweb-fg-muted)" }}>
                                            {(() => {
                                                const hdrs = editingRule.mock_config?.headers || {
                                                    "Content-Type": "application/json;charset=UTF-8",
                                                    "Access-Control-Allow-Origin": "*",
                                                };
                                                const ct = hdrs["Content-Type"] || hdrs["content-type"] || "未指定";
                                                return `[Content-Type: ${ct}] 共 ${Object.keys(hdrs).length} 项`;
                                            })()}
                                        </span>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mitmweb-accent)" }}>
                                        <span>{showHeadersConfig ? "收起" : "展开配置"}</span>
                                        <Icon name={showHeadersConfig ? "chevronUp" : "chevronDown"} size={13} />
                                    </div>
                                </div>

                                {showHeadersConfig && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                                        {/* 常用 Content-Type 快捷预设按钮 */}
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                            <span style={{ fontSize: 11.5, color: "var(--mitmweb-fg-muted)", marginRight: 2 }}>
                                                快捷设置 Content-Type:
                                            </span>
                                            {[
                                                { label: "JSON", val: "application/json;charset=UTF-8" },
                                                { label: "纯文本", val: "text/plain;charset=UTF-8" },
                                                { label: "HTML", val: "text/html;charset=UTF-8" },
                                                { label: "XML", val: "application/xml;charset=UTF-8" },
                                                { label: "二进制流", val: "application/octet-stream" },
                                                { label: "PNG图片", val: "image/png" },
                                            ].map((preset) => (
                                                <button
                                                    key={preset.label}
                                                    type="button"
                                                    className="btn btn-default btn-xs"
                                                    style={{ fontSize: 11, padding: "2px 8px" }}
                                                    onClick={() => {
                                                        const current = { ...(editingRule.mock_config?.headers || {}) };
                                                        current["Content-Type"] = preset.val;
                                                        setEditingRule({
                                                            ...editingRule,
                                                            mock_config: {
                                                                ...editingRule.mock_config,
                                                                headers: current,
                                                            },
                                                        });
                                                    }}
                                                >
                                                    {preset.label}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Headers 键值对表格 */}
                                        <div
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: 6,
                                                background: "var(--mitmweb-bg)",
                                                border: "1px solid var(--mitmweb-border)",
                                                borderRadius: 4,
                                                padding: "8px 10px",
                                            }}
                                        >
                                            {(() => {
                                                const headersObj = editingRule.mock_config?.headers || {
                                                    "Content-Type": "application/json;charset=UTF-8",
                                                    "Access-Control-Allow-Origin": "*",
                                                };
                                                const entries = Object.entries(headersObj);

                                                return (
                                                    <>
                                                        {entries.map(([key, val], idx) => (
                                                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                                <input
                                                                    type="text"
                                                                    className="input"
                                                                    placeholder="Header 名称 (如 Content-Type)"
                                                                    value={key}
                                                                    style={{
                                                                        flex: 1,
                                                                        height: 28,
                                                                        fontFamily: "monospace",
                                                                        fontSize: 12,
                                                                        border: "1px solid var(--mitmweb-border)",
                                                                        borderRadius: 4,
                                                                        background: "var(--mitmweb-bg)",
                                                                        color: "var(--mitmweb-fg)",
                                                                    }}
                                                                    onChange={(e) => {
                                                                        const newKey = e.target.value;
                                                                        const newObj: Record<string, string> = {};
                                                                        entries.forEach(([k, v], i) => {
                                                                            if (i === idx) {
                                                                                newObj[newKey] = v;
                                                                            } else {
                                                                                newObj[k] = v;
                                                                            }
                                                                        });
                                                                        setEditingRule({
                                                                            ...editingRule,
                                                                            mock_config: {
                                                                                ...editingRule.mock_config,
                                                                                headers: newObj,
                                                                            },
                                                                        });
                                                                    }}
                                                                />
                                                                <span style={{ color: "var(--mitmweb-fg-muted)" }}>:</span>
                                                                <input
                                                                    type="text"
                                                                    className="input"
                                                                    placeholder="Header 取值"
                                                                    value={val}
                                                                    style={{
                                                                        flex: 2,
                                                                        height: 28,
                                                                        fontFamily: "monospace",
                                                                        fontSize: 12,
                                                                        border: "1px solid var(--mitmweb-border)",
                                                                        borderRadius: 4,
                                                                        background: "var(--mitmweb-bg)",
                                                                        color: "var(--mitmweb-fg)",
                                                                    }}
                                                                    onChange={(e) => {
                                                                        const newVal = e.target.value;
                                                                        const newObj: Record<string, string> = {};
                                                                        entries.forEach(([k, v], i) => {
                                                                            if (i === idx) {
                                                                                newObj[k] = newVal;
                                                                            } else {
                                                                                newObj[k] = v;
                                                                            }
                                                                        });
                                                                        setEditingRule({
                                                                            ...editingRule,
                                                                            mock_config: {
                                                                                ...editingRule.mock_config,
                                                                                headers: newObj,
                                                                            },
                                                                        });
                                                                    }}
                                                                />
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-default btn-xs"
                                                                    title="删除此 Header"
                                                                    style={{
                                                                        color: "var(--mitmweb-danger)",
                                                                        padding: 0,
                                                                        width: 28,
                                                                        height: 28,
                                                                        display: "inline-flex",
                                                                        alignItems: "center",
                                                                        justifyContent: "center",
                                                                        flexShrink: 0,
                                                                    }}
                                                                    onClick={() => {
                                                                        const newObj: Record<string, string> = {};
                                                                        entries.forEach(([k, v], i) => {
                                                                            if (i !== idx) {
                                                                                newObj[k] = v;
                                                                            }
                                                                        });
                                                                        setEditingRule({
                                                                            ...editingRule,
                                                                            mock_config: {
                                                                                ...editingRule.mock_config,
                                                                                headers: newObj,
                                                                            },
                                                                        });
                                                                    }}
                                                                >
                                                                    <Icon name="close" size={12} />
                                                                </button>
                                                            </div>
                                                        ))}

                                                        <div style={{ marginTop: 4 }}>
                                                            <button
                                                                type="button"
                                                                className="btn btn-default btn-xs"
                                                                style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5 }}
                                                                onClick={() => {
                                                                    const current = { ...(editingRule.mock_config?.headers || {}) };
                                                                    current["Custom-Header"] = "value";
                                                                    setEditingRule({
                                                                        ...editingRule,
                                                                        mock_config: {
                                                                            ...editingRule.mock_config,
                                                                            headers: current,
                                                                        },
                                                                    });
                                                                }}
                                                            >
                                                                <Icon name="addSquare" size={12} /> 添加自定义 Header
                                                            </button>
                                                        </div>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 数据来源：直接输入内容 OR 选择服务器文件 */}
                            <div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                    <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mitmweb-fg)" }}>
                                        数据内容
                                    </label>
                                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12 }}>
                                            <input
                                                type="radio"
                                                name="data_source"
                                                checked={editingRule.mock_config?.data_source !== "file"}
                                                onChange={() =>
                                                    setEditingRule({
                                                        ...editingRule,
                                                        mock_config: {
                                                            ...editingRule.mock_config,
                                                            data_source: "inline",
                                                        },
                                                    })
                                                }
                                            />
                                            <span>在线编辑内容</span>
                                        </label>
                                        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12 }}>
                                            <input
                                                type="radio"
                                                name="data_source"
                                                checked={editingRule.mock_config?.data_source === "file"}
                                                onChange={() =>
                                                    setEditingRule({
                                                        ...editingRule,
                                                        mock_config: {
                                                            ...editingRule.mock_config,
                                                            data_source: "file",
                                                            file_path:
                                                                editingRule.mock_config?.file_path ||
                                                                (serverFiles.length > 0 ? serverFiles[0].path : ""),
                                                        },
                                                    })
                                                }
                                            />
                                            <span>服务器文件</span>
                                        </label>
                                    </div>
                                </div>

                                {editingRule.mock_config?.data_source === "file" ? (
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 10,
                                            padding: "12px 14px",
                                            borderRadius: 6,
                                            border: "1px solid var(--mitmweb-border)",
                                            background: "var(--mitmweb-bg-alt)",
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {/* 顶层上传操作栏 */}
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mitmweb-fg)" }}>
                                                请点击选择下方文件作为返回源：
                                            </span>
                                            <label
                                                className="btn btn-default btn-xs"
                                                style={{
                                                    cursor: "pointer",
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: 5,
                                                    padding: "5px 10px",
                                                }}
                                            >
                                                <Icon name="upload" size={13} /> 上传新文件
                                                <input
                                                    type="file"
                                                    style={{ display: "none" }}
                                                    onChange={handleUploadToServer}
                                                />
                                            </label>
                                        </div>

                                        {/* 自定义服务器文件列表卡片容器 */}
                                        <div
                                            style={{
                                                maxHeight: 220,
                                                overflowY: "auto",
                                                borderRadius: 6,
                                                border: "1px solid var(--mitmweb-border)",
                                                background: "var(--mitmweb-bg)",
                                                display: "flex",
                                                flexDirection: "column",
                                            }}
                                        >
                                            {serverFiles.length === 0 ? (
                                                <div
                                                    style={{
                                                        padding: "24px 12px",
                                                        textAlign: "center",
                                                        fontSize: 12,
                                                        color: "var(--mitmweb-fg-muted)",
                                                    }}
                                                >
                                                    服务器 mock_files 目录中暂无文件，点击右上角「上传新文件」添加。
                                                </div>
                                            ) : (
                                                serverFiles.map((file) => {
                                                    const isSelected = editingRule.mock_config?.file_path === file.path;
                                                    const isConfirming = confirmDeleteTarget?.path === file.path;

                                                    return (
                                                        <div
                                                            key={file.path}
                                                            style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                justifyContent: "space-between",
                                                                padding: "8px 12px",
                                                                borderBottom: "1px solid var(--mitmweb-border-light)",
                                                                // 使用 mitmweb 表格原生选中高亮与深浅色自适应变量
                                                                backgroundColor: isSelected
                                                                    ? "var(--mitmweb-row-selected)"
                                                                    : "transparent",
                                                                borderLeft: isSelected
                                                                    ? "3px solid var(--mitmweb-accent)"
                                                                    : "3px solid transparent",
                                                                cursor: "pointer",
                                                                transition: "all 0.15s ease",
                                                            }}
                                                            onClick={() => {
                                                                const autoContentType = guessContentType(file.name);
                                                                const currentHeaders = { ...(editingRule.mock_config?.headers || {}) };
                                                                currentHeaders["Content-Type"] = autoContentType;

                                                                setEditingRule({
                                                                    ...editingRule,
                                                                    mock_config: {
                                                                        ...editingRule.mock_config,
                                                                        file_path: file.path,
                                                                        headers: currentHeaders,
                                                                    },
                                                                });
                                                            }}
                                                        >
                                                            {/* 左侧：单选圈、文件类型图标、文件名称、文件大小 */}
                                                            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                                                                <input
                                                                    type="radio"
                                                                    name="selected_server_file"
                                                                    checked={isSelected}
                                                                    onChange={() => {}}
                                                                    style={{ cursor: "pointer", margin: 0 }}
                                                                />
                                                                <Icon
                                                                    name={isSelected ? "openFolder" : "file"}
                                                                    size={15}
                                                                    style={{
                                                                        color: isSelected
                                                                            ? "var(--mitmweb-accent)"
                                                                            : "var(--mitmweb-fg-muted)",
                                                                        flexShrink: 0,
                                                                    }}
                                                                />
                                                                <span
                                                                    style={{
                                                                        fontSize: 12.5,
                                                                        fontWeight: isSelected ? 600 : 400,
                                                                        color: isSelected
                                                                            ? "var(--mitmweb-accent)"
                                                                            : "var(--mitmweb-fg-strong)",
                                                                        fontFamily: "monospace",
                                                                        overflow: "hidden",
                                                                        textOverflow: "ellipsis",
                                                                        whiteSpace: "nowrap",
                                                                    }}
                                                                >
                                                                    {file.name}
                                                                </span>
                                                                <span
                                                                    style={{
                                                                        fontSize: 11,
                                                                        color: "var(--mitmweb-fg-muted)",
                                                                        whiteSpace: "nowrap",
                                                                    }}
                                                                >
                                                                    ({file.size > 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`})
                                                                </span>
                                                            </div>

                                                            {/* 右侧：删除操作区（就地平滑展开确认，彻底杜绝遮挡） */}
                                                            <div
                                                                style={{ marginLeft: 12 }}
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                {isConfirming ? (
                                                                    <div
                                                                        style={{
                                                                            display: "inline-flex",
                                                                            alignItems: "center",
                                                                            gap: 6,
                                                                            padding: "2px 6px",
                                                                            borderRadius: 4,
                                                                            background: "var(--mitmweb-bg)",
                                                                            border: "1px solid var(--mitmweb-border)",
                                                                            boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                                                                        }}
                                                                    >
                                                                        <span style={{ fontSize: 11, color: "var(--mitmweb-text-danger)", fontWeight: 500 }}>
                                                                            确定删除？
                                                                        </span>
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-danger btn-xs"
                                                                            style={{ padding: "1px 6px", fontSize: 11 }}
                                                                            onClick={() => executeDeleteServerFile(file.path)}
                                                                        >
                                                                            确认
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-default btn-xs"
                                                                            style={{ padding: "1px 6px", fontSize: 11 }}
                                                                            onClick={() => setConfirmDeleteTarget(null)}
                                                                        >
                                                                            取消
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-default btn-xs"
                                                                        style={{
                                                                            color: "var(--mitmweb-text-danger)",
                                                                            padding: "2px 8px",
                                                                            display: "inline-flex",
                                                                            alignItems: "center",
                                                                            gap: 4,
                                                                            fontSize: 11.5,
                                                                        }}
                                                                        title="删除此文件"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setConfirmDeleteTarget({ path: file.path, name: file.name });
                                                                        }}
                                                                    >
                                                                        <Icon name="delete" size={12} />
                                                                        <span>删除</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>

                                        <div style={{ fontSize: 11.5, color: "var(--mitmweb-fg-muted)" }}>
                                            提示：支持图片、音视频、SVGA、压缩包等非文本文件，请求到达时将以纯原始二进制直接响应。
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 10 }}>
                                            <label
                                                className="btn btn-default btn-xs"
                                                style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                                            >
                                                <Icon name="openFolder" /> 载入本地文件内容到编辑器
                                                <input
                                                    type="file"
                                                    style={{ display: "none" }}
                                                    accept=".json,.txt,.xml,.html"
                                                    onChange={handleFileUpload}
                                                />
                                            </label>
                                            <span style={{ fontSize: 11.5, color: "var(--mitmweb-fg-muted)" }}>
                                                (仅限文本文件，快速将内容载入下方进行编辑)
                                            </span>
                                        </div>
                                        {/* 在线编辑内容：使用标准原生 textarea，支持文本滚动、高亮、左右上下方向键移动光标 */}
                                        <textarea
                                            className="form-control"
                                            rows={12}
                                            value={editingRule.mock_config?.body || ""}
                                            style={{
                                                width: "100%",
                                                height: 240,
                                                minHeight: 240,
                                                maxHeight: 400,
                                                fontFamily: "monospace, 'Consolas', 'Courier New'",
                                                fontSize: 12.5,
                                                lineHeight: 1.5,
                                                padding: "10px 12px",
                                                border: "1px solid var(--mitmweb-border)",
                                                borderRadius: 4,
                                                background: "var(--mitmweb-bg)",
                                                color: "var(--mitmweb-fg)",
                                                resize: "vertical",
                                                overflowY: "auto",
                                                overflowX: "auto",
                                                whiteSpace: "pre",
                                                boxSizing: "border-box",
                                            }}
                                            onKeyDown={(e) => e.stopPropagation()}
                                            onChange={(e) =>
                                                setEditingRule({
                                                    ...editingRule,
                                                    mock_config: {
                                                        ...editingRule.mock_config,
                                                        body: e.target.value,
                                                    },
                                                })
                                            }
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    </div>

                    {/* 真正永久固定底部的操作栏：位于滚动容器外部，位置绝对静止，绝不上移或晃动 */}
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "flex-end",
                            alignItems: "center",
                            gap: 10,
                            padding: "12px 20px",
                            backgroundColor: "var(--mitmweb-bg)",
                            borderTop: "1px solid var(--mitmweb-border)",
                            boxShadow: "0 -2px 10px rgba(0,0,0,0.06)",
                            flexShrink: 0,
                        }}
                    >
                        <button
                            type="button"
                            className="btn btn-default btn-sm"
                            onClick={() => {
                                if (modalData?.initialUrl) {
                                    dispatch(hideModal());
                                } else {
                                    setEditingRule(null);
                                }
                            }}
                        >
                            取消
                        </button>
                        <Button
                            className="btn-sm btn-primary"
                            onClick={handleSaveEditingRule}
                        >
                            保存并应用规则
                        </Button>
                    </div>
                </div>
            ) : (
                /* 规则表格视图页面 */
                <div
                    style={{
                        width: "100%",
                        borderRadius: 6,
                        overflow: "hidden",
                        border: "1px solid var(--mitmweb-border)",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                    }}
                >
                    <table
                        className="table table-hover"
                        style={{
                            width: "100%",
                            margin: 0,
                            background: "var(--mitmweb-bg)",
                            tableLayout: "fixed",
                        }}
                    >
                        <thead
                            style={{
                                background: "var(--mitmweb-bg-alt)",
                                borderBottom: "2px solid var(--mitmweb-border)",
                            }}
                        >
                            <tr>
                                <th style={{ width: 44, textAlign: "center", padding: "10px 8px", color: "var(--mitmweb-fg-strong)", fontWeight: 600, verticalAlign: "middle" }}>
                                    开关
                                </th>
                                <th style={{ width: "18%", minWidth: 140, padding: "10px 14px", color: "var(--mitmweb-fg-strong)", fontWeight: 600, verticalAlign: "middle" }}>
                                    规则名称
                                </th>
                                <th style={{ width: "28%", minWidth: 180, padding: "10px 14px", color: "var(--mitmweb-fg-strong)", fontWeight: 600, verticalAlign: "middle" }}>
                                    匹配条件
                                </th>
                                <th style={{ width: "38%", minWidth: 260, padding: "10px 14px", color: "var(--mitmweb-fg-strong)", fontWeight: 600, verticalAlign: "middle" }}>
                                    执行动作
                                </th>
                                <th style={{ width: 120, textAlign: "center", padding: "10px 14px", color: "var(--mitmweb-fg-strong)", fontWeight: 600, verticalAlign: "middle" }}>
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rules.length === 0 ? (
                                <tr>
                                    <td colSpan={5} style={{ textAlign: "center", padding: "40px 15px", color: "var(--mitmweb-fg-muted)" }}>
                                        暂无规则项，点击上方「添加新规则」开始配置拦截断点或数据返回。
                                    </td>
                                </tr>
                            ) : (
                                rules.map((rule, idx) => (
                                    <tr
                                        key={rule.id}
                                        style={{
                                            background: idx % 2 === 1 ? "var(--mitmweb-bg-alt)" : "var(--mitmweb-bg)",
                                        }}
                                    >
                                        {/* 开关 */}
                                        <td style={{ textAlign: "center", verticalAlign: "middle", padding: "10px 8px" }}>
                                            <input
                                                type="checkbox"
                                                checked={rule.enabled}
                                                title={rule.enabled ? "点击禁用" : "点击启用"}
                                                style={{ width: 17, height: 17, cursor: "pointer" }}
                                                onChange={() => handleToggleRule(rule)}
                                            />
                                        </td>

                                        {/* 名称 */}
                                        <td style={{ verticalAlign: "middle", padding: "10px 14px", fontWeight: 600, color: "var(--mitmweb-fg-strong)", wordBreak: "break-all", overflowWrap: "anywhere" }}>
                                            {rule.name}
                                        </td>

                                        {/* 匹配条件 */}
                                        <td style={{ verticalAlign: "middle", padding: "10px 14px", fontFamily: "monospace", fontSize: 13, color: "var(--mitmweb-fg)" }}>
                                            <div style={{ wordBreak: "break-all" }}>{rule.filter}</div>
                                        </td>

                                        {/* 类型 */}
                                        <td style={{ verticalAlign: "middle", padding: "10px 14px" }}>
                                            {rule.action === "breakpoint" ? (
                                                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                                                    <span
                                                        style={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 5,
                                                            padding: "3px 8px",
                                                            borderRadius: 4,
                                                            fontSize: 12,
                                                            fontWeight: 500,
                                                            background: "var(--mitmweb-warning-soft-bg)",
                                                            color: "var(--mitmweb-warning-soft-fg)",
                                                            whiteSpace: "nowrap",
                                                        }}
                                                    >
                                                        <Icon name="pause" size={12} /> 断点拦截
                                                    </span>
                                                    <span
                                                        style={{
                                                            padding: "2px 7px",
                                                            borderRadius: 4,
                                                            fontSize: 11.5,
                                                            background: "var(--mitmweb-bg-alt)",
                                                            border: "1px solid var(--mitmweb-border)",
                                                            color: "var(--mitmweb-fg)",
                                                            whiteSpace: "nowrap",
                                                        }}
                                                    >
                                                        {rule.intercept_phase === "request"
                                                            ? "仅请求"
                                                            : rule.intercept_phase === "response"
                                                              ? "仅响应"
                                                              : "请求与响应"}
                                                    </span>
                                                </div>
                                            ) : rule.action === "delay" ? (
                                                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                                                    <span
                                                        style={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 5,
                                                            padding: "3px 8px",
                                                            borderRadius: 4,
                                                            fontSize: 12,
                                                            fontWeight: 500,
                                                            background: "var(--mitmweb-info-soft-bg)",
                                                            color: "var(--mitmweb-info-soft-fg)",
                                                            whiteSpace: "nowrap",
                                                        }}
                                                    >
                                                        <Icon name="revert" size={12} /> 响应延迟
                                                    </span>
                                                    <span
                                                        style={{
                                                            padding: "2px 7px",
                                                            borderRadius: 4,
                                                            fontSize: 11.5,
                                                            fontFamily: "monospace",
                                                            background: "var(--mitmweb-bg-alt)",
                                                            border: "1px solid var(--mitmweb-border)",
                                                            color: "var(--mitmweb-fg-strong)",
                                                            whiteSpace: "nowrap",
                                                        }}
                                                    >
                                                        {rule.delay_ms ?? 1000} ms (
                                                        {(((rule.delay_ms ?? 1000) / 1000)).toFixed(2)}s)
                                                    </span>
                                                </div>
                                            ) : (
                                                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                                    {/* 主标签行：绝不换行 */}
                                                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
                                                        <span
                                                            style={{
                                                                display: "inline-flex",
                                                                alignItems: "center",
                                                                gap: 5,
                                                                padding: "3px 8px",
                                                                borderRadius: 4,
                                                                fontSize: 12,
                                                                fontWeight: 500,
                                                                background: "var(--mitmweb-success-soft-bg)",
                                                                color: "var(--mitmweb-success-soft-fg)",
                                                                whiteSpace: "nowrap",
                                                                flexShrink: 0,
                                                            }}
                                                        >
                                                            <Icon name="resume" size={12} /> 模拟响应
                                                        </span>

                                                        {/* 状态码徽章 */}
                                                        <span
                                                            style={{
                                                                padding: "2px 6px",
                                                                borderRadius: 4,
                                                                fontSize: 11.5,
                                                                fontFamily: "monospace",
                                                                fontWeight: 600,
                                                                background: "var(--mitmweb-bg-alt)",
                                                                border: "1px solid var(--mitmweb-border)",
                                                                color: "var(--mitmweb-fg-strong)",
                                                                whiteSpace: "nowrap",
                                                                flexShrink: 0,
                                                            }}
                                                        >
                                                            {rule.mock_config?.status_code || 200}
                                                        </span>

                                                        {/* 来源徽章 */}
                                                        <span
                                                            style={{
                                                                padding: "2px 6px",
                                                                borderRadius: 4,
                                                                fontSize: 11,
                                                                background: "var(--mitmweb-bg-alt)",
                                                                border: "1px solid var(--mitmweb-border-light)",
                                                                color: "var(--mitmweb-fg-muted)",
                                                                whiteSpace: "nowrap",
                                                                flexShrink: 0,
                                                            }}
                                                        >
                                                            {rule.mock_config?.data_source === "file" ? "服务器文件" : "内联编辑"}
                                                        </span>
                                                    </div>

                                                    {/* 处理方式次级说明 */}
                                                    <div style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                                        {rule.mock_config?.processor_type === "script" ? (
                                                            <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                                                <span style={{ color: "var(--mitmweb-fg-muted)" }}>处理函数:</span>
                                                                <code style={{ fontSize: 11, color: "var(--mitmweb-accent)", padding: "1px 4px", background: "var(--mitmweb-bg-alt)", borderRadius: 3 }}>
                                                                    {rule.mock_config.script_handler || "rsp_*"}
                                                                </code>
                                                            </div>
                                                        ) : (
                                                            <span style={{ color: "var(--mitmweb-fg-muted)" }}>直接返回原数据</span>
                                                        )}

                                                        {/* 如果是文件类型，清晰展示文件路径 */}
                                                        {rule.mock_config?.data_source === "file" && (
                                                            <div
                                                                style={{
                                                                    display: "inline-flex",
                                                                    alignItems: "center",
                                                                    gap: 4,
                                                                    color: "var(--mitmweb-fg-muted)",
                                                                    maxWidth: "100%",
                                                                }}
                                                                title={rule.mock_config.file_path || "未指定文件"}
                                                            >
                                                                <span>文件:</span>
                                                                <code
                                                                    style={{
                                                                        fontSize: 11,
                                                                        padding: "1px 5px",
                                                                        background: "var(--mitmweb-bg-alt)",
                                                                        border: "1px solid var(--mitmweb-border-light)",
                                                                        borderRadius: 3,
                                                                        color: "var(--mitmweb-fg)",
                                                                        maxWidth: 260,
                                                                        overflow: "hidden",
                                                                        textOverflow: "ellipsis",
                                                                        whiteSpace: "nowrap",
                                                                        display: "inline-block",
                                                                        verticalAlign: "middle",
                                                                    }}
                                                                >
                                                                    {rule.mock_config.file_path
                                                                        ? rule.mock_config.file_path.split("/").pop() || rule.mock_config.file_path
                                                                        : "未选择文件"}
                                                                </code>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </td>

                                        {/* 操作 */}
                                        <td style={{ textAlign: "center", verticalAlign: "middle", padding: "10px 14px" }}>
                                            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                                                <button
                                                    type="button"
                                                    className="btn btn-default btn-xs"
                                                    style={{ color: "var(--mitmweb-accent)" }}
                                                    onClick={() => setEditingRule(rule)}
                                                >
                                                    编辑
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-default btn-xs"
                                                    style={{ color: "var(--mitmweb-text-danger)" }}
                                                    onClick={() => handleDeleteRule(rule.id)}
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
