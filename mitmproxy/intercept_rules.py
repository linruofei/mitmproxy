import inspect
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Callable

from mitmproxy import ctx
from mitmproxy import flow
from mitmproxy import flowfilter
from mitmproxy import http

logger = logging.getLogger(__name__)

RULES_FILE = Path("intercept_rules.json").resolve()
MOCK_FILES_DIR = Path("mock_files").resolve()

_cache_rules: list[dict[str, Any]] = []
_last_mtime: float = 0.0


def get_mock_files_dir() -> Path:
    if not MOCK_FILES_DIR.exists():
        try:
            MOCK_FILES_DIR.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.warning(f"Failed to create mock_files directory: {e}")
    return MOCK_FILES_DIR


def list_server_mock_files() -> list[dict[str, Any]]:
    """列出服务器 mock_files 目录下的所有文件信息"""
    dir_path = get_mock_files_dir()
    files_info = []
    try:
        for p in dir_path.glob("*"):
            if p.is_file():
                files_info.append({
                    "name": p.name,
                    "path": f"mock_files/{p.name}",
                    "size": p.stat().st_size,
                    "mtime": p.stat().st_mtime,
                })
        files_info.sort(key=lambda x: x["mtime"], reverse=True)
    except Exception as e:
        logger.error(f"Error listing server mock files: {e}")
    return files_info


def save_server_mock_file(filename: str, content: bytes) -> dict[str, Any]:
    """保存上传的文件到服务器 mock_files 目录"""
    dir_path = get_mock_files_dir()
    # 清理文件名防止路径穿越
    safe_name = Path(filename).name
    target_path = dir_path / safe_name
    target_path.write_bytes(content)
    return {
        "name": safe_name,
        "path": f"mock_files/{safe_name}",
        "size": len(content),
    }


def delete_server_mock_file(filename_or_path: str) -> bool:
    """删除服务器 mock_files 目录中的指定文件"""
    dir_path = get_mock_files_dir()
    safe_name = Path(filename_or_path).name
    target_path = dir_path / safe_name
    if target_path.is_file():
        try:
            target_path.unlink()
            return True
        except Exception as e:
            logger.error(f"Failed to delete mock file {target_path}: {e}")
            raise
    return False


def _load_from_disk() -> list[dict[str, Any]]:
    global _cache_rules, _last_mtime
    if not RULES_FILE.exists():
        try:
            RULES_FILE.write_text("[]\n", encoding="utf-8")
            _cache_rules = []
            _last_mtime = RULES_FILE.stat().st_mtime
            logger.info(f"Initialized empty {RULES_FILE}")
        except Exception as e:
            logger.warning(f"Failed to create {RULES_FILE}: {e}")
            _cache_rules = []
        return _cache_rules

    try:
        mtime = RULES_FILE.stat().st_mtime
        if mtime != _last_mtime:
            text = RULES_FILE.read_text(encoding="utf-8").strip()
            _cache_rules = json.loads(text) if text else []
            if not isinstance(_cache_rules, list):
                _cache_rules = []
            _last_mtime = mtime
    except Exception as e:
        logger.warning(f"Failed to load {RULES_FILE}: {e}")
    return _cache_rules


def get_all_rules() -> list[dict[str, Any]]:
    return list(_load_from_disk())


