import json
import logging
from pathlib import Path
from typing import Any
from collections.abc import MutableMapping

logger = logging.getLogger(__name__)

CONFIG_FILE = Path("custom_variables.json").resolve()

_cache: dict[str, Any] = {}
_last_mtime: float = 0.0


def _load_from_disk() -> dict[str, Any]:
    global _cache, _last_mtime
    if not CONFIG_FILE.exists():
        return _cache
    try:
        mtime = CONFIG_FILE.stat().st_mtime
        if mtime != _last_mtime:
            text = CONFIG_FILE.read_text(encoding="utf-8")
            _cache = json.loads(text) if text.strip() else {}
            _last_mtime = mtime
    except Exception as e:
        logger.warning(f"Failed to load custom_variables.json: {e}")
    return _cache


def get_all() -> dict[str, Any]:
    return dict(_load_from_disk())


def get(key: str, default: Any = None) -> Any:
    return _load_from_disk().get(key, default)


def set_all(data: dict[str, Any]) -> None:
    global _cache, _last_mtime
    _cache = data
    try:
        CONFIG_FILE.write_text(
            json.dumps(_cache, indent=4, ensure_ascii=False), encoding="utf-8"
        )
        _last_mtime = CONFIG_FILE.stat().st_mtime
    except Exception as e:
        logger.error(f"Failed to write custom_variables.json: {e}")
        raise


def set(key: str, value: Any) -> None:
    data = dict(_load_from_disk())
    data[key] = value
    set_all(data)


class DynamicProxy:
    """通用动态变量代理：支持 dict、list 或其他任意类型实时从配置中获取"""

    def __init__(self, key: str, fallback_default: Any = None):
        self._key = key
        self._fallback_default = fallback_default

    def _get_target(self) -> Any:
        val = get(self._key)
        if val is not None:
            return val
        if callable(self._fallback_default):
            return self._fallback_default()
        return self._fallback_default

    def __getitem__(self, k):
        return self._get_target()[k]

    def __setitem__(self, k, v):
        cur = self._get_target()
        if isinstance(cur, dict):
            d = dict(cur)
            d[k] = v
            set(self._key, d)
        elif isinstance(cur, list):
            l = list(cur)
            l[k] = v
            set(self._key, l)
        else:
            raise TypeError("Target is not mutable mapping or sequence")

    def __delitem__(self, k):
        cur = self._get_target()
        if isinstance(cur, dict):
            d = dict(cur)
            del d[k]
            set(self._key, d)
        elif isinstance(cur, list):
            l = list(cur)
            del l[k]
            set(self._key, l)
        else:
            raise TypeError("Target is not mutable mapping or sequence")

    def __iter__(self):
        target = self._get_target()
        return iter(target) if target is not None else iter([])

    def __len__(self):
        target = self._get_target()
        return len(target) if target is not None else 0

    def __contains__(self, k):
        target = self._get_target()
        return k in target if target is not None else False

    def __repr__(self):
        return repr(self._get_target())

    def __bool__(self):
        return bool(self._get_target())

    def get(self, k, default=None):
        target = self._get_target()
        if isinstance(target, dict):
            return target.get(k, default)
        return default

    def keys(self):
        target = self._get_target()
        return target.keys() if isinstance(target, dict) else [].keys()

    def values(self):
        target = self._get_target()
        return target.values() if isinstance(target, dict) else [].values()

    def items(self):
        target = self._get_target()
        return target.items() if isinstance(target, dict) else [].items()


DynamicDictProxy = DynamicProxy
