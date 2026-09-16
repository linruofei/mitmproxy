import json
import tempfile
from pathlib import Path

import pytest
from mitmproxy import http
from mitmproxy import intercept_rules
from mitmproxy.test import tflow


@pytest.fixture(autouse=True)
def temp_rules_and_files():
    with tempfile.TemporaryDirectory() as td:
        orig_file = intercept_rules.RULES_FILE
        orig_dir = intercept_rules.MOCK_FILES_DIR
        orig_cache = intercept_rules._cache_rules
        orig_mtime = intercept_rules._last_mtime

        test_file = Path(td) / "intercept_rules.json"
        test_dir = Path(td) / "mock_files"
        intercept_rules.RULES_FILE = test_file
        intercept_rules.MOCK_FILES_DIR = test_dir
        intercept_rules._cache_rules = []
        intercept_rules._last_mtime = 0.0

        yield test_file, test_dir

        intercept_rules.RULES_FILE = orig_file
        intercept_rules.MOCK_FILES_DIR = orig_dir
        intercept_rules._cache_rules = orig_cache
        intercept_rules._last_mtime = orig_mtime


def test_crud_and_auto_init():
    rules = intercept_rules.get_all_rules()
    assert rules == []
    assert intercept_rules.RULES_FILE.exists()

    new_rules = [
        {
            "id": "r1",
            "name": "测试规则1",
            "enabled": True,
            "filter": "/api/user",
            "action": "mock",
            "mock_config": {
                "status_code": 200,
                "body": "{\"code\": 0}",
                "processor_type": "raw",
            },
        },
        {
            "id": "r2",
            "name": "测试断点",
            "enabled": True,
            "filter": "/api/pay",
            "action": "breakpoint",
            "intercept_phase": "request",
        },
    ]
    intercept_rules.save_all_rules(new_rules)
    assert len(intercept_rules.get_all_rules()) == 2

    # Toggle 测试
    toggled = intercept_rules.toggle_rule("r1")
    assert toggled is not None
    assert toggled["enabled"] is False

    toggled = intercept_rules.toggle_rule("r1", enabled=True)
    assert toggled["enabled"] is True


def test_server_mock_files_storage():
    saved = intercept_rules.save_server_mock_file("sample.bin", b"\x00\x01\x02\x03PNG")
    assert saved["name"] == "sample.bin"
    assert saved["size"] == 7

    files = intercept_rules.list_server_mock_files()
    assert len(files) == 1
    assert files[0]["name"] == "sample.bin"
    assert files[0]["size"] == 7


def test_dispatcher_mock_binary_file(tmp_path):
    bin_file = tmp_path / "avatar.png"
    binary_content = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x01"
    bin_file.write_bytes(binary_content)

    rules = [
        {
            "id": "bin_rule",
            "name": "Mock Binary",
            "enabled": True,
            "filter": "/image/avatar",
            "action": "mock",
            "mock_config": {
                "status_code": 200,
                "data_source": "file",
                "file_path": str(bin_file),
                "processor_type": "raw",
            },
        }
    ]
    intercept_rules.save_all_rules(rules)

    dispatcher = intercept_rules.RuleDispatcher()
    f = tflow.tflow()
    f.request.url = "https://example.com/image/avatar"
    dispatcher.request(f)
    assert f.response is not None
    assert f.response.content == binary_content


def test_dispatcher_mock_script():
    def mock_rsp_handler(flow: http.HTTPFlow, raw_body: str):
        data = json.loads(raw_body)
        data["injected"] = "from_script"
        data["query"] = dict(flow.request.query)
        return data

    intercept_rules.get_user_script_handlers = lambda: {
        "rsp_custom_user": mock_rsp_handler
    }

    rules = [
        {
            "id": "script_rule",
            "name": "Mock Script",
            "enabled": True,
            "filter": "/mock/script",
            "action": "mock",
            "mock_config": {
                "status_code": 200,
                "body": json.dumps({"original": 123}),
                "processor_type": "script",
                "script_handler": "rsp_custom_user",
            },
        }
    ]
    intercept_rules.save_all_rules(rules)

    dispatcher = intercept_rules.RuleDispatcher()
    f = tflow.tflow()
    f.request.url = "https://example.com/mock/script?uid=999"
    dispatcher.request(f)
    assert f.response is not None
    resp_json = json.loads(f.response.text)
    assert resp_json["original"] == 123
    assert resp_json["injected"] == "from_script"
    assert resp_json["query"]["uid"] == "999"


def test_dispatcher_breakpoint_phases():
    rules = [
        {
            "id": "bp_req",
            "name": "仅请求拦截",
            "enabled": True,
            "filter": "/bp/request",
            "action": "breakpoint",
            "intercept_phase": "request",
        },
        {
            "id": "bp_resp",
            "name": "仅响应拦截",
            "enabled": True,
            "filter": "/bp/response",
            "action": "breakpoint",
            "intercept_phase": "response",
        },
        {
            "id": "bp_both",
            "name": "双向拦截",
            "enabled": True,
            "filter": "/bp/both",
            "action": "breakpoint",
            "intercept_phase": "both",
        },
    ]
    intercept_rules.save_all_rules(rules)
    dispatcher = intercept_rules.RuleDispatcher()

    # 1. 仅请求拦截：request 挂起，response 不挂起
    f_req = tflow.tflow()
    f_req.request.url = "https://example.com/bp/request"
    dispatcher.request(f_req)
    assert f_req.intercepted is True

    f_req2 = tflow.tflow()
    f_req2.request.url = "https://example.com/bp/request"
    dispatcher.response(f_req2)
    assert f_req2.intercepted is False

    # 2. 仅响应拦截：request 不挂起，response 挂起
    f_resp = tflow.tflow()
    f_resp.request.url = "https://example.com/bp/response"
    dispatcher.request(f_resp)
    assert f_resp.intercepted is False

    dispatcher.response(f_resp)
    assert f_resp.intercepted is True

    # 3. 双向拦截：两者均挂起
    f_both = tflow.tflow()
    f_both.request.url = "https://example.com/bp/both"
    dispatcher.request(f_both)
    assert f_both.intercepted is True

    f_both2 = tflow.tflow()
    f_both2.request.url = "https://example.com/bp/both"
    dispatcher.response(f_both2)
    assert f_both2.intercepted is True