def save_all_rules(rules: list[dict[str, Any]]) -> None:
    global _cache_rules, _last_mtime
    _cache_rules = list(rules)
    try:
        RULES_FILE.write_text(
            json.dumps(_cache_rules, indent=4, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        _last_mtime = RULES_FILE.stat().st_mtime
    except Exception as e:
        logger.error(f"Failed to write {RULES_FILE}: {e}")
        raise


def toggle_rule(rule_id: str, enabled: bool | None = None) -> dict[str, Any] | None:
    rules = get_all_rules()
    target = None
    for r in rules:
        if str(r.get("id")) == str(rule_id):
            if enabled is None:
                r["enabled"] = not r.get("enabled", True)
            else:
                r["enabled"] = bool(enabled)
            target = r
            break
    if target is not None:
        save_all_rules(rules)
    return target


def get_user_script_handlers() -> dict[str, Callable]:
    """
    仅从 -s 参数指定的已加载脚本中扫描以 rsp_ 开头的处理函数。
    返回字典: { "rsp_foo": function_object }
    """
    handlers: dict[str, Callable] = {}
    try:
        if not hasattr(ctx, "master") or not ctx.master or not hasattr(ctx.master, "addons"):
            return handlers

        # 查找 ScriptLoader 插件
        script_loader = ctx.master.addons.get("scriptloader")
        if not script_loader:
            return handlers

        # ScriptLoader 的 addons 列表中保存了每一个 Script 实例
        for script_addon in getattr(script_loader, "addons", []):
            ns = getattr(script_addon, "ns", None)
            if not ns:
                continue
            # 扫描该命名空间下的函数
            for attr_name in dir(ns):
                if attr_name.startswith("rsp_"):
                    val = getattr(ns, attr_name)
                    if callable(val):
                        handlers[attr_name] = val
    except Exception as e:
        logger.debug(f"Error scanning user script handlers: {e}")
    return handlers


def get_available_handler_names() -> list[str]:
    """返回所有可用 rsp_* 处理函数的名字列表"""
    return sorted(list(get_user_script_handlers().keys()))


def matches_filter(f: flow.Flow, filter_expr: str) -> bool:
    """
    支持两类过滤匹配：
    1. mitmproxy 标准 flowfilter (如 ~u /user/info & ~m post)
    2. 如果不是 ~ 开头的语法，当成普通 URL 路径包含或正则匹配
    """
    if not filter_expr or not filter_expr.strip():
        return False

    expr = filter_expr.strip()
    # 尝试 mitmproxy flowfilter 解析
    if expr.startswith("~"):
        try:
            filt = flowfilter.parse(expr)
            if filt and filt(f):
                return True
        except Exception:
            pass

    # 简易 URL / Path 匹配或正则
    req_url = getattr(getattr(f, "request", None), "url", "")
    req_path = getattr(getattr(f, "request", None), "path", "")
    if expr in req_url or expr in req_path:
        return True
    try:
        if re.search(expr, req_url) or re.search(expr, req_path):
            return True
    except Exception:
        pass

    return False


class RuleDispatcher:
    """
    拦截规则调度核心：
    - request 阶段：处理 Mock 自动响应，以及 Phase in ("request", "both") 的断点拦截
    - response 阶段：处理 Phase in ("response", "both") 的断点拦截
    """

    def request(self, f: http.HTTPFlow) -> None:
        if getattr(f, "is_replay", False):
            return

        rules = get_all_rules()
        for rule in rules:
            if not rule.get("enabled", True):
                continue
            if not matches_filter(f, rule.get("filter", "")):
                continue

            action = rule.get("action", "breakpoint")

            # 1. Mock 响应模式：立即响应客户端，不发往真实服务端
            if action == "mock":
                self._handle_mock(f, rule)
                return

            # 2. 断点模式 (Breakpoint)
            elif action == "breakpoint":
                phase = rule.get("intercept_phase", "both")
                if phase in ("request", "both"):
                    f.intercept()
                    return

    def response(self, f: http.HTTPFlow) -> None:
        if getattr(f, "is_replay", False):
            return

        rules = get_all_rules()
        for rule in rules:
            if not rule.get("enabled", True):
                continue
            if not matches_filter(f, rule.get("filter", "")):
                continue

            action = rule.get("action", "breakpoint")
            if action == "breakpoint":
                phase = rule.get("intercept_phase", "both")
                if phase in ("response", "both"):
                    f.intercept()
                    return

    def _handle_mock(self, f: http.HTTPFlow, rule: dict[str, Any]) -> None:
        mock_cfg = rule.get("mock_config", {})
        status_code = int(mock_cfg.get("status_code", 200))
        headers = dict(mock_cfg.get("headers") or {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
        })

        # 支持内联文本或从文件读取（支持文本和任意二进制文件）
        data_source = mock_cfg.get("data_source", "inline")
        raw_body: bytes = b""
        if data_source == "file":
            file_path = mock_cfg.get("file_path", "").strip()
            if file_path:
                try:
                    p = Path(file_path).expanduser().resolve()
                    if p.is_file():
                        raw_body = p.read_bytes()
                    else:
                        logger.error(f"Mock file not found: {p}")
                        raw_body = f'{{"error": "Mock file not found: {file_path}"}}'.encode("utf-8")
                except Exception as e:
                    logger.error(f"Failed to read mock file {file_path}: {e}")
                    raw_body = f'{{"error": "Failed to read file: {e}"}}'.encode("utf-8")
            else:
                body_val = mock_cfg.get("body", "")
                raw_body = body_val.encode("utf-8") if isinstance(body_val, str) else bytes(body_val)
        else:
            body_val = mock_cfg.get("body", "")
            raw_body = body_val.encode("utf-8") if isinstance(body_val, str) else bytes(body_val)

        processor_type = mock_cfg.get("processor_type", "raw")
        script_handler_name = mock_cfg.get("script_handler", "")

        final_body: str | bytes = raw_body

        if processor_type == "script" and script_handler_name:
            handlers = get_user_script_handlers()
            handler = handlers.get(script_handler_name)
            if handler:
                try:
                    # 如果可能为 UTF-8 字符串，传入可读字符串，否则直接传 bytes
                    try:
                        passed_body = raw_body.decode("utf-8")
                    except Exception:
                        passed_body = raw_body

                    sig = inspect.signature(handler)
                    param_count = len(sig.parameters)
                    if param_count >= 2:
                        res = handler(f, passed_body)
                    elif param_count == 1:
                        res = handler(f)
                    else:
                        res = handler()

                    if isinstance(res, http.Response):
                        f.metadata["is_mock"] = True
                        f.metadata["mock_rule_name"] = rule.get("name", "")
                        f.response = res
                        return
                    elif isinstance(res, (bytes, str, dict, list)):
                        if isinstance(res, (dict, list)):
                            final_body = json.dumps(res, ensure_ascii=False).encode("utf-8")
                        else:
                            final_body = res
                except Exception as e:
                    logger.error(f"Error executing custom script handler {script_handler_name}: {e}")
            else:
                logger.warning(f"Script handler {script_handler_name} not found in loaded user scripts.")

        if isinstance(final_body, str):
            body_bytes = final_body.encode("utf-8")
        elif isinstance(final_body, bytes):
            body_bytes = final_body
        else:
            body_bytes = str(final_body).encode("utf-8")

        f.metadata["is_mock"] = True
        f.metadata["mock_rule_name"] = rule.get("name", "")
        f.response = http.Response.make(status_code, body_bytes, headers)
