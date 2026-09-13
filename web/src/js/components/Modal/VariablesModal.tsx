import React, { useEffect, useState } from "react";
import { useAppDispatch } from "../../ducks";
import * as modalActions from "../../ducks/ui/modal";
import Button from "../common/Button";
import Icon from "../common/Icon";
import CodeEditor from "../contentviews/CodeEditor";
import { fetchApi } from "../../utils";

type KeyValueRow = {
    id: string;
    key: string;
    value: string;
};

const stopPropagation = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") {
        e.stopPropagation();
    }
};

export default function VariablesModal() {
    const dispatch = useAppDispatch();
    const [mode, setMode] = useState<"table" | "json">("table");
    const [rows, setRows] = useState<KeyValueRow[]>([]);
    const [jsonText, setJsonText] = useState<string>("{}");
    const [status, setStatus] = useState<{
        type: "success" | "error" | "info";
        msg: string;
    } | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        loadVariables();
    }, []);

    const loadVariables = async () => {
        setLoading(true);
        try {
            const resp = await fetchApi("/variables");
            if (resp.ok) {
                const data = await resp.json();
                setJsonText(JSON.stringify(data, null, 2));
                const newRows: KeyValueRow[] = Object.entries(data).map(
                    ([k, v], idx) => ({
                        id: `${Date.now()}-${idx}`,
                        key: k,
                        value:
                            typeof v === "object"
                                ? JSON.stringify(v, null, 2)
                                : String(v),
                    }),
                );
                setRows(newRows);
            }
        } catch (e: any) {
            setStatus({ type: "error", msg: `加载配置失败: ${e.message}` });
        } finally {
            setLoading(false);
        }
    };

    const switchToJson = () => {
        const obj: Record<string, any> = {};
        for (const row of rows) {
            const trimmedKey = row.key.trim();
            if (!trimmedKey) continue;
            try {
                obj[trimmedKey] = JSON.parse(row.value);
            } catch {
                obj[trimmedKey] = row.value;
            }
        }
        setJsonText(JSON.stringify(obj, null, 2));
        setMode("json");
    };

    const switchToTable = () => {
        try {
            const parsed = JSON.parse(jsonText);
            if (typeof parsed === "object" && parsed !== null) {
                const newRows: KeyValueRow[] = Object.entries(parsed).map(
                    ([k, v], idx) => ({
                        id: `${Date.now()}-${idx}`,
                        key: k,
                        value:
                            typeof v === "object"
                                ? JSON.stringify(v, null, 2)
                                : String(v),
                    }),
                );
                setRows(newRows);
                setMode("table");
                setStatus(null);
            } else {
                setStatus({
                    type: "error",
                    msg: "根 JSON 必须是对象格式 { ... }",
                });
            }
        } catch (e: any) {
            setStatus({
                type: "error",
                msg: `JSON 语法错误: ${e.message}`,
            });
        }
    };

    const handleAddRow = () => {
        setRows([
            ...rows,
            {
                id: `${Date.now()}-${Math.random()}`,
                key: "",
                value: "",
            },
        ]);
    };

    const handleDeleteRow = (id: string) => {
        setRows(rows.filter((r) => r.id !== id));
    };

    const handleRowChange = (
        id: string,
        field: "key" | "value",
        val: string,
    ) => {
        setRows(
            rows.map((r) => {
                if (r.id === id) {
                    return { ...r, [field]: val };
                }
                return r;
            }),
        );
    };

    const handleFormatJsonInRow = (id: string) => {
        setRows(
            rows.map((r) => {
                if (r.id === id) {
                    try {
                        const parsed = JSON.parse(r.value);
                        return { ...r, value: JSON.stringify(parsed, null, 2) };
                    } catch (e: any) {
                        setStatus({
                            type: "error",
                            msg: `该项不是有效的 JSON，无法格式化: ${e.message}`,
                        });
                    }
                }
                return r;
            }),
        );
    };

    const handleSave = async () => {
        let payload: Record<string, any> = {};
        if (mode === "json") {
            try {
                payload = JSON.parse(jsonText);
                if (typeof payload !== "object" || payload === null) {
                    setStatus({
                        type: "error",
                        msg: "根 JSON 必须为对象格式 { ... }",
                    });
                    return;
                }
            } catch (e: any) {
                setStatus({
                    type: "error",
                    msg: `JSON 格式错误: ${e.message}`,
                });
                return;
            }
        } else {
            for (const row of rows) {
                const trimmedKey = row.key.trim();
                const trimmedVal = row.value.trim();
                if (!trimmedKey && !trimmedVal) continue;
                if (!trimmedKey) {
                    setStatus({
                        type: "error",
                        msg: "存在未填写变量名称(Key)的配置项，请补充或删除该行。",
                    });
                    return;
                }

                // 如果看起来像 JSON（以 { 或 [ 开头），必须是合法的 JSON 语法
                if (trimmedVal.startsWith("{") || trimmedVal.startsWith("[")) {
                    try {
                        payload[trimmedKey] = JSON.parse(trimmedVal);
                    } catch (e: any) {
                        setStatus({
                            type: "error",
                            msg: `变量「${trimmedKey}」的内容不是合法的 JSON: ${e.message}`,
                        });
                        return;
                    }
                } else {
                    // 普通字符串值，尝试安全探测是否包含非法 JSON，若普通文本直接作为字符串存入
                    try {
                        payload[trimmedKey] = JSON.parse(trimmedVal);
                    } catch {
                        payload[trimmedKey] = row.value;
                    }
                }
            }
        }

        try {
            const resp = await fetchApi.put("/variables", payload);
            if (resp.ok) {
                const updated = await resp.json();
                setJsonText(JSON.stringify(updated, null, 2));
                setStatus({
                    type: "success",
                    msg: "保存成功！新配置已即时热加载并对 Python 脚本生效。",
                });
            } else {
                const errText = await resp.text();
                setStatus({ type: "error", msg: `保存失败: ${errText}` });
            }
        } catch (e: any) {
            setStatus({ type: "error", msg: `网络请求错误: ${e.message}` });
        }
    };

    return (
        <div style={{ width: "100%" }} onKeyDown={stopPropagation}>
            <div
                className="modal-header"
                style={{
                    borderBottom: "1px solid var(--mitmweb-border-lighter)",
                    padding: "12px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Icon name="settings" style={{ fontSize: 18, color: "var(--mitmweb-accent)" }} />
                    <h4 style={{ margin: 0, fontWeight: 600, color: "var(--mitmweb-fg-strong)" }}>自定义变量与动态配置</h4>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {/* 左侧操作按钮组：添加配置项、重新加载 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {mode === "table" && (
                            <Button
                                onClick={handleAddRow}
                                icon="addSquare"
                                className="btn-sm btn-success"
                            >
                                添加配置项
                            </Button>
                        )}
                        <Button
                            onClick={loadVariables}
                            icon="refresh"
                            className="btn-sm btn-default"
                        >
                            重新加载
                        </Button>
                    </div>

                    {/* 垂直竖线分隔符 */}
                    <div
                        style={{
                            width: 1,
                            height: 20,
                            background: "var(--mitmweb-border)",
                        }}
                    />

                    {/* 视图切换按钮组 */}
                    <div className="btn-group">
                        <button
                            type="button"
                            className={`btn btn-sm ${mode === "table" ? "btn-primary" : "btn-default"}`}
                            onClick={switchToTable}
                            style={{ fontWeight: mode === "table" ? 600 : 400 }}
                        >
                            表格视图
                        </button>
                        <button
                            type="button"
                            className={`btn btn-sm ${mode === "json" ? "btn-primary" : "btn-default"}`}
                            onClick={switchToJson}
                            style={{ fontWeight: mode === "json" ? 600 : 400 }}
                        >
                            <Icon name="braces" /> JSON 视图
                        </button>
                    </div>

                    {/* 垂直竖线分隔符 */}
                    <div
                        style={{
                            width: 1,
                            height: 20,
                            background: "var(--mitmweb-border)",
                        }}
                    />

                    {/* 圆形微交互关闭按钮 */}
                    <button
                        type="button"
                        className="btn btn-default btn-xs"
                        data-dismiss="modal"
                        title="关闭弹窗"
                        onClick={() => dispatch(modalActions.hideModal())}
                        style={{
                            width: 28,
                            height: 28,
                            padding: 0,
                            borderRadius: "50%",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            border: "1px solid var(--mitmweb-border)",
                            color: "var(--mitmweb-fg)",
                            background: "var(--mitmweb-bg)",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--mitmweb-text-danger)";
                            e.currentTarget.style.borderColor = "var(--mitmweb-danger)";
                            e.currentTarget.style.background = "var(--mitmweb-danger-soft-bg)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color = "var(--mitmweb-fg)";
                            e.currentTarget.style.borderColor = "var(--mitmweb-border)";
                            e.currentTarget.style.background = "var(--mitmweb-bg)";
                        }}
                    >
                        <Icon name="close" size={14} />
                    </button>
                </div>
            </div>

            <div className="modal-body" style={{ maxHeight: "74vh", overflowY: "auto", padding: "16px 20px" }}>
                {loading ? (
                    <div style={{ textAlign: "center", padding: "40px 0", color: "var(--mitmweb-fg-muted)" }}>
                        <Icon name="refresh" /> 正在加载配置数据...
                    </div>
                ) : mode === "table" ? (
                    <div
                        style={{
                            width: "100%",
                            borderRadius: 6,
                            overflow: "hidden",
                            border: "1px solid var(--mitmweb-border)",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
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
                                    <th style={{ width: "24%", padding: "10px 12px", color: "var(--mitmweb-fg-strong)", fontWeight: 600, verticalAlign: "middle" }}>
                                        变量名称 (Key)
                                    </th>
                                    <th style={{ width: "64%", padding: "10px 12px", color: "var(--mitmweb-fg-strong)", fontWeight: 600, verticalAlign: "middle" }}>
                                        配置内容 (字符串 / JSON 对象)
                                    </th>
                                    <th style={{ width: "12%", textAlign: "center", padding: "10px 12px", color: "var(--mitmweb-fg-strong)", fontWeight: 600, verticalAlign: "middle" }}>
                                        操作
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} style={{ textAlign: "center", padding: "35px 15px", color: "var(--mitmweb-fg-muted)" }}>
                                            暂无自定义配置项，点击右上角「添加配置项」开始设置。
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((r, idx) => {
                                        const trimmed = r.value.trim();
                                        const isJsonLike = trimmed.startsWith("{") || trimmed.startsWith("[");

                                        return (
                                            <tr
                                                key={r.id}
                                                style={{
                                                    background: idx % 2 === 1 ? "var(--mitmweb-bg-alt)" : "var(--mitmweb-bg)",
                                                }}
                                            >
                                                <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
                                                    <input
                                                        type="text"
                                                        className="input"
                                                        placeholder="例如: app_sign_key_dict"
                                                        value={r.key}
                                                        style={{
                                                            width: "100%",
                                                            height: 32,
                                                            padding: "4px 8px",
                                                            border: "1px solid var(--mitmweb-border)",
                                                            borderRadius: 4,
                                                            outline: "none",
                                                            boxShadow: "none",
                                                            boxSizing: "border-box",
                                                            fontFamily: "monospace",
                                                            fontSize: 13,
                                                            background: "var(--mitmweb-bg)",
                                                            color: "var(--mitmweb-fg)",
                                                        }}
                                                        onChange={(e) =>
                                                            handleRowChange(
                                                                r.id,
                                                                "key",
                                                                e.target.value,
                                                            )
                                                        }
                                                    />
                                                </td>
                                                <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
                                                    <textarea
                                                        className="input"
                                                        rows={r.value.includes("\n") ? Math.min(Math.max(r.value.split("\n").length, 3), 10) : 2}
                                                        placeholder='输入文本或 JSON，如 {"android": {"1.3.5": "xxx"}}'
                                                        value={r.value}
                                                        style={{
                                                            width: "100%",
                                                            padding: "6px 8px",
                                                            border: "1px solid var(--mitmweb-border)",
                                                            borderRadius: 4,
                                                            outline: "none",
                                                            boxShadow: "none",
                                                            boxSizing: "border-box",
                                                            display: "block",
                                                            fontFamily: "monospace",
                                                            fontSize: 12.5,
                                                            lineHeight: 1.45,
                                                            background: "var(--mitmweb-bg)",
                                                            color: "var(--mitmweb-fg)",
                                                            resize: "vertical",
                                                        }}
                                                        onChange={(e) =>
                                                            handleRowChange(
                                                                r.id,
                                                                "value",
                                                                e.target.value,
                                                            )
                                                        }
                                                    />
                                                </td>
                                                <td style={{ textAlign: "center", verticalAlign: "middle", padding: "10px 12px" }}>
                                                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", justifyContent: "center" }}>
                                                        {isJsonLike && (
                                                            <button
                                                                type="button"
                                                                className="btn btn-default btn-xs"
                                                                style={{ width: "100%", maxWidth: 84, color: "var(--mitmweb-accent)" }}
                                                                title="格式化多行缩进 JSON"
                                                                onClick={() => handleFormatJsonInRow(r.id)}
                                                            >
                                                                格式化
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            className="btn btn-default btn-xs"
                                                            style={{ width: "100%", maxWidth: 84, color: "var(--mitmweb-text-danger)" }}
                                                            title="删除此配置"
                                                            onClick={() => handleDeleteRow(r.id)}
                                                        >
                                                            <Icon name="close" /> 删除
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div style={{ width: "100%", border: "1px solid var(--mitmweb-border)", borderRadius: 6, overflow: "hidden", minHeight: 340 }}>
                        <CodeEditor
                            initialContent={jsonText}
                            onChange={setJsonText}
                        />
                    </div>
                )}
            </div>

            <div
                className="modal-footer"
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderTop: "1px solid var(--mitmweb-border-lighter)",
                    padding: "12px 20px",
                }}
            >
                <div style={{ flex: 1, textAlign: "left", paddingRight: 10 }}>
                    {status && (
                        <div
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "4px 10px",
                                borderRadius: 4,
                                fontSize: 13,
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
                            />
                            <span>{status.msg}</span>
                        </div>
                    )}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                    <Button
                        onClick={handleSave}
                        className="btn-sm btn-primary"
                        style={{ padding: "6px 18px", fontWeight: 600 }}
                    >
                        保存配置
                    </Button>
                    <Button
                        onClick={() => dispatch(modalActions.hideModal())}
                        className="btn-sm btn-default"
                        style={{ padding: "6px 14px" }}
                    >
                        关闭
                    </Button>
                </div>
            </div>
        </div>
    );
}
